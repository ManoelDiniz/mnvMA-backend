import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { IsNull, LessThan, type EntityManager } from 'typeorm'
import { SystemScope } from '../../common/database/system-scope.service'
import { SubscriptionStatus } from '../../common/enums/tenant.enum'
import type { Env } from '../../config/env'
import { fromCents } from '../../common/database/decimal.transformer'
import { destinatarios, PAPEIS_DE_COBRANCA } from '../jobs/destinatarios'
import { MailService } from '../mail/mail.service'
import { assinaturaAtivada, cobrancaRecusada } from '../mail/templates'
import { Tenant } from '../tenants/entities/tenant.entity'
import {
  SubscriptionPayment,
  SubscriptionPaymentStatus,
} from './entities/subscription-payment.entity'
import { CouponsService, precoComDesconto } from './coupons.service'
import { Plan } from './entities/plan.entity'
import { Subscription } from './entities/subscription.entity'
import { WebhookEvent } from './entities/webhook-event.entity'
import { MercadoPagoClient } from './mercadopago/mercadopago.client'
import { MP_TOPIC, type MpAuthorizedPayment } from './mercadopago/mercadopago.types'
import { SubscriptionStatusService, traduzirStatusDoProvedor } from './subscription-status.service'

/**
 * Depois de tantas tentativas sem achar a assinatura, o evento deixa de ser
 * "chegou antes da hora" e passa a ser "tem algo errado" — e vira órfão para
 * alguém olhar. Três dá folga para a corrida entre o webhook e o commit de
 * quem criou a assinatura, que é de milissegundos.
 */
const TENTATIVAS_ATE_ORFAO = 3

/**
 * Só as colunas escalares: `update()` do TypeORM recusa objeto que carregue
 * relação carregada junto, e `Partial<Entity>` deixa as relações passarem.
 */
type MudancasDaAssinatura = Partial<
  Pick<
    Subscription,
    | 'status'
    | 'planId'
    | 'mpPreapprovalId'
    | 'mpPayerId'
    | 'nextChargeAt'
    | 'currentPeriodEnd'
    | 'pastDueSince'
    | 'dunningStage'
    | 'lastDunningAt'
    | 'canceledAt'
    | 'checkoutUrl'
    | 'graceUntil'
    | 'pendingPlanId'
  >
>

type DadosDaCobranca = Pick<
  SubscriptionPayment,
  | 'tenantId'
  | 'subscriptionId'
  | 'provider'
  | 'mpPaymentId'
  | 'status'
  | 'statusDetail'
  | 'amount'
  | 'currency'
  | 'paymentMethod'
  | 'dueAt'
  | 'paidAt'
  | 'periodStart'
  | 'periodEnd'
>

export interface EventoRecebido {
  provider: string
  eventId: string
  type: string
  action?: string | null
  payload: Record<string, unknown>
  signatureOk: boolean
}

/**
 * O que acontece com uma notificação do Mercado Pago depois que o 200 já foi
 * respondido.
 *
 * Duas regras governam este arquivo:
 *
 *   1. **Nunca confiar no corpo do webhook.** Ele diz "o recurso X mudou", e
 *      só. O estado vem sempre de um `GET` no provedor. É isso que também
 *      resolve evento fora de ordem: se `cancelled` chegar depois de
 *      `authorized`, a consulta devolve o estado real de agora.
 *
 *   2. **Idempotência em toda gravação.** O provedor reenvia; o job de
 *      reconciliação reprocessa. Nada aqui pode somar período ou duplicar
 *      cobrança por rodar duas vezes.
 */
@Injectable()
export class WebhookProcessorService {
  private readonly logger = new Logger(WebhookProcessorService.name)

  constructor(
    private readonly systemScope: SystemScope,
    private readonly mp: MercadoPagoClient,
    private readonly statusService: SubscriptionStatusService,
    private readonly cupons: CouponsService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ─── Recepção ───────────────────────────────────────────────────────────────

  /**
   * Grava o evento. Devolve `duplicado: true` quando ele já existia — é o
   * reenvio do provedor batendo na chave única, exatamente como planejado.
   */
  async registrar(dados: EventoRecebido): Promise<{ evento: WebhookEvent; duplicado: boolean }> {
    return this.systemScope.run('billing.webhook.registrar', async (manager) => {
      const repo = manager.getRepository(WebhookEvent)

      const existente = await repo.findOne({
        where: { provider: dados.provider, eventId: dados.eventId, type: dados.type },
      })

      if (existente) return { evento: existente, duplicado: true }

      const evento = await repo.save(
        repo.create({
          provider: dados.provider,
          eventId: dados.eventId,
          type: dados.type,
          action: dados.action ?? null,
          payload: dados.payload,
          signatureOk: dados.signatureOk,
          receivedAt: new Date(),
        }),
      )

      return { evento, duplicado: false }
    })
  }

  // ─── Processamento ──────────────────────────────────────────────────────────

  async processar(eventoId: string): Promise<void> {
    await this.systemScope.run('billing.webhook.processar', async (manager) => {
      const repo = manager.getRepository(WebhookEvent)
      const evento = await repo.findOne({ where: { id: eventoId } })

      if (!evento) return
      if (evento.processedAt) return
      // Evento com assinatura ruim fica gravado como rastro e nunca é
      // processado: é a diferença entre registrar uma tentativa e obedecê-la.
      if (!evento.signatureOk) return

      await repo.update(evento.id, { attempts: evento.attempts + 1 })
      evento.attempts += 1

      try {
        const resultado = await this.despachar(manager, evento)

        if (resultado === 'orfao') {
          const desistir = evento.attempts >= TENTATIVAS_ATE_ORFAO
          await repo.update(evento.id, {
            orphan: desistir,
            lastError: 'assinatura não encontrada para este evento',
            processedAt: desistir ? new Date() : null,
          })

          if (desistir) {
            // Não pode sumir em silêncio: ou é dinheiro que entrou e não
            // estamos creditando, ou apagamos algo que não devíamos.
            this.logger.error(
              { eventoId: evento.id, tipo: evento.type, recurso: evento.eventId },
              'evento órfão do Mercado Pago — precisa de conferência manual',
            )
          }
          return
        }

        await repo.update(evento.id, { processedAt: new Date(), lastError: null, orphan: false })
      } catch (error) {
        const motivo = error instanceof Error ? error.message : String(error)
        await repo.update(evento.id, { lastError: motivo.slice(0, 500) })
        this.logger.error({ eventoId: evento.id, err: error }, 'falha ao processar evento')
        throw error
      }
    })
  }

  /**
   * Reprocessa o que ficou para trás: webhook que chegou enquanto a API caía,
   * evento que estourou no meio, corrida com o commit da assinatura.
   *
   * É a rede de segurança que permite a fila em processo existir sem Redis.
   */
  async processarPendentes(limite = 50): Promise<number> {
    const pendentes = await this.systemScope.run('billing.webhook.pendentes', (manager) =>
      manager.getRepository(WebhookEvent).find({
        where: { processedAt: IsNull(), signatureOk: true, attempts: LessThan(10) },
        order: { receivedAt: 'ASC' },
        take: limite,
      }),
    )

    let processados = 0
    for (const evento of pendentes) {
      try {
        await this.processar(evento.id)
        processados += 1
      } catch {
        // Já logado em `processar`. Seguir para o próximo: um evento
        // problemático não pode segurar a fila inteira.
      }
    }

    return processados
  }

  // ─── Um evento de cada tipo ─────────────────────────────────────────────────

  private async despachar(manager: EntityManager, evento: WebhookEvent): Promise<'ok' | 'orfao'> {
    switch (evento.type) {
      case MP_TOPIC.PREAPPROVAL:
        return this.aplicarPreapproval(manager, evento)

      case MP_TOPIC.AUTHORIZED_PAYMENT:
        return this.aplicarCobranca(manager, evento)

      case MP_TOPIC.PAYMENT:
        // Pagamento avulso é o Fluxo B (a empresa cobrando a família dela),
        // que ainda não existe. Fica registrado e conferido — descartar sem
        // olhar seria perder o rastro do dia em que o fluxo entrar.
        this.logger.log(
          { eventoId: evento.id, recurso: evento.eventId },
          'pagamento avulso recebido — sem tratamento até o Fluxo B existir',
        )
        return 'ok'

      case MP_TOPIC.PREAPPROVAL_PLAN:
        this.logger.log({ recurso: evento.eventId }, 'plano alterado no provedor')
        return 'ok'

      default:
        this.logger.warn({ tipo: evento.type }, 'tipo de evento desconhecido — ignorado')
        return 'ok'
    }
  }

  /** Assinatura criada, autorizada, pausada ou cancelada. */
  private async aplicarPreapproval(
    manager: EntityManager,
    evento: WebhookEvent,
  ): Promise<'ok' | 'orfao'> {
    const remoto = await this.mp.buscarPreapproval(evento.eventId)

    const assinatura = await this.acharAssinatura(manager, {
      id: remoto.external_reference,
      preapprovalId: remoto.id,
    })
    if (!assinatura) return 'orfao'

    const anterior = assinatura.status
    const traduzido = traduzirStatusDoProvedor(remoto.status)

    const mudancas: MudancasDaAssinatura = {
      mpPreapprovalId: remoto.id,
      mpPayerId: remoto.payer_id ? String(remoto.payer_id) : (assinatura.mpPayerId ?? null),
      nextChargeAt: remoto.next_payment_date ? new Date(remoto.next_payment_date) : null,
    }

    if (traduzido) {
      mudancas.status = traduzido

      if (traduzido === SubscriptionStatus.ACTIVE) {
        mudancas.pastDueSince = null
        mudancas.dunningStage = 0
        mudancas.canceledAt = null
        mudancas.checkoutUrl = null
        // Autorizada sem cobrança processada ainda: garante que a conta não
        // fique sem período enquanto o primeiro `authorized_payment` não vem.
        mudancas.currentPeriodEnd =
          remoto.next_payment_date != null
            ? new Date(remoto.next_payment_date)
            : (assinatura.currentPeriodEnd ?? proximoMes(new Date()))
      }

      if (traduzido === SubscriptionStatus.CANCELED && !assinatura.canceledAt) {
        mudancas.canceledAt = new Date()
      }
    }

    await manager.getRepository(Subscription).update(assinatura.id, mudancas)
    const atualizada = await manager
      .getRepository(Subscription)
      .findOneOrFail({ where: { id: assinatura.id } })

    await manager.getRepository(WebhookEvent).update(evento.id, { tenantId: atualizada.tenantId })
    await this.statusService.sincronizarConta(manager, atualizada)

    // O e-mail sai uma vez só, na transição — reprocessar o mesmo evento não
    // manda "assinatura confirmada" duas vezes.
    if (anterior !== SubscriptionStatus.ACTIVE && atualizada.status === SubscriptionStatus.ACTIVE) {
      // O cupom resgatado no checkout só passa a valer agora: até o pagamento
      // ser autorizado, o resgate era uma intenção.
      await this.cupons.aoAtivarAssinatura(manager, atualizada.tenantId, atualizada.id)
      await this.avisarAtivacao(manager, atualizada)
    }

    this.logger.log(
      {
        tenantId: atualizada.tenantId,
        de: anterior,
        para: atualizada.status,
        provedor: remoto.status,
      },
      'assinatura sincronizada pelo webhook',
    )

    return 'ok'
  }

  /** Cobrança recorrente processada — aprovada ou recusada. */
  private async aplicarCobranca(
    manager: EntityManager,
    evento: WebhookEvent,
  ): Promise<'ok' | 'orfao'> {
    const cobranca = await this.mp.buscarAuthorizedPayment(evento.eventId)

    const assinatura = await this.acharAssinatura(manager, {
      preapprovalId: cobranca.preapproval_id,
    })
    if (!assinatura) return 'orfao'

    const status = traduzirStatusDaCobranca(cobranca)
    const valor = (cobranca.transaction_amount ?? 0).toFixed(2)
    const quando = cobranca.debit_date ? new Date(cobranca.debit_date) : new Date()

    const repo = manager.getRepository(SubscriptionPayment)
    const idNoProvedor = String(cobranca.id)

    // Idempotente pela chave `(provider, mp_payment_id)`: reprocessar atualiza
    // a linha existente em vez de criar uma segunda cobrança no extrato.
    const existente = await repo.findOne({
      where: { provider: 'mercadopago', mpPaymentId: idNoProvedor },
    })

    const dados: DadosDaCobranca = {
      tenantId: assinatura.tenantId,
      subscriptionId: assinatura.id,
      provider: 'mercadopago',
      mpPaymentId: idNoProvedor,
      status,
      statusDetail: cobranca.payment?.status_detail ?? null,
      amount: valor,
      currency: cobranca.currency_id ?? 'BRL',
      paymentMethod: cobranca.payment?.payment_method_id ?? null,
      dueAt: quando,
      paidAt: status === SubscriptionPaymentStatus.APPROVED ? quando : null,
      periodStart: quando,
      periodEnd: proximoMes(quando),
    }

    if (existente) {
      await repo.update(existente.id, dados)
    } else {
      await repo.save(repo.create(dados))
    }

    await manager.getRepository(WebhookEvent).update(evento.id, { tenantId: assinatura.tenantId })

    if (status === SubscriptionPaymentStatus.APPROVED) {
      await this.cobrancaAprovada(manager, assinatura, quando)
    } else if (status === SubscriptionPaymentStatus.REJECTED) {
      await this.cobrancaRecusada(manager, assinatura, valor, cobranca)
    }

    return 'ok'
  }

  private async cobrancaAprovada(
    manager: EntityManager,
    assinatura: Subscription,
    quando: Date,
  ): Promise<void> {
    const eraInadimplente = assinatura.status !== SubscriptionStatus.ACTIVE

    await manager.getRepository(Subscription).update(assinatura.id, {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: proximoMes(quando),
      pastDueSince: null,
      dunningStage: 0,
      lastDunningAt: null,
      checkoutUrl: null,
    })

    const atualizada = await manager
      .getRepository(Subscription)
      .findOneOrFail({ where: { id: assinatura.id } })

    await this.cupons.aoAtivarAssinatura(manager, atualizada.tenantId, atualizada.id)
    await this.consumirCupom(manager, atualizada)

    // Downgrade agendado entra agora: o período que a pessoa pagou acabou de
    // virar, que era exatamente a condição combinada com ela.
    if (atualizada.pendingPlanId) {
      await manager
        .getRepository(Subscription)
        .update(atualizada.id, { planId: atualizada.pendingPlanId, pendingPlanId: null })
      atualizada.planId = atualizada.pendingPlanId
      atualizada.pendingPlanId = null
    }

    await this.statusService.sincronizarConta(manager, atualizada)

    if (eraInadimplente) await this.avisarAtivacao(manager, atualizada)
  }

  private async cobrancaRecusada(
    manager: EntityManager,
    assinatura: Subscription,
    valor: string,
    cobranca: MpAuthorizedPayment,
  ): Promise<void> {
    // D+0 do dunning. Quem já estava inadimplente mantém a data original — é
    // ela que conta os dias até a suspensão, e reiniciá-la a cada tentativa
    // recusada daria carência infinita.
    const desde = assinatura.pastDueSince ?? new Date()

    await manager.getRepository(Subscription).update(assinatura.id, {
      status: SubscriptionStatus.PAST_DUE,
      pastDueSince: desde,
      graceUntil: new Date(desde.getTime() + 7 * 86_400_000),
    })

    const atualizada = await manager
      .getRepository(Subscription)
      .findOneOrFail({ where: { id: assinatura.id } })

    await this.statusService.sincronizarConta(manager, atualizada)

    // Só o primeiro aviso sai daqui; os seguintes são do job de dunning, que
    // controla o espaçamento. Mandar um e-mail por tentativa do provedor
    // ensinaria o cliente a filtrar o remetente.
    if (assinatura.dunningStage === 0) {
      await manager.getRepository(Subscription).update(assinatura.id, {
        dunningStage: 1,
        lastDunningAt: new Date(),
      })

      const conta = await manager
        .getRepository(Tenant)
        .findOneOrFail({ where: { id: assinatura.tenantId } })

      await this.notificarTitulares(manager, conta, (nome) =>
        cobrancaRecusada({
          nome,
          conta: conta.name,
          valor,
          motivo: cobranca.payment?.status_detail ?? null,
          url: this.urlDaAssinatura(),
          suspendeEm: new Date(desde.getTime() + 7 * 86_400_000),
        }),
      )
    }
  }

  /**
   * Uma fatura com desconto acabou de ser paga.
   *
   * Quando era a última do cupom, o valor da assinatura precisa voltar ao cheio
   * NO PROVEDOR — a assinatura recorrente do Mercado Pago tem valor fixo, então
   * "50% nos 3 primeiros meses" é, na prática, cobrar metade e depois pedir a
   * ele que passe a cobrar o valor inteiro. Esquecer este passo é dar desconto
   * para sempre sem ninguém perceber.
   */
  private async consumirCupom(manager: EntityManager, assinatura: Subscription): Promise<void> {
    const consumo = await this.cupons.consumirFatura(manager, assinatura.tenantId)
    if (!consumo?.esgotou) return

    const plano = await manager.getRepository(Plan).findOne({ where: { id: assinatura.planId } })
    if (!plano || !assinatura.mpPreapprovalId) return

    try {
      await this.mp.atualizarPreapproval(assinatura.mpPreapprovalId, {
        auto_recurring: {
          transaction_amount: Number(fromCents(BigInt(plano.priceCents))),
          currency_id: 'BRL',
        },
      })

      this.logger.log(
        {
          tenantId: assinatura.tenantId,
          de: precoComDesconto(plano.priceCents, consumo.resgate.discountPercent),
          para: plano.priceCents,
        },
        'desconto do cupom esgotado — valor cheio restabelecido no provedor',
      )
    } catch (error) {
      // Não pode derrubar o processamento do pagamento, que já entrou. O job de
      // reconciliação reconsulta e o próximo ciclo corrige — e o log grita.
      this.logger.error(
        { tenantId: assinatura.tenantId, err: error },
        'FALHA ao restabelecer o valor cheio depois do cupom — a conta pode seguir com desconto',
      )
    }
  }

  // ─── Apoio ──────────────────────────────────────────────────────────────────

  private async acharAssinatura(
    manager: EntityManager,
    chaves: { id?: string | null; preapprovalId?: string | null },
  ): Promise<Subscription | null> {
    const repo = manager.getRepository(Subscription)

    // `external_reference` primeiro: é o id que nós mesmos mandamos, e vale
    // mesmo quando o provedor gerou uma assinatura nova para a mesma conta.
    if (chaves.id) {
      const porId = await repo.findOne({ where: { id: chaves.id } })
      if (porId) return porId
    }

    if (chaves.preapprovalId) {
      const porPreapproval = await repo.findOne({
        where: { mpPreapprovalId: chaves.preapprovalId },
      })
      if (porPreapproval) return porPreapproval
    }

    return null
  }

  private async avisarAtivacao(manager: EntityManager, assinatura: Subscription): Promise<void> {
    const conta = await manager
      .getRepository(Tenant)
      .findOneOrFail({ where: { id: assinatura.tenantId } })

    await this.notificarTitulares(manager, conta, (nome) =>
      assinaturaAtivada({
        nome,
        conta: conta.name,
        plano: assinatura.plan?.name ?? 'MNVMA Care',
        proximaCobranca: assinatura.nextChargeAt ?? assinatura.currentPeriodEnd ?? null,
        url: this.urlDaAssinatura(),
      }),
    )
  }

  private async notificarTitulares(
    manager: EntityManager,
    conta: Tenant,
    conteudo: (nome: string) => Parameters<MailService['send']>[1],
  ): Promise<void> {
    const titulares = await destinatarios(manager, conta.id, PAPEIS_DE_COBRANCA)

    if (titulares.length === 0) {
      this.logger.warn({ tenantId: conta.id }, 'conta sem titular ativo — ninguém para avisar')
      return
    }

    for (const titular of titulares) {
      await this.mail.send(titular.email, conteudo(titular.name))
    }
  }

  private urlDaAssinatura(): string {
    return `${this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '')}/assinatura`
  }
}

// ─── Funções puras ────────────────────────────────────────────────────────────

/**
 * O estado da cobrança fica em dois lugares na resposta do provedor: o do
 * recurso e o do pagamento por baixo dele. O de dentro é o que vale — é ele que
 * diz `rejected` com o motivo.
 */
export function traduzirStatusDaCobranca(
  cobranca: MpAuthorizedPayment,
): SubscriptionPaymentStatus {
  const bruto = (cobranca.payment?.status ?? cobranca.status ?? '').toLowerCase()

  const mapa: Record<string, SubscriptionPaymentStatus> = {
    approved: SubscriptionPaymentStatus.APPROVED,
    authorized: SubscriptionPaymentStatus.APPROVED,
    processed: SubscriptionPaymentStatus.APPROVED,
    recycling: SubscriptionPaymentStatus.PENDING,
    scheduled: SubscriptionPaymentStatus.PENDING,
    pending: SubscriptionPaymentStatus.PENDING,
    in_process: SubscriptionPaymentStatus.PENDING,
    rejected: SubscriptionPaymentStatus.REJECTED,
    cancelled: SubscriptionPaymentStatus.CANCELLED,
    refunded: SubscriptionPaymentStatus.REFUNDED,
    charged_back: SubscriptionPaymentStatus.CHARGED_BACK,
  }

  return mapa[bruto] ?? SubscriptionPaymentStatus.PENDING
}

/**
 * Um mês adiante preservando o dia. Dia 31 em mês de 30 cairia no dia 1 do mês
 * seguinte com a aritmética ingênua do `setMonth` — aqui ele volta para o
 * último dia do mês certo, que é o que qualquer cobrança mensal faz.
 */
export function proximoMes(data: Date): Date {
  const resultado = new Date(data)
  const dia = resultado.getUTCDate()
  resultado.setUTCMonth(resultado.getUTCMonth() + 1)
  if (resultado.getUTCDate() < dia) resultado.setUTCDate(0)
  return resultado
}

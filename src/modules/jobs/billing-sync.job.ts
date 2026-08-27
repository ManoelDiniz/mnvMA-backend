import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { In, IsNull, LessThan, Not, Or, type EntityManager } from 'typeorm'
import { SystemScope } from '../../common/database/system-scope.service'
import { SubscriptionStatus, TenantStatus } from '../../common/enums/tenant.enum'
import type { Env } from '../../config/env'
import { CORTESIA, CouponsService } from '../billing/coupons.service'
import {
  CouponRedemption,
  CouponRedemptionStatus,
} from '../billing/entities/coupon-redemption.entity'
import { Subscription } from '../billing/entities/subscription.entity'
import { MercadoPagoClient } from '../billing/mercadopago/mercadopago.client'
import {
  SubscriptionStatusService,
  traduzirStatusDoProvedor,
} from '../billing/subscription-status.service'
import { WebhookProcessorService } from '../billing/webhook-processor.service'
import { MailService } from '../mail/mail.service'
import { cortesiaEncerrada, cortesiaTerminando } from '../mail/templates'
import { Tenant } from '../tenants/entities/tenant.entity'
import { destinatarios, PAPEIS_DE_COBRANCA } from './destinatarios'
import { JobLockService } from './job-lock.service'

export const JOB_BILLING_SYNC = 'billing.sincronizacao'

/** Quantas assinaturas o job reconsulta por rodada. */
const LOTE = 100

/**
 * A rede embaixo da cobrança.
 *
 * Webhook se perde: o provedor tenta algumas vezes e desiste, a API pode estar
 * reiniciando no momento exato, a rede pisca. Sem este job, o sintoma seria o
 * pior possível — cliente que pagou continua vendo "conta suspensa", e ninguém
 * fica sabendo até ele abrir chamado.
 *
 * Roda de hora em hora e faz três coisas:
 *
 *   1. reprocessa o que ficou em `webhook_events` sem `processed_at`
 *   2. reconsulta no provedor as assinaturas cujo período já deveria ter virado
 *   3. aplica downgrade agendado e fecha conta cancelada cujo período acabou
 */
@Injectable()
export class BillingSyncJob {
  private readonly logger = new Logger(BillingSyncJob.name)

  constructor(
    private readonly locks: JobLockService,
    private readonly systemScope: SystemScope,
    private readonly processor: WebhookProcessorService,
    private readonly mp: MercadoPagoClient,
    private readonly statusService: SubscriptionStatusService,
    private readonly cupons: CouponsService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Cron('7 * * * *', { name: JOB_BILLING_SYNC, timeZone: 'America/Sao_Paulo' })
  async aCadaHora(): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) return
    await this.executar()
  }

  async executar(referencia = new Date()): Promise<void> {
    await this.locks.run(JOB_BILLING_SYNC, chaveDaHora(referencia), async () => {
      const reprocessados = await this.processor.processarPendentes()
      const reconsultadas = await this.reconsultarAssinaturas(referencia)
      const viradas = await this.virarPeriodosVencidos(referencia)
      const cortesias = await this.cuidarDasCortesias(referencia)

      return `${reprocessados} evento(s), ${reconsultadas} assinatura(s), ${viradas} período(s), ${cortesias} cortesia(s)`
    })
  }

  // ─── Reconsulta no provedor ─────────────────────────────────────────────────

  private async reconsultarAssinaturas(agora: Date): Promise<number> {
    if (!this.mp.enabled) return 0

    const candidatas = await this.systemScope.run('jobs.billing.candidatas', (manager) =>
      manager.getRepository(Subscription).find({
        where: {
          mpPreapprovalId: Not(IsNull()),
          status: In([
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.TRIAL,
          ]),
          // Só o que já deveria ter mudado: cobrar o provedor por assinatura
          // que só vence daqui a 20 dias é gastar chamada à toa.
          nextChargeAt: Or(IsNull(), LessThan(agora)),
        },
        take: LOTE,
        order: { updatedAt: 'ASC' },
      }),
    )

    let sincronizadas = 0

    for (const assinatura of candidatas) {
      try {
        const remoto = await this.mp.buscarPreapproval(assinatura.mpPreapprovalId as string)
        const traduzido = traduzirStatusDoProvedor(remoto.status)
        if (!traduzido) continue

        const proximaCobranca = remoto.next_payment_date
          ? new Date(remoto.next_payment_date)
          : null

        const mudou =
          traduzido !== assinatura.status ||
          proximaCobranca?.getTime() !== assinatura.nextChargeAt?.getTime()

        if (!mudou) continue

        await this.systemScope.run('jobs.billing.sincronizar', async (manager) => {
          await manager.getRepository(Subscription).update(assinatura.id, {
            status: traduzido,
            nextChargeAt: proximaCobranca,
            ...(traduzido === SubscriptionStatus.ACTIVE
              ? { pastDueSince: null, dunningStage: 0, checkoutUrl: null }
              : {}),
          })

          const atualizada = await manager
            .getRepository(Subscription)
            .findOneOrFail({ where: { id: assinatura.id } })

          await this.statusService.sincronizarConta(manager, atualizada)
        })

        sincronizadas += 1
        this.logger.log(
          { tenantId: assinatura.tenantId, de: assinatura.status, para: traduzido },
          'assinatura corrigida pela reconciliação',
        )
      } catch (error) {
        // Uma assinatura problemática não pode parar a varredura das outras.
        this.logger.warn(
          { tenantId: assinatura.tenantId, err: error },
          'falha ao reconsultar assinatura no provedor',
        )
      }
    }

    return sincronizadas
  }

  // ─── Virada de período ──────────────────────────────────────────────────────

  /**
   * Fecha o que dependia só da passagem do tempo: downgrade agendado que
   * chegou a hora, e conta cancelada cujo período pago acabou.
   *
   * Não depende do provedor de propósito — se ele estiver fora do ar, isto
   * continua correto, porque a informação já está toda no nosso banco.
   */
  private async virarPeriodosVencidos(agora: Date): Promise<number> {
    return this.systemScope.run('jobs.billing.virada', async (manager) => {
      // Só o que tem trabalho a fazer. Sem este recorte, toda assinatura ativa
      // cujo período já passou (a maioria delas, entre a virada e a confirmação
      // do pagamento) entraria no lote e empurraria para fora quem realmente
      // precisa de ação.
      const vencidas = await manager
        .getRepository(Subscription)
        .createQueryBuilder('s')
        .where('s.currentPeriodEnd < :agora', { agora })
        .andWhere('(s.pendingPlanId IS NOT NULL OR s.status = :cancelada)', {
          cancelada: SubscriptionStatus.CANCELED,
        })
        .orderBy('s.currentPeriodEnd', 'ASC')
        .take(LOTE)
        .getMany()

      let viradas = 0

      for (const assinatura of vencidas) {
        try {
          const aplicouDowngrade = await this.aplicarDowngrade(manager, assinatura)
          const fechou = await this.fecharCancelada(manager, assinatura)
          if (aplicouDowngrade || fechou) viradas += 1
        } catch (error) {
          // Mesma regra da reconsulta: uma linha problemática (uma conta
          // apagada à mão, um dado inconsistente vindo de migração) não pode
          // parar o job inteiro — o que ficaria para trás é o dinheiro das
          // outras contas.
          this.logger.warn(
            { tenantId: assinatura.tenantId, err: error },
            'falha ao virar o período desta assinatura',
          )
        }
      }

      return viradas
    })
  }

  private async aplicarDowngrade(
    manager: EntityManager,
    assinatura: Subscription,
  ): Promise<boolean> {
    if (!assinatura.pendingPlanId) return false

    await manager
      .getRepository(Subscription)
      .update(assinatura.id, { planId: assinatura.pendingPlanId, pendingPlanId: null })

    this.logger.log(
      { tenantId: assinatura.tenantId, planId: assinatura.pendingPlanId },
      'downgrade agendado aplicado na virada do período',
    )
    return true
  }

  // ─── Cortesia (cupom de 100%) ───────────────────────────────────────────────

  /**
   * Avisa e encerra as cortesias.
   *
   * Uma conta liberada por cupom de 100% não tem cartão nem cobrança: o que a
   * limita é o calendário, e sem este passo ela ficaria de graça para sempre.
   *
   * Roda de hora em hora sem virar spam porque o aviso é controlado por
   * `warnedStage`, não pelo relógio: cada etapa sai uma vez só, mesmo que o job
   * passe por aqui vinte e quatro vezes no mesmo dia.
   */
  private async cuidarDasCortesias(agora: Date): Promise<number> {
    const cortesias = await this.systemScope.run('jobs.billing.cortesias', (manager) =>
      manager
        .getRepository(CouponRedemption)
        .createQueryBuilder('r')
        .where('r.status = :ativo', { ativo: CouponRedemptionStatus.ACTIVE })
        .andWhere('r.discountPercent >= :cortesia', { cortesia: CORTESIA })
        .andWhere('r.endsAt IS NOT NULL')
        .andWhere('r.deletedAt IS NULL')
        .orderBy('r.endsAt', 'ASC')
        .take(LOTE)
        .getMany(),
    )

    let tratadas = 0

    for (const resgate of cortesias) {
      const fim = resgate.endsAt as Date
      const dias = Math.ceil((fim.getTime() - agora.getTime()) / 86_400_000)

      const passo = passoDaCortesia(dias, resgate.warnedStage)
      if (!passo) continue

      try {
        await this.tratarCortesia(resgate, fim, dias, passo)
      } catch (error) {
        this.logger.warn(
          { tenantId: resgate.tenantId, err: error },
          'falha ao tratar esta cortesia',
        )
        continue
      }

      tratadas += 1
    }

    return tratadas
  }

  private async tratarCortesia(
    resgate: CouponRedemption,
    fim: Date,
    dias: number,
    passo: { estagio: number; acao: 'avisar' | 'encerrar' },
  ): Promise<void> {
    await this.systemScope.run('jobs.billing.cortesia', async (manager) => {
        const conta = await manager
          .getRepository(Tenant)
          .findOneOrFail({ where: { id: resgate.tenantId } })

        if (passo.acao === 'encerrar') {
          await this.encerrarCortesia(manager, conta, resgate)
          return
        }

        await this.notificar(manager, conta, (nome) =>
          cortesiaTerminando({
            nome,
            conta: conta.name,
            dias: Math.max(0, dias),
            termina: fim,
            url: this.urlDePlanos(),
          }),
        )

        await manager
          .getRepository(CouponRedemption)
          .update(resgate.id, { warnedStage: passo.estagio })
    })
  }

  private async encerrarCortesia(
    manager: EntityManager,
    conta: Tenant,
    resgate: CouponRedemption,
  ): Promise<void> {
    await this.cupons.encerrarCortesia(manager, resgate)

    const assinatura = await manager
      .getRepository(Subscription)
      .findOne({ where: { tenantId: conta.id } })

    if (assinatura) {
      await manager
        .getRepository(Subscription)
        .update(assinatura.id, { status: SubscriptionStatus.SUSPENDED, currentPeriodEnd: null })

      // A conta vai para EXPIRED, e não para SUSPENDED: cortesia que acaba é
      // como teste que acaba — ninguém deixou de pagar. É esta linha que decide
      // se o cliente lê "escolha um plano" ou uma acusação de inadimplência que
      // não houve. `sincronizarConta` preserva o EXPIRED (ver `statusDaConta`).
      await manager.getRepository(Tenant).update(conta.id, { status: TenantStatus.EXPIRED })

      await this.statusService.sincronizarConta(
        manager,
        await manager.getRepository(Subscription).findOneOrFail({ where: { id: assinatura.id } }),
      )
    }

    await this.notificar(manager, conta, (nome) =>
      cortesiaEncerrada({ nome, conta: conta.name, url: this.urlDePlanos() }),
    )

    this.logger.log(
      { tenantId: conta.id },
      'cortesia encerrada — conta em somente leitura até assinar',
    )
  }

  private async notificar(
    manager: EntityManager,
    conta: Tenant,
    conteudo: (nome: string) => Parameters<MailService['send']>[1],
  ): Promise<void> {
    const titulares = await destinatarios(manager, conta.id, PAPEIS_DE_COBRANCA)
    for (const titular of titulares) {
      await this.mail.send(titular.email, conteudo(titular.name))
    }
  }

  private urlDePlanos(): string {
    return `${this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '')}/planos`
  }

  private async fecharCancelada(
    manager: EntityManager,
    assinatura: Subscription,
  ): Promise<boolean> {
    if (assinatura.status !== SubscriptionStatus.CANCELED) return false

    // A conta ficava ACTIVE até aqui — era o período já pago. Agora vira
    // somente leitura, com todo o histórico preservado.
    const recarregada = await manager
      .getRepository(Subscription)
      .findOneOrFail({ where: { id: assinatura.id } })

    await this.statusService.sincronizarConta(manager, recarregada)
    return true
  }
}

/**
 * O que fazer com uma cortesia hoje, ou `null` quando não há nada a fazer.
 *
 * Mesma ideia da régua do dunning: o estágio já dado é o que impede a repetição,
 * e quem passou direto por um aviso (job parado, cortesia curta) recebe o que
 * faz sentido agora, e não a fila de avisos atrasados.
 */
export function passoDaCortesia(
  diasRestantes: number,
  estagioAtual: number,
): { estagio: number; acao: 'avisar' | 'encerrar' } | null {
  if (diasRestantes <= 0) return { estagio: 3, acao: 'encerrar' }
  if (diasRestantes <= 1 && estagioAtual < 2) return { estagio: 2, acao: 'avisar' }
  if (diasRestantes <= 3 && estagioAtual < 1) return { estagio: 1, acao: 'avisar' }
  return null
}

/**
 * `2026-08-26T14` — a janela de um job horário. No fuso do produto, como o
 * `chaveDoDia`, para que a leitura do histórico em `job_runs` bata com o
 * horário que as pessoas usam.
 */
export function chaveDaHora(data: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(data)

  const pegar = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00'
  return `${pegar('year')}-${pegar('month')}-${pegar('day')}T${pegar('hour')}`
}

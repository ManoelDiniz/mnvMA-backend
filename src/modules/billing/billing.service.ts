import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EntityManager } from 'typeorm'
import { RequestContext } from '../../common/context/request-context'
import { fromCents } from '../../common/database/decimal.transformer'
import {
  SubscriptionStatus,
  TenantStatus,
  TenantType,
  WRITABLE_TENANT_STATUSES,
} from '../../common/enums/tenant.enum'
import type { Env } from '../../config/env'
import { destinatarios, PAPEIS_DE_COBRANCA } from '../jobs/destinatarios'
import { MailService } from '../mail/mail.service'
import { assinaturaCancelada, cortesiaAtivada } from '../mail/templates'
import { Tenant } from '../tenants/entities/tenant.entity'
import { User } from '../users/entities/user.entity'
import {
  CheckoutDto,
  PlanDto,
  SubscriptionDto,
  SubscriptionPaymentDto,
  type CancelSubscriptionDto,
} from './dto/billing.dto'
import {
  CORTESIA,
  CouponsService,
  adicionarMeses,
  precoComDesconto,
} from './coupons.service'
import type { ActiveDiscountDto, CouponPreviewDto, PreviewCouponDto } from './dto/coupon.dto'
import { CouponRedemption, CouponRedemptionStatus } from './entities/coupon-redemption.entity'
import { Coupon } from './entities/coupon.entity'
import { Plan } from './entities/plan.entity'
import { SubscriptionPayment } from './entities/subscription-payment.entity'
import { Subscription } from './entities/subscription.entity'
import { MercadoPagoClient } from './mercadopago/mercadopago.client'
import { PlanLimitsService, type UsoAtual } from './plan-limits.service'
import { SubscriptionStatusService, periodoAindaVale } from './subscription-status.service'

/** Quantas cobranças a tela de assinatura mostra. */
const EXTRATO_PADRAO = 12

/**
 * A assinatura vista de dentro da conta.
 *
 * Tudo aqui roda no contexto de um request autenticado, então usa o
 * `EntityManager` da transação — é ele que carrega `@mnvma_tenant_id` e faz as
 * travas do banco valerem. O caminho de fora (webhook, job) é o outro arquivo:
 * `webhook-processor.service.ts`.
 *
 * Uma regra atravessa este arquivo inteiro: **nada aqui ativa conta**. Assinar
 * cria a intenção e devolve a URL do checkout; quem coloca a conta em `ACTIVE`
 * é o webhook, depois de conferir a assinatura HMAC. Ativar pelo retorno do
 * navegador seria transformar a URL de retorno em botão de "produto de graça".
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name)

  constructor(
    private readonly mp: MercadoPagoClient,
    private readonly limites: PlanLimitsService,
    private readonly statusService: SubscriptionStatusService,
    private readonly cupons: CouponsService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get manager(): EntityManager {
    return RequestContext.manager()
  }

  private get tenantId(): string {
    return RequestContext.tenantId()
  }

  // ─── Catálogo ───────────────────────────────────────────────────────────────

  async planos(): Promise<PlanDto[]> {
    const conta = await this.conta()
    const assinatura = await this.assinaturaOuNulo()
    const uso = await this.limites.uso(conta.id, this.manager)

    const planos = await this.manager.getRepository(Plan).find({
      where: { tenantType: conta.type, isActive: true },
      order: { sortOrder: 'ASC' },
    })

    return planos.map((plano) => this.paraPlanoDto(plano, assinatura?.planId ?? null, uso))
  }

  // ─── Assinatura da conta ────────────────────────────────────────────────────

  async assinatura(): Promise<SubscriptionDto> {
    const conta = await this.conta()
    const assinatura = await this.assinaturaOuCriar(conta)
    const uso = await this.limites.uso(conta.id, this.manager)

    const ultimo = await this.manager.getRepository(SubscriptionPayment).findOne({
      where: { tenantId: conta.id, subscriptionId: assinatura.id },
      order: { createdAt: 'DESC' },
    })

    const pendente = assinatura.pendingPlanId
      ? await this.manager.getRepository(Plan).findOne({ where: { id: assinatura.pendingPlanId } })
      : null

    const resgate = await this.cupons.emVigor(this.manager, conta.id)

    return {
      id: assinatura.id,
      status: assinatura.status,
      tenantStatus: conta.status,
      plan: assinatura.plan ? this.paraPlanoDto(assinatura.plan, assinatura.planId, uso) : null,
      pendingPlan: pendente ? this.paraPlanoDto(pendente, assinatura.planId, uso) : null,
      trialEndsAt: conta.trialEndsAt ?? null,
      trialDaysLeft: diasDeTesteRestantes(conta),
      currentPeriodEnd: assinatura.currentPeriodEnd ?? null,
      nextChargeAt: assinatura.nextChargeAt ?? null,
      canceledAt: assinatura.canceledAt ?? null,
      pastDueSince: assinatura.pastDueSince ?? null,
      writable: WRITABLE_TENANT_STATUSES.includes(conta.status),
      checkoutUrl: this.checkoutEmAberto(assinatura),
      providerReady: this.mp.enabled,
      usage: uso,
      lastPayment: ultimo ? paraPagamentoDto(ultimo) : null,
      discount: resgate ? paraDescontoDto(resgate) : null,
    }
  }

  async pagamentos(limite = EXTRATO_PADRAO): Promise<SubscriptionPaymentDto[]> {
    const pagamentos = await this.manager.getRepository(SubscriptionPayment).find({
      where: { tenantId: this.tenantId },
      order: { createdAt: 'DESC' },
      take: Math.min(limite, 100),
    })

    return pagamentos.map(paraPagamentoDto)
  }

  // ─── Assinar, trocar de plano, cancelar ─────────────────────────────────────

  /**
   * Ponto único de entrada para "quero este plano".
   *
   * Três caminhos, e a diferença entre eles é o que a conta já tem:
   *
   *   • sem assinatura no provedor → cria o checkout e manda o navegador
   *   • com assinatura valendo e plano mais caro → muda o valor na hora
   *   • com assinatura valendo e plano mais barato → agenda para a virada
   *
   * O terceiro é o que evita o suporte de segunda-feira: quem paga R$ 349 até
   * o dia 30 e escolhe o plano de R$ 149 no dia 3 não pode perder os limites do
   * plano maior no dia 3, nem ser cobrado de novo.
   */
  async assinar(planId: string, userId: string, couponCode?: string): Promise<CheckoutDto> {
    const conta = await this.conta()
    const assinatura = await this.assinaturaOuCriar(conta)
    const plano = await this.planoValido(planId, conta.type)

    const uso = await this.limites.uso(conta.id, this.manager)
    const excedidos = this.limites.naoCabe(plano, uso)
    if (excedidos.length > 0) {
      throw new ConflictException({
        code: 'PLANO_NAO_COMPORTA_USO',
        message: `Este plano não comporta o uso atual: ${this.limites.explicar(excedidos)}.`,
        exceeded: excedidos,
      })
    }

    // Plano gratuito não existe no provedor: é só estado nosso.
    if (plano.priceCents === 0) return this.aplicarPlanoGratuito(assinatura, plano)

    const jaValendo =
      Boolean(assinatura.mpPreapprovalId) &&
      (assinatura.status === SubscriptionStatus.ACTIVE ||
        assinatura.status === SubscriptionStatus.PAST_DUE)

    if (couponCode && jaValendo) {
      // Cupom entra na contratação, não no meio do ciclo. Aplicar desconto numa
      // assinatura que já está cobrando exigiria mexer no valor a meio período
      // e acertar a proporção com o provedor — trabalho e risco para um caso
      // que, na prática, é "peça para o suporte".
      throw new ConflictException({
        code: 'CUPOM_ASSINATURA_ATIVA',
        message:
          'Cupons valem na contratação. Sua assinatura já está ativa — fale com o suporte para aplicar um desconto.',
      })
    }

    const cupom = couponCode
      ? await this.cupons.avaliar(this.manager, {
          codigo: couponCode,
          conta,
          usuario: await this.usuario(userId),
          plano,
        })
      : null

    if (!plano.mpPreapprovalPlanId && !this.mp.enabled) {
      throw new BadRequestException({
        code: 'BILLING_NAO_CONFIGURADO',
        message:
          'A cobrança ainda não está configurada neste ambiente. Fale com o suporte do MNVMA.',
      })
    }

    // Cortesia (100%): não existe o que cobrar, então não existe checkout nem
    // cartão. A conta liga aqui mesmo e vale até o fim dos ciclos combinados.
    if (cupom && cupom.discountPercent >= CORTESIA) {
      return this.aplicarCortesia(assinatura, plano, conta, userId, cupom)
    }

    if (jaValendo) return this.trocarDePlano(assinatura, plano)

    return this.abrirCheckout(assinatura, plano, conta, userId, cupom)
  }

  /**
   * Simula o cupom sem gastá-lo.
   *
   * A tela chama isto quando a pessoa termina de digitar o código, e é a mesma
   * validação do resgate — o que evita o pior: mostrar "50% de desconto" e
   * depois recusar na hora de assinar.
   */
  async previewCupom(dto: PreviewCouponDto): Promise<CouponPreviewDto> {
    const conta = await this.conta()
    const plano = await this.planoValido(dto.planId, conta.type)
    const usuario = await this.usuario(RequestContext.get().userId ?? '')

    const cupom = await this.cupons.avaliar(this.manager, {
      codigo: dto.code,
      conta,
      usuario,
      plano,
    })

    return montarPreview(cupom, plano)
  }

  async cancelar(dto: CancelSubscriptionDto): Promise<SubscriptionDto> {
    const conta = await this.conta()
    const assinatura = await this.assinaturaOuCriar(conta)

    if (assinatura.status === SubscriptionStatus.CANCELED) {
      throw new ConflictException({
        code: 'ASSINATURA_JA_CANCELADA',
        message: 'Esta assinatura já está cancelada.',
      })
    }

    if (assinatura.mpPreapprovalId) {
      await this.mp.atualizarPreapproval(assinatura.mpPreapprovalId, { status: 'cancelled' })
    }

    await this.manager.getRepository(Subscription).update(assinatura.id, {
      status: SubscriptionStatus.CANCELED,
      canceledAt: new Date(),
      pendingPlanId: null,
      checkoutUrl: null,
    })

    const atualizada = await this.recarregar(assinatura.id)
    // A conta continua ACTIVE até o fim do período já pago — ver
    // `statusDaConta`. Cancelar no dia 3 não pode apagar o mês pago.
    await this.statusService.sincronizarConta(this.manager, atualizada)

    await this.avisarCancelamento(conta, atualizada)

    this.logger.log(
      { tenantId: conta.id, motivo: dto.reason ?? null, ate: atualizada.currentPeriodEnd },
      'assinatura cancelada pelo cliente',
    )

    return this.assinatura()
  }

  /**
   * Reconsulta o provedor e aplica o que ele disser.
   *
   * É a rede de segurança do usuário: a tela de retorno do checkout chama isto
   * enquanto espera o webhook, e quem pagou e viu a conta ainda bloqueada tem
   * um botão que resolve sem abrir chamado. A fonte da verdade continua sendo
   * o `GET` no provedor, nunca o que o navegador trouxe na URL.
   */
  async sincronizar(): Promise<SubscriptionDto> {
    const conta = await this.conta()
    const assinatura = await this.assinaturaOuCriar(conta)

    if (!assinatura.mpPreapprovalId || !this.mp.enabled) return this.assinatura()

    const remoto = await this.mp.buscarPreapproval(assinatura.mpPreapprovalId)
    const traduzido = traduzirStatus(remoto.status)

    if (traduzido && traduzido !== assinatura.status) {
      await this.manager.getRepository(Subscription).update(assinatura.id, {
        status: traduzido,
        nextChargeAt: remoto.next_payment_date ? new Date(remoto.next_payment_date) : null,
        ...(traduzido === SubscriptionStatus.ACTIVE
          ? { pastDueSince: null, dunningStage: 0, checkoutUrl: null }
          : {}),
      })

      await this.statusService.sincronizarConta(this.manager, await this.recarregar(assinatura.id))
    }

    return this.assinatura()
  }

  // ─── Caminhos internos ──────────────────────────────────────────────────────

  private async abrirCheckout(
    assinatura: Subscription,
    plano: Plan,
    conta: Tenant,
    userId: string,
    cupom: Coupon | null,
  ): Promise<CheckoutDto> {
    const usuario = await this.usuario(userId)

    // O resgate vem ANTES da chamada ao provedor de propósito: se o teto do
    // cupom tiver acabado no meio do caminho, a recusa acontece sem gastar uma
    // assinatura pendente lá fora. E, como tudo isto roda na transação da
    // requisição, uma falha no provedor desfaz o resgate junto.
    if (cupom) {
      await this.cupons.resgatar(this.manager, {
        codigo: cupom.code,
        conta,
        usuario,
        plano,
        subscriptionId: assinatura.id,
      })
    }

    const precoCentavos = cupom
      ? precoComDesconto(plano.priceCents, cupom.discountPercent)
      : plano.priceCents

    const corpo: Record<string, unknown> = {
      reason: `MNVMA Care — ${plano.name}`,
      // A ponte entre os dois mundos. Sem isto, o webhook chega com um id do
      // provedor e não há como saber de quem ele é.
      external_reference: assinatura.id,
      payer_email: usuario.email,
      back_url: this.mp.backUrl,
      status: 'pending',
    }

    if (plano.mpPreapprovalPlanId && !cupom) {
      corpo.preapproval_plan_id = plano.mpPreapprovalPlanId
    } else {
      // Com cupom, o plano espelhado no provedor NÃO serve: ele carrega o preço
      // cheio, e usar os dois juntos cobraria o valor sem desconto. O valor vai
      // explícito, e é ele que o provedor cobra.
      //
      // Sem cupom e sem plano espelhado, é o mesmo caminho com o valor cru —
      // funciona, mas perde o `free_trial` do plano, e é por isso que o
      // `npm run seed:mp` existe.
      corpo.auto_recurring = {
        frequency: plano.intervalCount,
        frequency_type: plano.interval,
        transaction_amount: Number(fromCents(BigInt(precoCentavos))),
        currency_id: 'BRL',
      }
    }

    const notificacao = this.mp.notificationUrl
    if (notificacao) corpo.notification_url = notificacao

    const criada = await this.mp.criarPreapproval(corpo, chaveDeIdempotencia(assinatura, plano))

    const url = criada.init_point ?? criada.sandbox_init_point ?? null
    if (!url) {
      throw new BadRequestException({
        code: 'CHECKOUT_SEM_URL',
        message: 'O Mercado Pago não devolveu a URL do checkout. Tente de novo.',
      })
    }

    await this.manager.getRepository(Subscription).update(assinatura.id, {
      planId: plano.id,
      mpPreapprovalId: criada.id,
      checkoutUrl: url,
      pendingPlanId: null,
    })

    this.logger.log(
      {
        tenantId: conta.id,
        planId: plano.id,
        preapproval: criada.id,
        cupom: cupom?.code ?? null,
        centavos: precoCentavos,
      },
      'checkout de assinatura criado',
    )

    return {
      checkoutUrl: url,
      applied: false,
      message: cupom
        ? `Cupom ${cupom.code} aplicado: ${cupom.discountPercent}% de desconto ${descreverDuracao(cupom.maxInvoices)}.`
        : null,
      subscriptionId: assinatura.id,
      // Continua no estado atual: só o webhook ativa.
      status: assinatura.status,
    }
  }

  /**
   * Cortesia: 100% de desconto.
   *
   * O caminho é outro, não uma variação do checkout — com desconto total não
   * existe valor a cobrar, e o provedor sequer aceita uma assinatura de R$ 0.
   * Então não há checkout, não há cartão e não há webhook: a conta liga aqui e
   * o prazo é o que a limita. Quando ele acaba, o job de cobrança encerra e a
   * conta volta a precisar de plano, como no fim do teste.
   */
  private async aplicarCortesia(
    assinatura: Subscription,
    plano: Plan,
    conta: Tenant,
    userId: string,
    cupom: Coupon,
  ): Promise<CheckoutDto> {
    const usuario = await this.usuario(userId)

    const resgate = await this.cupons.resgatar(this.manager, {
      codigo: cupom.code,
      conta,
      usuario,
      plano,
      subscriptionId: assinatura.id,
    })

    // Assinatura paga anterior não pode continuar cobrando por baixo de uma
    // cortesia — seria cobrar de quem acabou de ganhar de graça.
    if (assinatura.mpPreapprovalId) {
      await this.mp.atualizarPreapproval(assinatura.mpPreapprovalId, { status: 'cancelled' })
    }

    const fim = await this.cupons.ativarCortesia(this.manager, resgate, plano)

    await this.manager.getRepository(Subscription).update(assinatura.id, {
      planId: plano.id,
      status: SubscriptionStatus.ACTIVE,
      mpPreapprovalId: null,
      checkoutUrl: null,
      pendingPlanId: null,
      currentPeriodEnd: fim,
      nextChargeAt: null,
      canceledAt: null,
      pastDueSince: null,
      dunningStage: 0,
    })

    const atualizada = await this.recarregar(assinatura.id)
    await this.statusService.sincronizarConta(this.manager, atualizada)

    await this.avisar(conta, (nome) =>
      cortesiaAtivada({
        nome,
        conta: conta.name,
        plano: plano.name,
        cupom: cupom.code,
        ate: fim,
        url: this.urlDaAssinatura(),
      }),
    )

    this.logger.log(
      { tenantId: conta.id, cupom: cupom.code, ate: fim },
      'cortesia ativada — conta liberada sem cobrança',
    )

    return {
      checkoutUrl: null,
      applied: true,
      message: `Cupom ${cupom.code} aplicado: ${plano.name} liberado sem cobrança até ${formatarDataCurta(fim)}. Não é preciso cadastrar cartão.`,
      subscriptionId: assinatura.id,
      status: SubscriptionStatus.ACTIVE,
    }
  }

  private async trocarDePlano(assinatura: Subscription, plano: Plan): Promise<CheckoutDto> {
    const atual = assinatura.plan
    if (atual && atual.id === plano.id && !assinatura.pendingPlanId) {
      throw new ConflictException({
        code: 'PLANO_JA_ATIVO',
        message: 'Sua assinatura já está neste plano.',
      })
    }

    const upgrade = !atual || plano.priceCents >= atual.priceCents

    if (!upgrade) {
      await this.manager
        .getRepository(Subscription)
        .update(assinatura.id, { pendingPlanId: plano.id })

      const quando = assinatura.currentPeriodEnd
      return {
        checkoutUrl: null,
        applied: true,
        message: quando
          ? `Plano alterado para ${plano.name} a partir de ${quando.toLocaleDateString('pt-BR')}. Até lá continua valendo o plano atual, que você já pagou.`
          : `Plano alterado para ${plano.name} na virada do período. Até lá continua valendo o plano atual.`,
        subscriptionId: assinatura.id,
        status: assinatura.status,
      }
    }

    // Upgrade vale na hora: quem precisa de mais cuidadores precisa hoje.
    if (assinatura.mpPreapprovalId) {
      await this.mp.atualizarPreapproval(assinatura.mpPreapprovalId, {
        auto_recurring: {
          transaction_amount: Number(fromCents(BigInt(plano.priceCents))),
          currency_id: 'BRL',
        },
      })
    }

    await this.manager
      .getRepository(Subscription)
      .update(assinatura.id, { planId: plano.id, pendingPlanId: null })

    return {
      checkoutUrl: null,
      applied: true,
      message: `Plano alterado para ${plano.name}. A diferença entra na próxima cobrança.`,
      subscriptionId: assinatura.id,
      status: assinatura.status,
    }
  }

  private async aplicarPlanoGratuito(assinatura: Subscription, plano: Plan): Promise<CheckoutDto> {
    if (assinatura.mpPreapprovalId) {
      // Descer para o gratuito é cancelar a cobrança recorrente. Deixar a
      // assinatura viva no provedor cobraria mês que ninguém pediu.
      await this.mp.atualizarPreapproval(assinatura.mpPreapprovalId, { status: 'cancelled' })
    }

    await this.manager.getRepository(Subscription).update(assinatura.id, {
      planId: plano.id,
      status: SubscriptionStatus.ACTIVE,
      mpPreapprovalId: null,
      pendingPlanId: null,
      checkoutUrl: null,
      pastDueSince: null,
      dunningStage: 0,
      canceledAt: null,
    })

    const atualizada = await this.recarregar(assinatura.id)
    await this.statusService.sincronizarConta(this.manager, atualizada)

    return {
      checkoutUrl: null,
      applied: true,
      message: `Plano ${plano.name} ativado.`,
      subscriptionId: assinatura.id,
      status: SubscriptionStatus.ACTIVE,
    }
  }

  /**
   * Confirmação por e-mail do cancelamento.
   *
   * Não é formalidade: o cliente precisa de prova de que pediu e de até quando
   * ainda tem acesso. Sem isso, a próxima conversa é "cancelei e continuei
   * sendo cobrado" contra "cancelou e não avisamos", sem registro dos dois lados.
   */
  private async avisarCancelamento(conta: Tenant, assinatura: Subscription): Promise<void> {
    await this.avisar(conta, (nome) =>
      assinaturaCancelada({
        nome,
        conta: conta.name,
        ate: periodoAindaVale(assinatura) ? (assinatura.currentPeriodEnd ?? null) : null,
        url: this.urlDaAssinatura(),
      }),
    )
  }

  /** Manda para os titulares da conta — quem responde por dinheiro. */
  private async avisar(
    conta: Tenant,
    conteudo: (nome: string) => Parameters<MailService['send']>[1],
  ): Promise<void> {
    const titulares = await destinatarios(this.manager, conta.id, PAPEIS_DE_COBRANCA)
    for (const titular of titulares) {
      await this.mail.send(titular.email, conteudo(titular.name))
    }
  }

  private urlDaAssinatura(): string {
    return `${this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '')}/assinatura`
  }

  private usuario(userId: string): Promise<User> {
    return this.manager.getRepository(User).findOneOrFail({ where: { id: userId } })
  }

  // ─── Consultas de apoio ─────────────────────────────────────────────────────

  private conta(): Promise<Tenant> {
    return this.manager.getRepository(Tenant).findOneOrFail({ where: { id: this.tenantId } })
  }

  private assinaturaOuNulo(): Promise<Subscription | null> {
    return this.manager.getRepository(Subscription).findOne({ where: { tenantId: this.tenantId } })
  }

  /**
   * A assinatura existe desde o cadastro — mas contas criadas antes do catálogo
   * de planos existir ficaram sem (ver `createTrialSubscription`). Em vez de
   * fazer a tela quebrar para elas, cria-se agora, no primeiro acesso.
   */
  private async assinaturaOuCriar(conta: Tenant): Promise<Subscription> {
    const existente = await this.assinaturaOuNulo()
    if (existente) return existente

    const plano = await this.manager.getRepository(Plan).findOne({
      where: { tenantType: conta.type, isActive: true },
      order: { sortOrder: 'ASC' },
    })

    if (!plano) {
      throw new NotFoundException({
        code: 'SEM_CATALOGO_DE_PLANOS',
        message: 'Nenhum plano cadastrado para este tipo de conta. Rode `npm run seed`.',
      })
    }

    const repo = this.manager.getRepository(Subscription)
    const criada = await repo.save(
      repo.create({
        tenantId: conta.id,
        planId: plano.id,
        status:
          conta.status === TenantStatus.TRIAL
            ? SubscriptionStatus.TRIAL
            : SubscriptionStatus.SUSPENDED,
        currentPeriodEnd: conta.trialEndsAt ?? null,
      }),
    )

    return this.recarregar(criada.id)
  }

  private recarregar(id: string): Promise<Subscription> {
    return this.manager.getRepository(Subscription).findOneOrFail({ where: { id } })
  }

  private async planoValido(planId: string, tipo: TenantType): Promise<Plan> {
    const plano = await this.manager.getRepository(Plan).findOne({ where: { id: planId } })

    if (!plano || !plano.isActive) {
      throw new NotFoundException({ code: 'PLANO_NAO_ENCONTRADO', message: 'Plano indisponível.' })
    }

    if (plano.tenantType !== tipo) {
      // Individual não assina plano empresarial e vice-versa: os módulos
      // liberados são outros, e a migração entre os dois é um caminho próprio.
      throw new BadRequestException({
        code: 'PLANO_DE_OUTRO_TIPO',
        message: 'Este plano é de outro tipo de conta.',
      })
    }

    return plano
  }

  private checkoutEmAberto(assinatura: Subscription): string | null {
    // Checkout só interessa enquanto a assinatura não está valendo.
    if (assinatura.status === SubscriptionStatus.ACTIVE) return null
    return assinatura.checkoutUrl ?? null
  }

  private paraPlanoDto(plano: Plan, planoAtualId: string | null, uso: UsoAtual): PlanDto {
    const excedidos = this.limites.naoCabe(plano, uso)

    return {
      id: plano.id,
      code: plano.code,
      name: plano.name,
      description: plano.description ?? null,
      tenantType: plano.tenantType,
      priceCents: plano.priceCents,
      price: fromCents(BigInt(plano.priceCents)),
      interval: plano.interval,
      trialDays: plano.trialDays,
      limits: {
        maxCustomers: plano.maxCustomers ?? null,
        maxCaregivers: plano.maxCaregivers ?? null,
        maxShiftsPerMonth: plano.maxShiftsPerMonth ?? null,
        maxUsers: plano.maxUsers ?? null,
      },
      features: plano.features ?? {},
      current: plano.id === planoAtualId,
      available: excedidos.length === 0,
      blockedReason: this.limites.explicar(excedidos),
      checkoutAvailable: plano.priceCents === 0 || this.mp.enabled,
    }
  }
}

// ─── Funções puras ────────────────────────────────────────────────────────────

/**
 * A chave que impede um timeout de virar duas assinaturas no provedor.
 *
 * Ela precisa ser estável dentro de uma tentativa (as retentativas internas do
 * cliente HTTP reutilizam a mesma) e diferente entre tentativas distintas — daí
 * o `updatedAt` entrar na composição. Sem ele, quem foi suspenso e volta a
 * assinar o MESMO plano receberia do Mercado Pago a resposta guardada da
 * primeira vez: um checkout já cancelado, que não cobra nada e não ativa nada.
 */
export function chaveDeIdempotencia(assinatura: Subscription, plano: Plan): string {
  const versao = Math.floor((assinatura.updatedAt?.getTime() ?? 0) / 1000)
  return `sub-${assinatura.id}-${plano.id}-${versao}`
}

function traduzirStatus(status: string | undefined): SubscriptionStatus | null {
  const mapa: Record<string, SubscriptionStatus> = {
    authorized: SubscriptionStatus.ACTIVE,
    paused: SubscriptionStatus.PAST_DUE,
    cancelled: SubscriptionStatus.CANCELED,
  }
  return status ? (mapa[status] ?? null) : null
}

/** "50% nas 3 primeiras faturas" — a frase que a tela mostra. */
export function descreverDuracao(faturas: number): string {
  if (faturas <= 1) return 'na primeira fatura'
  return `nas ${faturas} primeiras faturas`
}

export function montarPreview(cupom: Coupon, plano: Plan): CouponPreviewDto {
  const cortesia = cupom.discountPercent >= CORTESIA
  const comDesconto = precoComDesconto(plano.priceCents, cupom.discountPercent)
  const economiaPorFatura = plano.priceCents - comDesconto

  return {
    code: cupom.code,
    name: cupom.name,
    description: cupom.description ?? null,
    discountPercent: cupom.discountPercent,
    maxInvoices: cupom.maxInvoices,
    courtesy: cortesia,
    priceCents: plano.priceCents,
    discountedPriceCents: comDesconto,
    discountedPrice: fromCents(BigInt(comDesconto)),
    totalSavingsCents: economiaPorFatura * cupom.maxInvoices,
    summary: cortesia
      ? `${plano.name} liberado sem cobrança por ${cupom.maxInvoices} ${cupom.maxInvoices === 1 ? 'mês' : 'meses'} — sem cartão`
      : `${cupom.discountPercent}% de desconto ${descreverDuracao(cupom.maxInvoices)}`,
    requiresCheckout: !cortesia,
    courtesyEndsAt: cortesia
      ? adicionarMeses(new Date(), cupom.maxInvoices * Math.max(1, plano.intervalCount))
      : null,
  }
}

export function paraDescontoDto(resgate: CouponRedemption): ActiveDiscountDto {
  const cortesia = resgate.discountPercent >= CORTESIA
  const pendente = resgate.status === CouponRedemptionStatus.PENDING

  const resumo = cortesia
    ? resgate.endsAt
      ? `Cortesia de 100% até ${formatarDataCurta(resgate.endsAt)}`
      : 'Cortesia de 100%'
    : `${resgate.discountPercent}% de desconto — ${resgate.invoicesUsed} de ${resgate.maxInvoices} ${
        resgate.maxInvoices === 1 ? 'fatura usada' : 'faturas usadas'
      }`

  return {
    code: resgate.coupon?.code ?? '',
    discountPercent: resgate.discountPercent,
    maxInvoices: resgate.maxInvoices,
    invoicesUsed: resgate.invoicesUsed,
    courtesy: cortesia,
    status: resgate.status,
    endsAt: resgate.endsAt ?? null,
    summary: pendente ? `${resumo} (vale quando o pagamento for confirmado)` : resumo,
  }
}

function formatarDataCurta(data: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(data)
}

export function paraPagamentoDto(pagamento: SubscriptionPayment): SubscriptionPaymentDto {
  return {
    id: pagamento.id,
    status: pagamento.status,
    amount: pagamento.amount,
    currency: pagamento.currency,
    paymentMethod: pagamento.paymentMethod ?? null,
    statusDetail: pagamento.statusDetail ?? null,
    dueAt: pagamento.dueAt ?? null,
    paidAt: pagamento.paidAt ?? null,
    periodStart: pagamento.periodStart ?? null,
    periodEnd: pagamento.periodEnd ?? null,
    createdAt: pagamento.createdAt,
  }
}

function diasDeTesteRestantes(conta: Tenant): number {
  if (conta.status !== TenantStatus.TRIAL || !conta.trialEndsAt) return 0
  return Math.max(0, Math.ceil((conta.trialEndsAt.getTime() - Date.now()) / 86_400_000))
}

export { periodoAindaVale }

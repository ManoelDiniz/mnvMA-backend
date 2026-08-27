import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import { SystemScope } from '../../common/database/system-scope.service'
import { fromCents } from '../../common/database/decimal.transformer'
import { PageDto } from '../../common/dto/pagination.dto'
import { SubscriptionStatus, TenantStatus, TenantType } from '../../common/enums/tenant.enum'
import { ROLE_LABELS, UserRole } from '../../common/enums/user-role.enum'
import { TenantStatusCache } from '../../common/services/tenant-status.cache'
import {
  CouponRedemption,
  CouponRedemptionStatus,
} from '../billing/entities/coupon-redemption.entity'
import { Subscription } from '../billing/entities/subscription.entity'
import { PlanLimitsService } from '../billing/plan-limits.service'
import { Tenant } from '../tenants/entities/tenant.entity'
import { User } from '../users/entities/user.entity'
import { AdminAction, AdminActionType, ROTULO_ACAO } from './entities/admin-action.entity'
import type {
  AcaoAdministrativaDto,
  ContaDetalheDto,
  ContaResumoDto,
  ListarContasDto,
  MetricasDto,
} from './dto/admin.dto'

/**
 * Quem está fazendo a ação. Só o id, e ele vem do token — nunca do corpo da
 * requisição. O e-mail é resolvido aqui dentro, a partir do id: aceitar "quem
 * sou eu" do cliente transformaria o histórico administrativo em ficção.
 */
export interface Administrador {
  userId: string
}

/**
 * O MNVMA Core: o painel do dono do SaaS.
 *
 * Tudo aqui roda em `SystemScope`, e não por conveniência: estas consultas
 * atravessam contas por definição — "quantas empresas estão pagando" é uma
 * pergunta que não existe dentro de um tenant. Cada chamada declara o motivo e
 * vira log, que é o combinado do projeto para acesso cross-tenant.
 *
 * Duas regras que este serviço segue:
 *
 *   • **Ação que muda a vida do cliente exige motivo** e vira linha em
 *     `admin_actions`. Suspender uma conta que está pagando sem registrar quem
 *     fez e por quê é o tipo de coisa que ninguém consegue explicar depois.
 *   • **Nada aqui escreve dado de negócio do cliente.** O Core suspende,
 *     reativa e observa. Editar o cliente por dentro seria apagar a fronteira
 *     que o resto do sistema inteiro existe para manter.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name)

  constructor(
    private readonly systemScope: SystemScope,
    private readonly limites: PlanLimitsService,
    private readonly statusCache: TenantStatusCache,
  ) {}

  // ─── Métricas ───────────────────────────────────────────────────────────────

  /**
   * O painel de uma tela só.
   *
   * São várias perguntas independentes, e cada uma é um agregado sobre índice
   * que já existe. Carregar as entidades para contar em memória seria caro
   * justamente quando o negócio crescer — que é quando esta tela passa a ser
   * aberta todo dia.
   */
  async metricas(): Promise<MetricasDto> {
    return this.systemScope.run('admin.metricas', async (manager) => {
      const inicioDoMes = primeiroDiaDoMes()
      const emSeteDias = new Date(Date.now() + 7 * 86_400_000)

      const [contas] = await manager.query<
        Array<Record<string, string | number | null>>
      >(
        `SELECT
           COUNT(*)                                                        AS total,
           SUM(type = 'INDIVIDUAL')                                        AS individuais,
           SUM(type = 'COMPANY')                                           AS empresas,
           SUM(status = 'TRIAL')                                           AS trial,
           SUM(status = 'ACTIVE')                                          AS ativas,
           SUM(status = 'PAST_DUE')                                        AS atrasadas,
           SUM(status = 'SUSPENDED')                                       AS suspensas,
           SUM(status = 'EXPIRED')                                         AS expiradas,
           SUM(status = 'CANCELED')                                        AS canceladas,
           SUM(created_at >= ?)                                            AS novas,
           SUM(status = 'TRIAL' AND trial_ends_at IS NOT NULL AND trial_ends_at <= ?) AS testesTerminando
         FROM tenants
         WHERE deleted_at IS NULL`,
        [inicioDoMes, emSeteDias],
      )

      // MRR com o cupom aplicado: é o que vai ser cobrado no próximo ciclo, não
      // o preço de tabela. Contar a tabela infla a receita justamente durante
      // uma campanha de desconto — que é quando a métrica mais importa.
      const [receita] = await manager.query<Array<{ mrr: string | null; pagantes: string }>>(
        `SELECT
           SUM(CASE WHEN r.id IS NULL THEN p.price_cents
                    ELSE ROUND(p.price_cents * (100 - r.discount_percent) / 100)
               END) AS mrr,
           SUM(p.price_cents > 0) AS pagantes
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         LEFT JOIN coupon_redemptions r
           ON r.tenant_id = s.tenant_id AND r.status = 'ACTIVE' AND r.deleted_at IS NULL
         WHERE s.status = ? AND s.deleted_at IS NULL`,
        [SubscriptionStatus.ACTIVE],
      )

      const [cortesias] = await manager.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total FROM coupon_redemptions
          WHERE status = 'ACTIVE' AND discount_percent >= 100 AND deleted_at IS NULL`,
      )

      const [canceladas] = await manager.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total FROM subscriptions
          WHERE canceled_at IS NOT NULL AND canceled_at >= ?`,
        [inicioDoMes],
      )

      // Evento parado é dinheiro que talvez não tenha sido creditado. Fica no
      // painel porque é a métrica que ninguém pensa em olhar até doer.
      const [webhooks] = await manager.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total FROM webhook_events
          WHERE (processed_at IS NULL AND signature_ok = 1) OR orphan = 1`,
      )

      const mrrCents = Number(receita?.mrr ?? 0)

      return {
        contas: numero(contas?.total),
        pagantes: numero(receita?.pagantes),
        porStatus: {
          TRIAL: numero(contas?.trial),
          ACTIVE: numero(contas?.ativas),
          PAST_DUE: numero(contas?.atrasadas),
          SUSPENDED: numero(contas?.suspensas),
          EXPIRED: numero(contas?.expiradas),
          CANCELED: numero(contas?.canceladas),
        },
        individuais: numero(contas?.individuais),
        empresas: numero(contas?.empresas),
        mrrCents,
        mrr: fromCents(BigInt(mrrCents)),
        inadimplentes: numero(contas?.atrasadas) + numero(contas?.suspensas),
        cortesias: numero(cortesias?.total),
        novasNoMes: numero(contas?.novas),
        canceladasNoMes: numero(canceladas?.total),
        testesTerminando: numero(contas?.testesTerminando),
        webhooksPendentes: numero(webhooks?.total),
      }
    })
  }

  // ─── Contas ─────────────────────────────────────────────────────────────────

  async contas(query: ListarContasDto): Promise<PageDto<ContaResumoDto>> {
    return this.systemScope.run('admin.contas.listar', async (manager) => {
      const qb = manager
        .getRepository(Tenant)
        .createQueryBuilder('t')
        .leftJoin(Subscription, 's', 's.tenant_id = t.id AND s.deleted_at IS NULL')
        .leftJoin('plans', 'p', 'p.id = s.plan_id')
        .leftJoin(
          CouponRedemption,
          'r',
          "r.tenant_id = t.id AND r.status = 'ACTIVE' AND r.deleted_at IS NULL",
        )
        .leftJoin('coupons', 'c', 'c.id = r.coupon_id')
        .select('t.id', 'id')
        .addSelect('t.name', 'name')
        .addSelect('t.type', 'type')
        .addSelect('t.status', 'status')
        .addSelect('t.document', 'document')
        .addSelect('t.trial_ends_at', 'trialEndsAt')
        .addSelect('t.created_at', 'createdAt')
        .addSelect('p.name', 'planName')
        .addSelect('p.price_cents', 'priceCents')
        .addSelect('s.status', 'subscriptionStatus')
        .addSelect('r.discount_percent', 'discountPercent')
        .addSelect('c.code', 'couponCode')
        .where('t.deleted_at IS NULL')

      if (query.status) qb.andWhere('t.status = :status', { status: query.status })
      if (query.type) qb.andWhere('t.type = :type', { type: query.type })
      if (query.q) {
        qb.andWhere('(t.name LIKE :busca OR t.document LIKE :busca)', { busca: `%${query.q}%` })
      }

      const total = await qb.getCount()

      const linhas = await qb
        .orderBy('t.created_at', 'DESC')
        .offset(query.skip)
        .limit(query.perPage)
        .getRawMany<LinhaDeConta>()

      const dados = await Promise.all(
        linhas.map(async (linha) => this.montarResumo(manager, linha)),
      )

      return new PageDto(dados, total, query)
    })
  }

  async conta(id: string): Promise<ContaDetalheDto> {
    return this.systemScope.run('admin.contas.detalhe', async (manager) => {
      const conta = await manager.getRepository(Tenant).findOne({ where: { id } })
      if (!conta) {
        throw new NotFoundException({ code: 'CONTA_NAO_ENCONTRADA', message: 'Conta não encontrada.' })
      }

      const assinatura = await manager
        .getRepository(Subscription)
        .findOne({ where: { tenantId: id } })

      const usuarios = await manager.getRepository(User).find({
        where: { tenantId: id },
        order: { createdAt: 'ASC' },
      })

      const resgates = await manager
        .getRepository(CouponRedemption)
        .createQueryBuilder('r')
        .leftJoinAndSelect('r.coupon', 'c')
        .where('r.tenantId = :id', { id })
        .orderBy('r.redeemedAt', 'DESC')
        .getMany()

      const cobrancas = await manager.query<
        Array<{
          id: string
          status: string
          amount: string
          status_detail: string | null
          paid_at: Date | null
          created_at: Date
        }>
      >(
        `SELECT id, status, amount, status_detail, paid_at, created_at
           FROM subscription_payments
          WHERE tenant_id = ? AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 12`,
        [id],
      )

      const uso = await this.limites.uso(id, manager)
      const titular = usuarios.find((u) => u.role === UserRole.OWNER) ?? usuarios[0]
      const valendo = resgates.find((r) => r.status === CouponRedemptionStatus.ACTIVE)

      const resumo = await this.montarResumo(manager, {
        id: conta.id,
        name: conta.name,
        type: conta.type,
        status: conta.status,
        document: conta.document ?? null,
        trialEndsAt: conta.trialEndsAt ?? null,
        createdAt: conta.createdAt,
        planName: assinatura?.plan?.name ?? null,
        priceCents: assinatura?.plan?.priceCents ?? null,
        subscriptionStatus: assinatura?.status ?? null,
        discountPercent: valendo?.discountPercent ?? null,
        couponCode: valendo?.coupon?.code ?? null,
      })

      return {
        ...resumo,
        ownerEmail: titular?.email ?? null,
        usage: uso,
        currentPeriodEnd: assinatura?.currentPeriodEnd ?? null,
        nextChargeAt: assinatura?.nextChargeAt ?? null,
        pastDueSince: assinatura?.pastDueSince ?? null,
        canceledAt: assinatura?.canceledAt ?? null,
        usuarios: usuarios.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          roleLabel: ROLE_LABELS[u.role],
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt ?? null,
        })),
        cobrancas: cobrancas.map((c) => ({
          id: c.id,
          status: c.status,
          amount: c.amount,
          statusDetail: c.status_detail,
          paidAt: c.paid_at,
          createdAt: c.created_at,
        })),
        cupons: resgates.map((r) => ({
          code: r.coupon?.code ?? '—',
          discountPercent: r.discountPercent,
          maxInvoices: r.maxInvoices,
          invoicesUsed: r.invoicesUsed,
          status: r.status,
          endsAt: r.endsAt ?? null,
        })),
        historico: await this.historico(manager, id),
      }
    })
  }

  // ─── Ações ──────────────────────────────────────────────────────────────────

  /**
   * Suspende a conta de um cliente.
   *
   * Bloqueia a escrita e **não** a leitura, igual à suspensão por falta de
   * pagamento: mesmo numa suspensão manual — fraude, abuso, pedido do próprio
   * cliente — trancar alguém para fora do próprio histórico não resolve nada e
   * destrói a chance de reverter a situação.
   */
  async suspender(id: string, motivo: string, por: Administrador): Promise<ContaDetalheDto> {
    await this.systemScope.run('admin.contas.suspender', async (manager) => {
      const conta = await this.exigirConta(manager, id)

      await manager.getRepository(Tenant).update(conta.id, { status: TenantStatus.SUSPENDED })
      await manager
        .getRepository(Subscription)
        .update({ tenantId: conta.id }, { status: SubscriptionStatus.SUSPENDED })

      await this.registrar(manager, {
        action: AdminActionType.TENANT_SUSPEND,
        targetTenantId: conta.id,
        reason: motivo,
        por,
        metadata: { statusAnterior: conta.status },
      })

      this.statusCache.invalidate(conta.id)
      this.logger.warn(
        { tenantId: conta.id, por: por.userId, motivo },
        'conta suspensa pela administração',
      )
    })

    return this.conta(id)
  }

  /**
   * Reativa a conta.
   *
   * Volta para `ACTIVE` quando existe assinatura paga valendo; caso contrário
   * devolve ao teste ou ao estado de "precisa assinar". Não inventa período
   * pago: reativar não é presentear.
   */
  async reativar(id: string, motivo: string, por: Administrador): Promise<ContaDetalheDto> {
    await this.systemScope.run('admin.contas.reativar', async (manager) => {
      const conta = await this.exigirConta(manager, id)
      const assinatura = await manager
        .getRepository(Subscription)
        .findOne({ where: { tenantId: conta.id } })

      // `currentPeriodEnd` sozinho NÃO prova que existe período concedido: numa
      // assinatura em teste ele guarda o fim do teste. O que prova é haver uma
      // assinatura no provedor ou uma cortesia por cupom valendo — sem um dos
      // dois, reativar devolveria produto pago sem ninguém ter pago.
      const cortesia = await manager.getRepository(CouponRedemption).findOne({
        where: { tenantId: conta.id, status: CouponRedemptionStatus.ACTIVE },
      })

      const periodoConcedido = Boolean(
        assinatura?.currentPeriodEnd &&
          assinatura.currentPeriodEnd > new Date() &&
          (assinatura.mpPreapprovalId != null || cortesia != null),
      )

      const novoStatus = estadoAoReativar(conta, { periodoConcedido })

      await manager.getRepository(Tenant).update(conta.id, { status: novoStatus })

      if (assinatura && novoStatus === TenantStatus.ACTIVE) {
        await manager
          .getRepository(Subscription)
          .update(assinatura.id, { status: SubscriptionStatus.ACTIVE })
      }

      await this.registrar(manager, {
        action: AdminActionType.TENANT_REACTIVATE,
        targetTenantId: conta.id,
        reason: motivo,
        por,
        metadata: { statusAnterior: conta.status, statusNovo: novoStatus },
      })

      this.statusCache.invalidate(conta.id)
      this.logger.log(
        { tenantId: conta.id, por: por.userId, motivo, status: novoStatus },
        'conta reativada pela administração',
      )
    })

    return this.conta(id)
  }

  /** Grava a ação administrativa. Chamado por quem faz a ação, na mesma transação. */
  async registrar(
    manager: EntityManager,
    dados: {
      action: AdminActionType
      targetTenantId?: string | null
      reason?: string | null
      por: Administrador
      metadata?: Record<string, unknown>
    },
  ): Promise<void> {
    const autor = await manager
      .getRepository(User)
      .findOne({ where: { id: dados.por.userId } })

    const repo = manager.getRepository(AdminAction)
    await repo.save(
      repo.create({
        actorUserId: dados.por.userId,
        // Copiado agora: o usuário pode trocar de e-mail, e o histórico precisa
        // dizer quem era no dia da ação.
        actorEmail: autor?.email ?? null,
        action: dados.action,
        targetTenantId: dados.targetTenantId ?? null,
        reason: dados.reason ?? null,
        metadata: dados.metadata ?? null,
      }),
    )
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private async exigirConta(manager: EntityManager, id: string): Promise<Tenant> {
    const conta = await manager.getRepository(Tenant).findOne({ where: { id } })
    if (!conta) {
      throw new NotFoundException({ code: 'CONTA_NAO_ENCONTRADA', message: 'Conta não encontrada.' })
    }
    return conta
  }

  private async historico(
    manager: EntityManager,
    tenantId: string,
  ): Promise<AcaoAdministrativaDto[]> {
    const acoes = await manager.getRepository(AdminAction).find({
      where: { targetTenantId: tenantId },
      order: { createdAt: 'DESC' },
      take: 50,
    })

    return acoes.map((acao) => ({
      id: acao.id,
      action: acao.action,
      actionLabel: ROTULO_ACAO[acao.action as AdminActionType] ?? acao.action,
      actorEmail: acao.actorEmail ?? null,
      reason: acao.reason ?? null,
      createdAt: acao.createdAt,
    }))
  }

  private async montarResumo(
    manager: EntityManager,
    linha: LinhaDeConta,
  ): Promise<ContaResumoDto> {
    const [contagem] = await manager.query<Array<{ total: string; email: string | null }>>(
      `SELECT COUNT(*) AS total,
              MAX(CASE WHEN role = 'OWNER' THEN email END) AS email
         FROM users WHERE tenant_id = ? AND deleted_at IS NULL`,
      [linha.id],
    )

    const precoCheio = Number(linha.priceCents ?? 0)
    const desconto = linha.discountPercent === null ? 0 : Number(linha.discountPercent)

    return {
      id: linha.id,
      name: linha.name,
      type: linha.type,
      status: linha.status,
      document: linha.document,
      trialEndsAt: linha.trialEndsAt,
      planName: linha.planName,
      subscriptionStatus: linha.subscriptionStatus,
      monthlyCents: Math.round((precoCheio * (100 - desconto)) / 100),
      couponCode: linha.couponCode,
      users: Number(contagem?.total ?? 0),
      ownerEmail: contagem?.email ?? null,
      createdAt: linha.createdAt,
    }
  }
}

// ─── Tipos e funções puras ────────────────────────────────────────────────────

interface LinhaDeConta {
  id: string
  name: string
  type: TenantType
  status: TenantStatus
  document: string | null
  trialEndsAt: Date | null
  createdAt: Date
  planName: string | null
  priceCents: number | null
  subscriptionStatus: SubscriptionStatus | null
  discountPercent: number | null
  couponCode: string | null
}

/**
 * Para onde a conta volta quando a administração reativa.
 *
 * Reativar não é presentear. Sem período concedido — assinatura paga ou
 * cortesia valendo —, a conta volta para o teste, se ainda houver prazo, ou
 * para "precisa assinar". Devolver `ACTIVE` sem cobrança seria dar o produto de
 * graça por engano, e sem prazo para acabar.
 *
 * `periodoConcedido` chega pronto de propósito: descobri-lo exige olhar a
 * assinatura no provedor E os cupons, e uma função pura que faz consulta deixa
 * de ser testável exatamente onde importa.
 */
export function estadoAoReativar(
  conta: Tenant,
  opcoes: { periodoConcedido: boolean },
  agora = new Date(),
): TenantStatus {
  if (opcoes.periodoConcedido) return TenantStatus.ACTIVE

  const testeValendo = Boolean(conta.trialEndsAt && conta.trialEndsAt > agora)
  if (testeValendo) return TenantStatus.TRIAL

  return TenantStatus.EXPIRED
}

function numero(valor: string | number | null | undefined): number {
  return Number(valor ?? 0)
}

/** Começo do mês corrente, no formato que o MySQL aceita como parâmetro. */
function primeiroDiaDoMes(agora = new Date()): string {
  const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1))
  return inicio.toISOString().slice(0, 19).replace('T', ' ')
}

import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import { SystemScope } from '../../common/database/system-scope.service'
import { Tenant } from '../tenants/entities/tenant.entity'
import { CORTESIA, normalizarCodigo } from './coupons.service'
import type {
  CouponRedemptionResponseDto,
  CouponResponseDto,
  CouponTargetsDto,
  CreateCouponDto,
  UpdateCouponDto,
} from './dto/coupon.dto'
import { CouponRedemption, CouponRedemptionStatus } from './entities/coupon-redemption.entity'
import { CouponTarget } from './entities/coupon-target.entity'
import { Coupon } from './entities/coupon.entity'

/**
 * O lado do dono do SaaS: criar, ajustar e acompanhar cupons.
 *
 * Tudo aqui roda em `SystemScope` porque atravessa contas por natureza — a
 * lista de resgates de uma campanha é, por definição, de várias empresas
 * diferentes. Cada chamada declara o motivo e vira log, que é o combinado do
 * projeto para qualquer operação cross-tenant.
 *
 * Duas coisas que este serviço deliberadamente NÃO faz:
 *
 *   • **Não apaga cupom.** Desligar (`isActive = false`) fecha a porta para
 *     novos resgates e preserva quem já entrou. Apagar levaria junto o
 *     histórico de uma campanha e deixaria resgates apontando para o vazio.
 *   • **Não mexe em resgate para "ajustar" desconto.** O resgate é o
 *     combinado com o cliente. O que dá para fazer é cancelá-lo, e isso é
 *     visível no histórico.
 */
@Injectable()
export class CouponsAdminService {
  private readonly logger = new Logger(CouponsAdminService.name)

  constructor(private readonly systemScope: SystemScope) {}

  // ─── Cupom ──────────────────────────────────────────────────────────────────

  async criar(dto: CreateCouponDto, criadoPor: string): Promise<CouponResponseDto> {
    return this.systemScope.run('admin.cupons.criar', async (manager) => {
      const code = normalizarCodigo(dto.code)

      const existente = await manager.getRepository(Coupon).findOne({ where: { code } })
      if (existente) {
        throw new ConflictException({
          code: 'CUPOM_DUPLICADO',
          message: `Já existe um cupom com o código ${code}.`,
        })
      }

      const repo = manager.getRepository(Coupon)
      const cupom = await repo.save(
        repo.create({
          code,
          name: dto.name,
          description: dto.description ?? null,
          discountPercent: dto.discountPercent,
          maxInvoices: dto.maxInvoices ?? 1,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          maxRedemptions: dto.maxRedemptions ?? null,
          tenantType: dto.tenantType ?? null,
          firstSubscriptionOnly: dto.firstSubscriptionOnly ?? false,
          isActive: true,
          createdByUserId: criadoPor,
        }),
      )

      if (dto.targets) await this.gravarAlvos(manager, cupom.id, dto.targets)

      this.logger.log(
        {
          code,
          percentual: dto.discountPercent,
          faturas: dto.maxInvoices ?? 1,
          cortesia: dto.discountPercent >= CORTESIA,
          criadoPor,
        },
        'cupom criado',
      )

      return this.montar(manager, cupom.id)
    })
  }

  async listar(incluirInativos = true): Promise<CouponResponseDto[]> {
    return this.systemScope.run('admin.cupons.listar', async (manager) => {
      const cupons = await manager.getRepository(Coupon).find({
        where: incluirInativos ? {} : { isActive: true },
        order: { createdAt: 'DESC' },
        take: 200,
      })

      return Promise.all(cupons.map((cupom) => this.montar(manager, cupom.id, cupom)))
    })
  }

  async detalhe(id: string): Promise<CouponResponseDto> {
    return this.systemScope.run('admin.cupons.detalhe', (manager) => this.montar(manager, id))
  }

  async atualizar(id: string, dto: UpdateCouponDto): Promise<CouponResponseDto> {
    return this.systemScope.run('admin.cupons.atualizar', async (manager) => {
      const cupom = await this.buscar(manager, id)

      await manager.getRepository(Coupon).update(cupom.id, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.discountPercent !== undefined ? { discountPercent: dto.discountPercent } : {}),
        ...(dto.maxInvoices !== undefined ? { maxInvoices: dto.maxInvoices } : {}),
        ...(dto.startsAt !== undefined ? { startsAt: new Date(dto.startsAt) } : {}),
        ...(dto.expiresAt !== undefined ? { expiresAt: new Date(dto.expiresAt) } : {}),
        ...(dto.maxRedemptions !== undefined ? { maxRedemptions: dto.maxRedemptions } : {}),
        ...(dto.tenantType !== undefined ? { tenantType: dto.tenantType } : {}),
        ...(dto.firstSubscriptionOnly !== undefined
          ? { firstSubscriptionOnly: dto.firstSubscriptionOnly }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      })

      this.logger.log({ code: cupom.code, mudancas: Object.keys(dto) }, 'cupom atualizado')
      return this.montar(manager, cupom.id)
    })
  }

  /** Desligar é o "excluir" daqui: fecha para novos e preserva quem já entrou. */
  async desligar(id: string): Promise<CouponResponseDto> {
    return this.atualizar(id, { isActive: false })
  }

  // ─── Alvos ──────────────────────────────────────────────────────────────────

  async adicionarAlvos(id: string, dto: CouponTargetsDto): Promise<CouponResponseDto> {
    return this.systemScope.run('admin.cupons.alvos', async (manager) => {
      const cupom = await this.buscar(manager, id)
      await this.gravarAlvos(manager, cupom.id, dto)
      return this.montar(manager, cupom.id)
    })
  }

  /**
   * Tira alguém da lista.
   *
   * Só fecha a porta para quem ainda não resgatou: o resgate já feito continua
   * valendo, porque o combinado com aquela pessoa já aconteceu.
   */
  async removerAlvo(id: string, alvo: string): Promise<CouponResponseDto> {
    return this.systemScope.run('admin.cupons.remover-alvo', async (manager) => {
      const cupom = await this.buscar(manager, id)
      const valor = alvo.trim().toLowerCase()

      const removidos = await manager
        .getRepository(CouponTarget)
        .createQueryBuilder()
        .delete()
        .where('coupon_id = :couponId', { couponId: cupom.id })
        .andWhere('(email = :valor OR target_tenant_id = :alvo)', { valor, alvo: alvo.trim() })
        .execute()

      if (!removidos.affected) {
        throw new NotFoundException({
          code: 'ALVO_NAO_ENCONTRADO',
          message: 'Este e-mail ou conta não está na lista do cupom.',
        })
      }

      return this.montar(manager, cupom.id)
    })
  }

  // ─── Resgates ───────────────────────────────────────────────────────────────

  async resgates(id: string): Promise<CouponRedemptionResponseDto[]> {
    return this.systemScope.run('admin.cupons.resgates', async (manager) => {
      const cupom = await this.buscar(manager, id)

      const linhas = await manager
        .getRepository(CouponRedemption)
        .createQueryBuilder('r')
        .leftJoin(Tenant, 't', 't.id = r.tenantId')
        .addSelect('t.name', 'tenant_name')
        .where('r.couponId = :couponId', { couponId: cupom.id })
        .orderBy('r.redeemedAt', 'DESC')
        .getRawAndEntities<{ tenant_name: string | null }>()

      return linhas.entities.map((resgate, indice) => ({
        id: resgate.id,
        tenantId: resgate.tenantId,
        tenantName: linhas.raw[indice]?.tenant_name ?? '—',
        couponCode: cupom.code,
        status: resgate.status,
        discountPercent: resgate.discountPercent,
        maxInvoices: resgate.maxInvoices,
        invoicesUsed: resgate.invoicesUsed,
        redeemedAt: resgate.redeemedAt,
        activatedAt: resgate.activatedAt ?? null,
        endsAt: resgate.endsAt ?? null,
      }))
    })
  }

  /**
   * Cancela um resgate — e devolve a vaga ao teto do cupom.
   *
   * Serve para o caso concreto de alguém ter resgatado por engano, ou de uma
   * campanha nominal ter ido para a pessoa errada. Não mexe na assinatura: se o
   * desconto já estava valendo, é o job/webhook seguinte que devolve o valor
   * cheio, pelo mesmo caminho de quando o desconto se esgota naturalmente.
   */
  async cancelarResgate(couponId: string, redemptionId: string): Promise<void> {
    await this.systemScope.run('admin.cupons.cancelar-resgate', async (manager) => {
      const resgate = await manager
        .getRepository(CouponRedemption)
        .findOne({ where: { id: redemptionId, couponId } })

      if (!resgate) {
        throw new NotFoundException({
          code: 'RESGATE_NAO_ENCONTRADO',
          message: 'Resgate não encontrado para este cupom.',
        })
      }

      await manager.getRepository(CouponRedemption).update(resgate.id, {
        status: CouponRedemptionStatus.CANCELED,
        endsAt: new Date(),
      })

      this.logger.warn(
        { tenantId: resgate.tenantId, couponId },
        'resgate de cupom cancelado pela administração',
      )
    })
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private async buscar(manager: EntityManager, id: string): Promise<Coupon> {
    const cupom = await manager.getRepository(Coupon).findOne({ where: { id } })
    if (!cupom) {
      throw new NotFoundException({ code: 'CUPOM_NAO_ENCONTRADO', message: 'Cupom não encontrado.' })
    }
    return cupom
  }

  private async gravarAlvos(
    manager: EntityManager,
    couponId: string,
    alvos: CouponTargetsDto,
  ): Promise<void> {
    const repo = manager.getRepository(CouponTarget)

    for (const email of alvos.emails ?? []) {
      const normalizado = email.trim().toLowerCase()
      const jaExiste = await repo.findOne({ where: { couponId, email: normalizado } })
      if (jaExiste) continue
      await repo.save(repo.create({ couponId, email: normalizado }))
    }

    for (const tenantId of alvos.tenantIds ?? []) {
      const jaExiste = await repo.findOne({ where: { couponId, targetTenantId: tenantId } })
      if (jaExiste) continue
      await repo.save(repo.create({ couponId, targetTenantId: tenantId }))
    }
  }

  private async montar(
    manager: EntityManager,
    id: string,
    carregado?: Coupon,
  ): Promise<CouponResponseDto> {
    const cupom = carregado ?? (await this.buscar(manager, id))

    const alvos = await manager.getRepository(CouponTarget).find({ where: { couponId: cupom.id } })

    const resgates = await manager
      .getRepository(CouponRedemption)
      .createQueryBuilder('r')
      .where('r.couponId = :couponId', { couponId: cupom.id })
      .andWhere('r.status <> :cancelado', { cancelado: CouponRedemptionStatus.CANCELED })
      .getCount()

    const ativos = await manager.getRepository(CouponRedemption).count({
      where: { couponId: cupom.id, status: CouponRedemptionStatus.ACTIVE },
    })

    const impedimento = motivoDeBloqueio(cupom, resgates)

    return {
      id: cupom.id,
      code: cupom.code,
      name: cupom.name,
      description: cupom.description ?? null,
      discountPercent: cupom.discountPercent,
      maxInvoices: cupom.maxInvoices,
      courtesy: cupom.discountPercent >= CORTESIA,
      startsAt: cupom.startsAt ?? null,
      expiresAt: cupom.expiresAt ?? null,
      maxRedemptions: cupom.maxRedemptions ?? null,
      tenantType: cupom.tenantType ?? null,
      firstSubscriptionOnly: cupom.firstSubscriptionOnly,
      isActive: cupom.isActive,
      redemptions: resgates,
      activeRedemptions: ativos,
      restricted: alvos.length > 0,
      targetEmails: alvos.map((a) => a.email).filter((e): e is string => Boolean(e)),
      targetTenantIds: alvos.map((a) => a.targetTenantId).filter((t): t is string => Boolean(t)),
      redeemable: impedimento === null,
      blockedReason: impedimento,
      createdAt: cupom.createdAt,
    }
  }
}

/**
 * Por que este cupom não pode ser resgatado agora.
 *
 * Existe para a listagem administrativa responder de relance "por que ninguém
 * está conseguindo usar o código da campanha?" — a pergunta que sempre chega
 * depois de o cupom já ter sido divulgado.
 */
export function motivoDeBloqueio(cupom: Coupon, resgates: number, agora = new Date()): string | null {
  if (!cupom.isActive) return 'Desligado'
  if (cupom.startsAt && cupom.startsAt > agora) return 'Ainda não começou'
  if (cupom.expiresAt && cupom.expiresAt <= agora) return 'Expirado'
  if (cupom.maxRedemptions !== null && cupom.maxRedemptions !== undefined) {
    if (resgates >= cupom.maxRedemptions) return 'Esgotado'
  }
  return null
}

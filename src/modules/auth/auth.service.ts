import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EntityManager } from 'typeorm'
import { SystemScope } from '../../common/database/system-scope.service'
import { hashPassword, verifyPassword } from '../../common/security/password'
import { SubscriptionStatus, TenantStatus, TenantType } from '../../common/enums/tenant.enum'
import { UserRole } from '../../common/enums/user-role.enum'
import { permissionsFor, TENANT_MODULES } from '../../common/permissions/permissions'
import type { Env } from '../../config/env'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { MailService } from '../mail/mail.service'
import { boasVindas } from '../mail/templates'
import { Plan } from '../billing/entities/plan.entity'
import { Subscription } from '../billing/entities/subscription.entity'
import { Tenant } from '../tenants/entities/tenant.entity'
import { User } from '../users/entities/user.entity'
import type { LoginDto, RegisterDto, SessionDto } from './dto/auth.dto'
import { TokenService } from './token.service'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  /**
   * Hash descartável, gerado uma vez no boot, usado quando o e-mail não existe.
   * Sem ele a resposta de "usuário inexistente" volta em 2ms e a de "senha
   * errada" em 60ms — e essa diferença permite enumerar contas cadastradas.
   */
  private readonly dummyHash = hashPassword('mnvma::timing-guard')

  constructor(
    private readonly systemScope: SystemScope,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ─── Cadastro ───────────────────────────────────────────────────────────────

  /**
   * Cria a conta inteira numa transação: tenant, usuário dono, assinatura em
   * trial e — sempre — o registro de Caregiver do próprio dono.
   *
   * Esse Caregiver parece supérfluo na conta individual, mas é o que faz plantão,
   * escala e custo terem a mesma forma nos dois tipos de conta. É também o que
   * transforma a migração Individual → Empresa (§18) numa troca de enum.
   */
  async register(
    dto: RegisterDto,
    context: { ip?: string; userAgent?: string },
  ): Promise<{ session: SessionDto; refreshToken: string }> {
    const criada = await this.systemScope.run('auth.register', async (manager) => {
      const existing = await manager
        .getRepository(User)
        .createQueryBuilder('u')
        .where('u.email = :email', { email: dto.email })
        .andWhere('u.deletedAt IS NULL')
        .getExists()

      if (existing) {
        throw new ConflictException({
          code: 'EMAIL_IN_USE',
          message: 'Este e-mail já está cadastrado.',
          fields: { email: 'Este e-mail já está cadastrado.' },
        })
      }

      const isCompany = dto.accountType === TenantType.COMPANY
      const trialDays = this.config.get('TRIAL_DAYS', { infer: true })

      const tenant = await manager.getRepository(Tenant).save(
        manager.getRepository(Tenant).create({
          name: isCompany ? (dto.companyName?.trim() || dto.name) : dto.name,
          type: dto.accountType,
          document: dto.document?.replace(/\D/g, '') || null,
          status: TenantStatus.TRIAL,
          trialEndsAt: addDays(new Date(), trialDays),
          timezone: this.config.get('DEFAULT_TIMEZONE', { infer: true }),
        }),
      )

      const caregiver = await manager.getRepository(Caregiver).save(
        manager.getRepository(Caregiver).create({
          tenantId: tenant.id,
          name: dto.name,
          email: dto.email,
          phone: dto.phone ?? null,
          isOwner: true,
          isActive: true,
        }),
      )

      const user = await manager.getRepository(User).save(
        manager.getRepository(User).create({
          tenantId: tenant.id,
          name: dto.name,
          email: dto.email,
          passwordHash: await hashPassword(dto.password),
          role: UserRole.OWNER,
          // Na empresa o dono é gestor, não plantonista: não vinculamos o
          // usuário ao cadastro de cuidador para não restringir o acesso dele.
          caregiverId: isCompany ? null : caregiver.id,
          isActive: true,
          lastLoginAt: new Date(),
        }),
      )

      await this.createTrialSubscription(manager, tenant)

      const refreshToken = await this.tokens.issueRefreshToken(manager, user, context)
      this.logger.log({ tenantId: tenant.id, type: tenant.type }, 'nova conta criada')

      return { session: this.buildSession(user, tenant), refreshToken, tenant, user }
    })

    // Depois do commit, nunca dentro dele: e-mail de boas-vindas de uma conta
    // que a transação desfez é pior do que e-mail nenhum.
    await this.mail.send(
      criada.user.email,
      boasVindas({
        nome: criada.user.name,
        conta: criada.tenant.name,
        url: this.config.get('APP_URL', { infer: true }),
        termina: criada.tenant.trialEndsAt ?? null,
      }),
    )

    return { session: criada.session, refreshToken: criada.refreshToken }
  }

  // ─── Login ──────────────────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    context: { ip?: string; userAgent?: string },
  ): Promise<{ session: SessionDto; refreshToken: string }> {
    return this.systemScope.run('auth.login', async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('u')
        .addSelect('u.passwordHash')
        .where('u.email = :email', { email: dto.email })
        .andWhere('u.deletedAt IS NULL')
        .getOne()

      // Mesma mensagem e mesmo custo de CPU nos dois casos: e-mail errado e
      // senha errada precisam ser indistinguíveis de fora.
      const passwordMatches = user
        ? await verifyPassword(user.passwordHash, dto.password)
        : await verifyPassword(await this.dummyHash, dto.password).then(() => false)

      if (!user || !passwordMatches || !user.isActive) {
        throw new UnauthorizedException({
          code: 'INVALID_CREDENTIALS',
          message: 'E-mail ou senha incorretos.',
        })
      }

      const tenant = await manager.getRepository(Tenant).findOneOrFail({
        where: { id: user.tenantId },
      })

      await manager.getRepository(User).update(user.id, { lastLoginAt: new Date() })

      const refreshToken = await this.tokens.issueRefreshToken(manager, user, context)
      return { session: this.buildSession(user, tenant), refreshToken }
    })
  }

  // ─── Refresh ────────────────────────────────────────────────────────────────

  async refresh(
    rawToken: string,
    context: { ip?: string; userAgent?: string },
  ): Promise<{ session: SessionDto; refreshToken: string }> {
    return this.systemScope.run('auth.refresh', async (manager) => {
      const rotated = await this.tokens.rotateRefreshToken(manager, rawToken, context)

      const user = await manager.getRepository(User).findOne({ where: { id: rotated.userId } })
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Sessão inválida. Entre novamente.')
      }

      const tenant = await manager.getRepository(Tenant).findOneOrFail({
        where: { id: user.tenantId },
      })

      return { session: this.buildSession(user, tenant), refreshToken: rotated.newRawToken }
    })
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return
    await this.systemScope.run('auth.logout', (manager) =>
      this.tokens.revokeToken(manager, rawToken),
    )
  }

  /** Sessão atual (`GET /auth/me`), já dentro do contexto de tenant. */
  async currentSession(manager: EntityManager, userId: string): Promise<SessionDto> {
    const user = await manager.getRepository(User).findOneOrFail({ where: { id: userId } })
    const tenant = await manager
      .getRepository(Tenant)
      .findOneOrFail({ where: { id: user.tenantId } })

    return this.buildSession(user, tenant, { withAccessToken: false })
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private async createTrialSubscription(manager: EntityManager, tenant: Tenant): Promise<void> {
    const plan = await manager.getRepository(Plan).findOne({
      where: { tenantType: tenant.type, isActive: true },
      order: { sortOrder: 'ASC' },
    })

    // Sem catálogo de planos ainda (Sprint 7): a conta nasce em trial e o
    // billing preenche isso depois. Nada aqui pode impedir o cadastro.
    if (!plan) {
      this.logger.warn(
        { tenantType: tenant.type },
        'nenhum plano cadastrado para este tipo de conta — assinatura não criada',
      )
      return
    }

    await manager.getRepository(Subscription).save(
      manager.getRepository(Subscription).create({
        tenantId: tenant.id,
        planId: plan.id,
        status: SubscriptionStatus.TRIAL,
        currentPeriodEnd: tenant.trialEndsAt,
      }),
    )
  }

  private buildSession(
    user: User,
    tenant: Tenant,
    options: { withAccessToken?: boolean } = {},
  ): SessionDto {
    const signed =
      options.withAccessToken === false ? null : this.tokens.signAccessToken(user, tenant)

    return {
      accessToken: signed?.token ?? '',
      expiresIn: signed?.expiresIn ?? 0,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        caregiverId: user.caregiverId ?? null,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        type: tenant.type,
        status: tenant.status,
        trialEndsAt: tenant.trialEndsAt ?? null,
        trialDaysLeft: trialDaysLeft(tenant),
      },
      permissions: permissionsFor(user.role, tenant.type),
      modules: TENANT_MODULES[tenant.type],
    }
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function trialDaysLeft(tenant: Tenant): number {
  if (tenant.status !== TenantStatus.TRIAL || !tenant.trialEndsAt) return 0
  const ms = tenant.trialEndsAt.getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

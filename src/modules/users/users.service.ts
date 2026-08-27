import { createHash, randomBytes } from 'node:crypto'
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
import { SystemScope } from '../../common/database/system-scope.service'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { PageDto } from '../../common/dto/pagination.dto'
import { ROLE_LABELS, UserRole } from '../../common/enums/user-role.enum'
import { hashPassword } from '../../common/security/password'
import type { AuthenticatedUser } from '../../common/types/authenticated-request'
import type { Env } from '../../config/env'
import { AuthService } from '../auth/auth.service'
import type { SessionDto } from '../auth/dto/auth.dto'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { MailService } from '../mail/mail.service'
import { conviteDeEquipe } from '../mail/templates'
import { Tenant } from '../tenants/entities/tenant.entity'
import { Invitation } from './entities/invitation.entity'
import { User } from './entities/user.entity'
import type {
  AcceptInviteDto,
  InvitationQueryDto,
  InvitationResponseDto,
  InviteCreatedDto,
  InvitePreviewDto,
  InviteUserDto,
  UpdateUserDto,
  UserQueryDto,
  UserResponseDto,
} from './dto/user.dto'

/** Validade do convite. Curto o bastante para um link vazado envelhecer. */
const INVITE_TTL_DIAS = 7

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)

  constructor(
    @InjectTenantRepository(User)
    private readonly users: TenantScopedRepository<User>,
    @InjectTenantRepository(Caregiver)
    private readonly caregivers: TenantScopedRepository<Caregiver>,
    @InjectTenantRepository(Invitation)
    private readonly invitations: TenantScopedRepository<Invitation>,
    private readonly systemScope: SystemScope,
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly mail: MailService,
  ) {}

  // ─── Equipe ─────────────────────────────────────────────────────────────────

  async list(query: UserQueryDto, atual: AuthenticatedUser): Promise<PageDto<UserResponseDto>> {
    const qb = this.users.qb('u')

    if (query.role) qb.andWhere('u.role = :papel', { papel: query.role })
    if (query.status !== 'all') {
      qb.andWhere('u.isActive = :ativo', { ativo: query.status === 'active' })
    }
    if (query.q) {
      qb.andWhere('(u.name LIKE :busca OR u.email LIKE :busca)', { busca: `%${query.q}%` })
    }

    const [data, total] = await qb
      // O titular primeiro: é quem responde pela conta e quem se procura na lista.
      .orderBy("CASE WHEN u.role = 'OWNER' THEN 0 ELSE 1 END", 'ASC')
      .addOrderBy('u.name', 'ASC')
      .skip(query.skip)
      .take(query.perPage)
      .getManyAndCount()

    const nomes = await this.nomesDeCuidadores(data)

    return new PageDto(
      data.map((u) => paraResposta(u, nomes.get(u.caregiverId ?? '') ?? null, atual.userId)),
      total,
      query,
    )
  }

  async findOne(id: string, atual: AuthenticatedUser): Promise<UserResponseDto> {
    const user = await this.users.findByIdOrFail(id, {}, 'Usuário não encontrado.')
    const nomes = await this.nomesDeCuidadores([user])
    return paraResposta(user, nomes.get(user.caregiverId ?? '') ?? null, atual.userId)
  }

  /**
   * Edição de papel, vínculo e acesso.
   *
   * Duas travas que existem para a conta não ficar sem dono: ninguém mexe no
   * titular, e ninguém muda o próprio papel. A segunda parece paranoia, mas o
   * caso real é o admin que se rebaixa para "Financeiro" para testar a tela e
   * perde, no mesmo clique, a permissão de se promover de volta.
   */
  async update(id: string, dto: UpdateUserDto, atual: AuthenticatedUser): Promise<UserResponseDto> {
    const user = await this.users.findByIdOrFail(id, {}, 'Usuário não encontrado.')
    const ehOProprio = user.id === atual.userId

    if (user.role === UserRole.OWNER && (dto.role !== undefined || dto.isActive !== undefined)) {
      throw new ConflictException({
        code: 'OWNER_PROTECTED',
        message: 'O titular da conta não pode ter o papel alterado nem ser desativado.',
      })
    }

    if (ehOProprio && dto.role !== undefined && dto.role !== user.role) {
      throw new ConflictException({
        code: 'SELF_ROLE_CHANGE',
        message: 'Você não pode alterar o próprio papel. Peça a outro administrador.',
      })
    }

    if (ehOProprio && dto.isActive === false) {
      throw new ConflictException({
        code: 'SELF_DEACTIVATE',
        message: 'Você não pode desativar o próprio acesso.',
      })
    }

    const papel = dto.role ?? user.role
    const patch: Partial<User> = {}

    if (dto.name !== undefined) patch.name = dto.name
    if (dto.isActive !== undefined) patch.isActive = dto.isActive
    if (dto.role !== undefined) patch.role = dto.role

    if (papel === UserRole.CAREGIVER) {
      const caregiverId = dto.caregiverId ?? user.caregiverId ?? null
      if (!caregiverId) {
        throw new BadRequestException({
          code: 'CAREGIVER_REQUIRED',
          message: 'Escolha o cuidador que este acesso representa.',
          fields: { caregiverId: 'Obrigatório para o papel Cuidador.' },
        })
      }
      await this.assertCuidadorDisponivel(caregiverId, user.id)
      patch.caregiverId = caregiverId
    } else if (dto.role !== undefined || dto.caregiverId !== undefined) {
      // Sair do papel de cuidador desfaz o vínculo: mantê-lo continuaria
      // recortando os dados por `caregiverId` e o novo gestor enxergaria só os
      // próprios plantões, sem entender por quê.
      patch.caregiverId = null
    }

    const salvo = await this.users.updateById(user.id, patch)
    const nomes = await this.nomesDeCuidadores([salvo])

    return paraResposta(salvo, nomes.get(salvo.caregiverId ?? '') ?? null, atual.userId)
  }

  /**
   * Soft delete. O usuário some da lista, mas o que ele registrou continua
   * assinado — ocorrência e plantão guardam o nome copiado justamente por isto.
   */
  async remove(id: string, atual: AuthenticatedUser): Promise<void> {
    const user = await this.users.findByIdOrFail(id, {}, 'Usuário não encontrado.')

    if (user.role === UserRole.OWNER) {
      throw new ConflictException({
        code: 'OWNER_PROTECTED',
        message: 'O titular da conta não pode ser removido.',
      })
    }

    if (user.id === atual.userId) {
      throw new ConflictException({
        code: 'SELF_DELETE',
        message: 'Você não pode remover o próprio acesso.',
      })
    }

    await this.users.softDeleteById(user.id)
    this.logger.log({ userId: user.id, by: atual.userId }, 'acesso removido')
  }

  // ─── Convites ───────────────────────────────────────────────────────────────

  async listInvitations(query: InvitationQueryDto): Promise<PageDto<InvitationResponseDto>> {
    const qb = this.invitations.qb('i')

    if (query.q) {
      qb.andWhere('(i.email LIKE :busca OR i.name LIKE :busca)', { busca: `%${query.q}%` })
    }

    const agora = new Date()
    if (query.situation === 'pending') {
      qb.andWhere('i.acceptedAt IS NULL')
        .andWhere('i.revokedAt IS NULL')
        .andWhere('i.expiresAt > :agora', { agora })
    } else if (query.situation === 'accepted') {
      qb.andWhere('i.acceptedAt IS NOT NULL')
    } else if (query.situation === 'revoked') {
      qb.andWhere('i.revokedAt IS NOT NULL')
    } else if (query.situation === 'expired') {
      qb.andWhere('i.acceptedAt IS NULL')
        .andWhere('i.revokedAt IS NULL')
        .andWhere('i.expiresAt <= :agora', { agora })
    }

    const [data, total] = await qb
      .orderBy('i.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.perPage)
      .getManyAndCount()

    return new PageDto(data.map(paraConvite), total, query)
  }

  async invite(dto: InviteUserDto, autor: AuthenticatedUser): Promise<InviteCreatedDto> {
    if (dto.role === UserRole.CAREGIVER) {
      if (!dto.caregiverId) {
        throw new BadRequestException({
          code: 'CAREGIVER_REQUIRED',
          message: 'Escolha o cuidador que este acesso representa.',
          fields: { caregiverId: 'Obrigatório para o papel Cuidador.' },
        })
      }
      await this.assertCuidadorDisponivel(dto.caregiverId)
    }

    await this.assertEmailLivre(dto.email)

    const pendente = await this.invitations
      .qb('i')
      .andWhere('i.email = :email', { email: dto.email })
      .andWhere('i.acceptedAt IS NULL')
      .andWhere('i.revokedAt IS NULL')
      .andWhere('i.expiresAt > :agora', { agora: new Date() })
      .getExists()

    if (pendente) {
      throw new ConflictException({
        code: 'INVITE_PENDING',
        message: 'Já existe um convite em aberto para este e-mail. Reenvie-o ou cancele-o.',
        fields: { email: 'Já existe um convite em aberto para este e-mail.' },
      })
    }

    const nomeDoAutor = (await this.users.findById(autor.userId))?.name ?? null
    const { raw, hash } = novoToken()

    const convite = await this.invitations.createAndSave({
      email: dto.email,
      name: dto.name.trim(),
      role: dto.role,
      caregiverId: dto.role === UserRole.CAREGIVER ? dto.caregiverId : null,
      tokenHash: hash,
      expiresAt: emDias(INVITE_TTL_DIAS),
      invitedByUserId: autor.userId,
      invitedByName: nomeDoAutor,
    })

    const emailDelivered = await this.enviarConvite(convite, raw)
    this.logger.log({ invitationId: convite.id, role: dto.role, emailDelivered }, 'convite criado')

    return { invitation: paraConvite(convite), inviteUrl: this.urlDoConvite(raw), emailDelivered }
  }

  /**
   * Reenvio: gera um token NOVO e invalida o anterior.
   *
   * Reaproveitar o token facilitaria a vida de quem reenvia, mas manteria vivo
   * um link que já circulou por uma caixa de entrada — possivelmente a errada,
   * que é o motivo mais comum de alguém pedir reenvio.
   */
  async resendInvitation(id: string): Promise<InviteCreatedDto> {
    const convite = await this.invitations.findByIdOrFail(id, {}, 'Convite não encontrado.')

    if (convite.acceptedAt) {
      throw new ConflictException({
        code: 'INVITE_ACCEPTED',
        message: 'Este convite já foi aceito.',
      })
    }
    if (convite.revokedAt) {
      throw new ConflictException({
        code: 'INVITE_REVOKED',
        message: 'Este convite foi cancelado. Crie um novo.',
      })
    }

    await this.assertEmailLivre(convite.email)

    const { raw, hash } = novoToken()
    const atualizado = await this.invitations.updateById(convite.id, {
      tokenHash: hash,
      expiresAt: emDias(INVITE_TTL_DIAS),
    })

    const emailDelivered = await this.enviarConvite(atualizado, raw)
    this.logger.log({ invitationId: convite.id, emailDelivered }, 'convite reenviado')

    return {
      invitation: paraConvite(atualizado),
      inviteUrl: this.urlDoConvite(raw),
      emailDelivered,
    }
  }

  async revokeInvitation(id: string): Promise<InvitationResponseDto> {
    const convite = await this.invitations.findByIdOrFail(id, {}, 'Convite não encontrado.')

    if (convite.acceptedAt) {
      throw new ConflictException({
        code: 'INVITE_ACCEPTED',
        message: 'Este convite já foi aceito. Remova o acesso pela lista de usuários.',
      })
    }

    if (convite.revokedAt) return paraConvite(convite)

    return paraConvite(await this.invitations.updateById(convite.id, { revokedAt: new Date() }))
  }

  // ─── Fluxo público de aceite ────────────────────────────────────────────────

  /**
   * Prévia mostrada antes de a pessoa criar a senha: em que empresa ela está
   * entrando e com que papel. Sem isto, o convite é um link cego pedindo senha
   * — exatamente o que se ensina a não clicar.
   */
  async previewInvite(token: string): Promise<InvitePreviewDto> {
    return this.systemScope.run('users.invite.preview', async (manager) => {
      const convite = await this.buscarConvitePorToken(manager, token)

      const tenant = await manager.getRepository(Tenant).findOne({
        where: { id: convite.tenantId },
      })

      return {
        tenantName: tenant?.name ?? '',
        email: convite.email,
        name: convite.name,
        role: convite.role,
        roleLabel: ROLE_LABELS[convite.role],
        expiresAt: convite.expiresAt.toISOString(),
      }
    })
  }

  /**
   * Aceite do convite. Roda fora de qualquer sessão — quem aceita ainda não tem
   * login —, por isso o SystemScope: o tenant vem do convite, não do contexto.
   *
   * O usuário só nasce aqui. Até então existia apenas a intenção de convidar,
   * e é isso que permite convidar o mesmo e-mail em duas empresas sem que a
   * unicidade global de `users.email` derrube o segundo convite.
   */
  async accept(
    dto: AcceptInviteDto,
    context: { ip?: string; userAgent?: string },
  ): Promise<{ session: SessionDto; refreshToken: string }> {
    const credenciais = await this.systemScope.run('users.invite.accept', async (manager) => {
      const convite = await this.buscarConvitePorToken(manager, dto.token)

      const emailEmUso = await manager
        .getRepository(User)
        .createQueryBuilder('u')
        .where('u.email = :email', { email: convite.email })
        .andWhere('u.deletedAt IS NULL')
        .getExists()

      if (emailEmUso) {
        throw new ConflictException({
          code: 'EMAIL_IN_USE',
          message: 'Este e-mail já tem acesso. Entre com a senha que você já usa.',
        })
      }

      const user = await manager.getRepository(User).save(
        manager.getRepository(User).create({
          tenantId: convite.tenantId,
          name: dto.name?.trim() || convite.name,
          email: convite.email,
          passwordHash: await hashPassword(dto.password),
          role: convite.role,
          caregiverId: convite.caregiverId ?? null,
          isActive: true,
        }),
      )

      await manager
        .getRepository(Invitation)
        .update({ id: convite.id }, { acceptedAt: new Date() })

      this.logger.log(
        { tenantId: convite.tenantId, userId: user.id, role: convite.role },
        'convite aceito',
      )

      return { email: convite.email, password: dto.password }
    })

    // Já autentica: pedir para a pessoa fazer login logo depois de escolher a
    // senha é um passo a mais para errar.
    return this.auth.login(credenciais, context)
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private urlDoConvite(token: string): string {
    const base = this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '')
    return `${base}/convite/${token}`
  }

  /**
   * Manda o convite por e-mail. Devolve se saiu.
   *
   * Não lança nunca: o convite já está gravado quando isto roda, e derrubar a
   * requisição faria a tela dizer "erro" sobre um convite que existe. Quando o
   * envio falha, o `inviteUrl` da resposta é o plano B — copiar e mandar pelo
   * WhatsApp, que é como a maioria dos cuidadores recebe as coisas de qualquer
   * forma.
   */
  private async enviarConvite(convite: Invitation, token: string): Promise<boolean> {
    const conta = await RequestContext.manager()
      .getRepository(Tenant)
      .findOne({ where: { id: convite.tenantId } })

    const { delivered } = await this.mail.send(
      convite.email,
      conviteDeEquipe({
        nome: convite.name,
        conta: conta?.name ?? 'sua equipe',
        papel: convite.role,
        convidadoPor: convite.invitedByName ?? null,
        url: this.urlDoConvite(token),
        expiraEm: convite.expiresAt,
      }),
    )

    return delivered
  }

  private async buscarConvitePorToken(
    manager: EntityManager,
    token: string,
  ): Promise<Invitation> {
    const convite = await manager
      .getRepository(Invitation)
      .createQueryBuilder('i')
      .where('i.tokenHash = :hash', { hash: hashToken(token) })
      .andWhere('i.deletedAt IS NULL')
      .getOne()

    // Mesma resposta para token inexistente, cancelado e expirado: quem tem o
    // link não deve conseguir descobrir se ele existiu.
    const invalido = new NotFoundException({
      code: 'INVITE_INVALID',
      message: 'Convite inválido ou expirado. Peça um novo para quem te convidou.',
    })

    if (!convite || convite.revokedAt || convite.acceptedAt) throw invalido
    if (convite.expiresAt.getTime() <= Date.now()) throw invalido

    return convite
  }

  /** O e-mail é único no produto inteiro — a checagem atravessa tenants. */
  private async assertEmailLivre(email: string): Promise<void> {
    const emUso = await this.systemScope.run('users.invite.email-check', (manager) =>
      manager
        .getRepository(User)
        .createQueryBuilder('u')
        .where('u.email = :email', { email })
        .andWhere('u.deletedAt IS NULL')
        .getExists(),
    )

    if (emUso) {
      throw new ConflictException({
        code: 'EMAIL_IN_USE',
        message: 'Este e-mail já está cadastrado no MNVMA.',
        fields: { email: 'Este e-mail já está cadastrado no MNVMA.' },
      })
    }
  }

  private async assertCuidadorDisponivel(caregiverId: string, ignorarUserId?: string): Promise<void> {
    await this.caregivers.findByIdOrFail(caregiverId, {}, 'Cuidador não encontrado.')

    const qb = this.users.qb('u').andWhere('u.caregiverId = :cg', { cg: caregiverId })
    if (ignorarUserId) qb.andWhere('u.id != :ignorar', { ignorar: ignorarUserId })

    if (await qb.getExists()) {
      throw new ConflictException({
        code: 'CAREGIVER_LINKED',
        message: 'Este cuidador já tem acesso vinculado.',
        fields: { caregiverId: 'Este cuidador já tem acesso vinculado.' },
      })
    }
  }

  private async nomesDeCuidadores(users: User[]): Promise<Map<string, string>> {
    const ids = [...new Set(users.map((u) => u.caregiverId).filter((id): id is string => !!id))]
    if (ids.length === 0) return new Map()

    const cuidadores = await this.caregivers.qb('c').andWhereInIds(ids).getMany()
    return new Map(cuidadores.map((c) => [c.id, c.name]))
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function novoToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hash: hashToken(raw) }
}

/** SHA-256 basta: o token tem 256 bits de entropia, não é senha de humano. */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function emDias(dias: number): Date {
  return new Date(Date.now() + dias * 86_400_000)
}

function paraResposta(
  user: User,
  caregiverName: string | null,
  currentUserId: string,
): UserResponseDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role],
    caregiverId: user.caregiverId ?? null,
    caregiverName,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    isSelf: user.id === currentUserId,
  }
}

function paraConvite(convite: Invitation): InvitationResponseDto {
  return {
    id: convite.id,
    email: convite.email,
    name: convite.name,
    role: convite.role,
    roleLabel: ROLE_LABELS[convite.role],
    caregiverId: convite.caregiverId ?? null,
    expiresAt: convite.expiresAt.toISOString(),
    acceptedAt: convite.acceptedAt?.toISOString() ?? null,
    revokedAt: convite.revokedAt?.toISOString() ?? null,
    invitedByName: convite.invitedByName ?? null,
    situation: situacaoDe(convite),
    createdAt: convite.createdAt.toISOString(),
  }
}

function situacaoDe(convite: Invitation): InvitationResponseDto['situation'] {
  if (convite.revokedAt) return 'revoked'
  if (convite.acceptedAt) return 'accepted'
  if (convite.expiresAt.getTime() <= Date.now()) return 'expired'
  return 'pending'
}

import { randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { IsNull, MoreThan, type EntityManager } from 'typeorm'
import { SystemScope } from '../../common/database/system-scope.service'
import { hashPassword, verifyPassword } from '../../common/security/password'
import type { Env } from '../../config/env'
import { MailService } from '../mail/mail.service'
import { redefinicaoDeSenha, senhaAlterada } from '../mail/templates'
import { Tenant } from '../tenants/entities/tenant.entity'
import { User } from '../users/entities/user.entity'
import type { ChangePasswordDto, ResetPasswordPreviewDto } from './dto/auth.dto'
import { PasswordResetToken } from './entities/password-reset-token.entity'
import { hashToken, parseDuration, TokenService } from './token.service'

/** Quantos pedidos de redefinição um usuário pode gerar dentro da janela. */
const MAX_PEDIDOS = 3
const JANELA_MS = 15 * 60 * 1000

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name)

  constructor(
    private readonly systemScope: SystemScope,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ─── Esqueci a senha ────────────────────────────────────────────────────────

  /**
   * Nunca conta se o e-mail existe.
   *
   * O controller responde 204 sempre — inclusive para endereço desconhecido,
   * conta desativada e pedido barrado pelo limite. Distinguir esses casos
   * transformaria este endpoint público num verificador de quem é cliente.
   */
  async forgot(
    email: string,
    context: { ip?: string; userAgent?: string },
  ): Promise<void> {
    await this.systemScope.run('auth.forgot-password', async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('u')
        .where('u.email = :email', { email })
        .andWhere('u.deletedAt IS NULL')
        .getOne()

      if (!user || !user.isActive) {
        this.logger.log({ email }, 'pedido de redefinição para e-mail sem conta ativa — ignorado')
        return
      }

      const repo = manager.getRepository(PasswordResetToken)

      // Teto de pedidos por usuário: sem isto, quem souber o e-mail de alguém
      // enche a caixa de entrada dessa pessoa apertando F5. O throttler da rota
      // segura por IP; este teto segura por vítima.
      const recentes = await repo.count({
        where: { userId: user.id, createdAt: MoreThan(new Date(Date.now() - JANELA_MS)) },
      })

      if (recentes >= MAX_PEDIDOS) {
        this.logger.warn({ userId: user.id }, 'limite de pedidos de redefinição atingido')
        return
      }

      // Pedir de novo mata o link anterior. Reaproveitar seria mais cômodo,
      // mas manteria vivo um token que talvez tenha vazado — é justamente por
      // desconfiar disso que a pessoa pede de novo.
      await repo.update({ userId: user.id, usedAt: IsNull() }, { usedAt: new Date() })

      const raw = randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + this.ttlMs())

      await repo.save(
        repo.create({
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt,
          requestedIp: context.ip?.slice(0, 45) ?? null,
          requestedUserAgent: context.userAgent?.slice(0, 255) ?? null,
        }),
      )

      const resultado = await this.mail.send(
        user.email,
        redefinicaoDeSenha({ nome: user.name, url: this.urlDeRedefinicao(raw), expiraEm: expiresAt }),
      )

      this.logger.log(
        { userId: user.id, delivered: resultado.delivered },
        'link de redefinição de senha emitido',
      )
    })
  }

  // ─── Conferir o link antes de digitar ───────────────────────────────────────

  /**
   * Deixa a tela dizer "este link expirou" antes da pessoa escolher a senha, em
   * vez de depois. Devolve o e-mail mascarado para ela se reconhecer sem que o
   * link vire fonte de endereço completo para quem o interceptar.
   */
  async preview(token: string): Promise<ResetPasswordPreviewDto> {
    return this.systemScope.run('auth.reset-password.preview', async (manager) => {
      const { pedido, user } = await this.buscarPedido(manager, token)
      return {
        email: mascararEmail(user.email),
        name: user.name,
        expiresAt: pedido.expiresAt,
      }
    })
  }

  // ─── Redefinir ──────────────────────────────────────────────────────────────

  async reset(token: string, novaSenha: string): Promise<void> {
    await this.systemScope.run('auth.reset-password', async (manager) => {
      const { pedido, user } = await this.buscarPedido(manager, token)

      await manager
        .getRepository(User)
        .update(user.id, { passwordHash: await hashPassword(novaSenha) })

      await manager.getRepository(PasswordResetToken).update(pedido.id, { usedAt: new Date() })

      // Todas as sessões caem: se a senha foi redefinida porque alguém tomou a
      // conta, deixar o refresh token do invasor vivo anularia a redefinição.
      await this.tokens.revokeAllForUser(manager, user.id)

      await this.mail.send(user.email, senhaAlterada({ nome: user.name, quando: new Date() }))
      this.logger.log({ userId: user.id }, 'senha redefinida por link de e-mail')
    })
  }

  // ─── Trocar estando logado ──────────────────────────────────────────────────

  /**
   * Devolve um refresh token novo: as sessões antigas são revogadas (é o ponto
   * de trocar a senha), mas quem está trocando não deve ser expulso da própria
   * tela por causa disso.
   */
  async change(
    manager: EntityManager,
    userId: string,
    dto: ChangePasswordDto,
    context: { ip?: string; userAgent?: string },
  ): Promise<{ refreshToken: string }> {
    const user = await manager
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :userId', { userId })
      .getOneOrFail()

    if (!(await verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Senha atual incorreta.',
        fields: { currentPassword: 'Senha atual incorreta.' },
      })
    }

    if (await verifyPassword(user.passwordHash, dto.password)) {
      throw new BadRequestException({
        code: 'SAME_PASSWORD',
        message: 'A nova senha precisa ser diferente da atual.',
        fields: { password: 'A nova senha precisa ser diferente da atual.' },
      })
    }

    await manager
      .getRepository(User)
      .update(user.id, { passwordHash: await hashPassword(dto.password) })

    await this.tokens.revokeAllForUser(manager, user.id)
    const refreshToken = await this.tokens.issueRefreshToken(manager, user, context)

    await this.mail.send(user.email, senhaAlterada({ nome: user.name, quando: new Date() }))
    this.logger.log({ userId: user.id }, 'senha alterada pelo próprio usuário')

    return { refreshToken }
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  /**
   * Mesma resposta para token inexistente, já usado e expirado. Quem tem o link
   * certo não repara na diferença; quem está tentando adivinhar, sim.
   */
  private async buscarPedido(
    manager: EntityManager,
    token: string,
  ): Promise<{ pedido: PasswordResetToken; user: User }> {
    const invalido = new BadRequestException({
      code: 'INVALID_RESET_TOKEN',
      message: 'Este link de redefinição não vale mais. Peça um novo.',
    })

    const pedido = await manager
      .getRepository(PasswordResetToken)
      .createQueryBuilder('p')
      .where('p.tokenHash = :hash', { hash: hashToken(token) })
      .getOne()

    if (!pedido || pedido.usedAt || pedido.expiresAt.getTime() <= Date.now()) throw invalido

    const user = await manager.getRepository(User).findOne({ where: { id: pedido.userId } })
    if (!user || !user.isActive) throw invalido

    // Conta cancelada ainda troca de senha: o dono precisa entrar para exportar
    // o próprio histórico. Só a escrita de negócio é que fica bloqueada.
    await manager.getRepository(Tenant).findOneOrFail({ where: { id: user.tenantId } })

    return { pedido, user }
  }

  private ttlMs(): number {
    return parseDuration(this.config.get('PASSWORD_RESET_TTL', { infer: true })) * 1000
  }

  private urlDeRedefinicao(token: string): string {
    const base = this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '')
    return `${base}/redefinir-senha/${token}`
  }
}

/** `joao.pereira@gmail.com` → `jo***@gmail.com` */
function mascararEmail(email: string): string {
  const [local, dominio] = email.split('@')
  if (!dominio) return '***'
  const visivel = local.slice(0, Math.min(2, local.length))
  return `${visivel}***@${dominio}`
}

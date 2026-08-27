import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { Response } from 'express'
import { IsNull, type EntityManager } from 'typeorm'
import type { Env } from '../../config/env'
import type { JwtPayload } from '../../common/types/authenticated-request'
import { RefreshToken } from './entities/refresh-token.entity'
import type { User } from '../users/entities/user.entity'
import type { Tenant } from '../tenants/entities/tenant.entity'

export const REFRESH_COOKIE = 'mnvma_rt'

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name)

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ─── Access token ───────────────────────────────────────────────────────────

  signAccessToken(user: User, tenant: Tenant): { token: string; expiresIn: number } {
    const payload: JwtPayload = {
      sub: user.id,
      tid: tenant.id,
      role: user.role,
      tt: tenant.type,
      cgid: user.caregiverId ?? null,
    }

    // Em segundos: o tipo de `expiresIn` do jsonwebtoken aceita número ou uma
    // string com formato restrito, e o número não depende dessa validação.
    const expiresIn = parseDuration(this.config.get('JWT_ACCESS_TTL', { infer: true }))

    const token = this.jwt.sign(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn,
    })

    return { token, expiresIn }
  }

  // ─── Refresh token ──────────────────────────────────────────────────────────

  /**
   * Emite um refresh opaco (não é JWT: não precisa carregar dados e queremos
   * poder revogar). O banco guarda só o SHA-256 — vazamento do dump não vira
   * sessão válida.
   */
  async issueRefreshToken(
    manager: EntityManager,
    user: User,
    options: { familyId?: string; ip?: string; userAgent?: string } = {},
  ): Promise<string> {
    const raw = randomBytes(48).toString('base64url')
    const ttlMs = parseDuration(this.config.get('JWT_REFRESH_TTL', { infer: true })) * 1000

    await manager.getRepository(RefreshToken).save(
      manager.getRepository(RefreshToken).create({
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: hashToken(raw),
        familyId: options.familyId ?? randomUUID(),
        expiresAt: new Date(Date.now() + ttlMs),
        ip: options.ip?.slice(0, 45) ?? null,
        userAgent: options.userAgent?.slice(0, 255) ?? null,
      }),
    )

    return raw
  }

  /**
   * Rotação com detecção de reuso: um refresh já rotacionado que aparece de novo
   * indica cópia roubada. Nesse caso toda a família de tokens daquele login é
   * revogada — o legítimo e o ladrão caem juntos, e o dono refaz o login.
   */
  async rotateRefreshToken(
    manager: EntityManager,
    rawToken: string,
    context: { ip?: string; userAgent?: string },
  ): Promise<{ userId: string; tenantId: string; newRawToken: string; familyId: string }> {
    const repo = manager.getRepository(RefreshToken)
    const current = await repo.findOne({ where: { tokenHash: hashToken(rawToken) } })

    if (!current) throw new UnauthorizedException('Sessão expirada. Entre novamente.')

    if (current.revokedAt) {
      this.logger.warn(
        { userId: current.userId, familyId: current.familyId },
        'reuso de refresh token detectado — revogando a família inteira',
      )
      await repo.update({ familyId: current.familyId }, { revokedAt: new Date() })
      throw new UnauthorizedException('Sessão inválida. Entre novamente.')
    }

    if (current.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Sessão expirada. Entre novamente.')
    }

    const raw = randomBytes(48).toString('base64url')
    const ttlMs = parseDuration(this.config.get('JWT_REFRESH_TTL', { infer: true })) * 1000

    const next = await repo.save(
      repo.create({
        tenantId: current.tenantId,
        userId: current.userId,
        tokenHash: hashToken(raw),
        familyId: current.familyId,
        expiresAt: new Date(Date.now() + ttlMs),
        ip: context.ip?.slice(0, 45) ?? null,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
      }),
    )

    await repo.update(current.id, { revokedAt: new Date(), replacedById: next.id })

    return {
      userId: current.userId,
      tenantId: current.tenantId,
      newRawToken: raw,
      familyId: current.familyId,
    }
  }

  async revokeToken(manager: EntityManager, rawToken: string): Promise<void> {
    await manager
      .getRepository(RefreshToken)
      .update({ tokenHash: hashToken(rawToken) }, { revokedAt: new Date() })
  }

  async revokeAllForUser(manager: EntityManager, userId: string): Promise<void> {
    await manager
      .getRepository(RefreshToken)
      .update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() })
  }

  // ─── Cookie ─────────────────────────────────────────────────────────────────

  setRefreshCookie(response: Response, token: string): void {
    response.cookie(REFRESH_COOKIE, token, this.cookieOptions())
  }

  clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, { ...this.cookieOptions(), maxAge: undefined })
  }

  private cookieOptions() {
    const secure = this.config.get('COOKIE_SECURE', { infer: true })
    const domain = this.config.get('COOKIE_DOMAIN', { infer: true })

    return {
      httpOnly: true,
      secure,
      // Painel e API ficam em hosts diferentes (app. e api.), então em produção
      // o cookie precisa ser SameSite=None — que por sua vez exige Secure.
      sameSite: secure ? ('none' as const) : ('lax' as const),
      domain: domain || undefined,
      path: '/v1/auth',
      maxAge: parseDuration(this.config.get('JWT_REFRESH_TTL', { infer: true })) * 1000,
    }
  }

}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** "15m" | "30d" | "3600" → segundos */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim())
  if (!match) throw new Error(`Duração inválida: ${value}`)

  const amount = Number(match[1])
  const unit = match[2] ?? 's'
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

  return amount * multipliers[unit]
}

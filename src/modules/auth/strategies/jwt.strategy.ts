import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import type { Env } from '../../../config/env'
import type { AuthenticatedUser, JwtPayload } from '../../../common/types/authenticated-request'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    })
  }

  /**
   * Só traduz o payload — nenhuma consulta ao banco aqui. O access token vive 15
   * minutos; conferir usuário a cada request seria um SELECT por chamada. O que
   * precisa de estado fresco (conta suspensa) é tratado no TenantStatusGuard,
   * que tem cache curto.
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload.sub || !payload.tid) {
      throw new UnauthorizedException('Token inválido.')
    }

    return {
      userId: payload.sub,
      tenantId: payload.tid,
      role: payload.role,
      tenantType: payload.tt,
      caregiverId: payload.cgid ?? null,
    }
  }
}

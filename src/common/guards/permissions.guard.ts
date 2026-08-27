import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PERMISSION_KEY } from '../decorators'
import { hasPermission, type Permission } from '../permissions/permissions'
import type { AuthenticatedRequest } from '../types/authenticated-request'

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!required) return true

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (!user) throw new ForbiddenException('Sessão inválida.')

    if (!hasPermission(user.role, user.tenantType, required)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Seu perfil não tem acesso a este recurso.',
        required,
      })
    }

    return true
  }
}

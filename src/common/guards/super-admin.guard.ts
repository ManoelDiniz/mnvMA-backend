import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SUPER_ADMIN_KEY } from '../decorators'
import { UserRole } from '../enums/user-role.enum'
import type { AuthenticatedRequest } from '../types/authenticated-request'

/**
 * Rotas do dono do SaaS.
 *
 * Não dá para usar o `PermissionsGuard` aqui: o SUPER_ADMIN tem todas as
 * permissões, mas o OWNER de cada conta também tem — dentro da própria conta.
 * Uma permissão como `billing:write` não distingue "administra a minha
 * empresa" de "administra o MNVMA inteiro", e é exatamente essa distinção que
 * decide quem pode criar um cupom de 100%.
 *
 * Por isso a conferência é do papel, direta, e mora num guard próprio: quem
 * ler `@SomenteSuperAdmin()` num controller sabe na hora que aquilo não é do
 * assinante.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true

    const exigido = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!exigido) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()

    if (request.user?.role !== UserRole.SUPER_ADMIN) {
      // 403 e mensagem genérica: para quem não é, esta rota não precisa nem
      // existir. Detalhar o que ela faz só ajuda quem está tateando a API.
      throw new ForbiddenException({
        code: 'SOMENTE_SUPER_ADMIN',
        message: 'Esta operação é da administração do MNVMA.',
      })
    }

    return true
  }
}

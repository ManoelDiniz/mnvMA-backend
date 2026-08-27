import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ALLOW_READ_ONLY_KEY, IS_PUBLIC_KEY } from '../decorators'
import { TenantStatus, WRITABLE_TENANT_STATUSES } from '../enums/tenant.enum'
import type { AuthenticatedRequest } from '../types/authenticated-request'
import { TenantStatusCache } from '../services/tenant-status.cache'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const MESSAGES: Partial<Record<TenantStatus, string>> = {
  [TenantStatus.SUSPENDED]:
    'Conta suspensa por falta de pagamento. Os dados continuam disponíveis para consulta e exportação — regularize a assinatura para voltar a editar.',
  // Vale para o fim do teste e para o fim de uma cortesia por cupom de 100%:
  // nos dois casos ninguém deixou de pagar, e a mensagem não pode sugerir isso.
  [TenantStatus.EXPIRED]:
    'Seu período gratuito terminou. Os dados continuam disponíveis para consulta e exportação — escolha um plano para voltar a editar.',
  [TenantStatus.CANCELED]:
    'Assinatura cancelada. Os dados continuam disponíveis para consulta e exportação.',
}

/**
 * Bloqueia ESCRITA quando a conta não está em dia; leitura e exportação seguem
 * liberadas. Trancar o cliente para fora do próprio histórico não recupera o
 * pagamento — só garante que ele não volte.
 */
@Injectable()
export class TenantStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly statusCache: TenantStatusCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const user = request.user
    if (!user) return true

    const status = await this.statusCache.get(user.tenantId)
    user.tenantStatus = status

    if (WRITABLE_TENANT_STATUSES.includes(status)) return true

    const allowReadOnly = this.reflector.getAllAndOverride<boolean>(ALLOW_READ_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (SAFE_METHODS.has(request.method) || allowReadOnly) return true

    throw new ForbiddenException({
      code: 'TENANT_NOT_WRITABLE',
      status,
      message: MESSAGES[status] ?? 'Conta sem permissão de escrita no momento.',
    })
  }
}

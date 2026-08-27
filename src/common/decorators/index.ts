import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Permission } from '../permissions/permissions'
import type { AuthenticatedRequest, AuthenticatedUser } from '../types/authenticated-request'

export const IS_PUBLIC_KEY = 'mnvma:isPublic'
export const PERMISSION_KEY = 'mnvma:permission'
export const ALLOW_READ_ONLY_KEY = 'mnvma:allowReadOnly'
export const PLAN_LIMIT_KEY = 'mnvma:planLimit'
export const SUPER_ADMIN_KEY = 'mnvma:superAdmin'

/** Rota sem autenticação: login, health, webhook. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

/** Exige a permissão para acessar a rota. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission)

/**
 * Marca a rota como leitura, liberando-a mesmo com a conta suspensa ou com o
 * trial expirado. Quem pagou nove meses e atrasou um continua enxergando o
 * próprio histórico.
 */
export const ReadOnlyAllowed = () => SetMetadata(ALLOW_READ_ONLY_KEY, true)

/**
 * Marca a rota como criadora de um recurso que o plano limita. O PlanLimitGuard
 * devolve 402 com os dados de upgrade quando a cota acabou — antes de gravar.
 *
 * O nome do recurso é o mesmo usado no `Plan` (`maxCustomers` → `customers`).
 */
export const PlanLimit = (resource: 'customers' | 'caregivers' | 'users' | 'shiftsPerMonth') =>
  SetMetadata(PLAN_LIMIT_KEY, resource)

/**
 * Rota da administração do MNVMA, não do assinante.
 *
 * Confere o papel, e não uma permissão: o OWNER de cada conta também tem todas
 * as permissões dentro da conta dele, então `billing:write` não separa "dono da
 * empresa cliente" de "dono do SaaS".
 */
export const SomenteSuperAdmin = () => SetMetadata(SUPER_ADMIN_KEY, true)

export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
    const user = request.user
    return field && user ? user[field] : user
  },
)

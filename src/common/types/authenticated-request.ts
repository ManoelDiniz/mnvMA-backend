import type { Request } from 'express'
import type { UserRole } from '../enums/user-role.enum'
import type { TenantStatus, TenantType } from '../enums/tenant.enum'

/** Payload assinado dentro do access token. */
export interface JwtPayload {
  /** user id */
  sub: string
  /** tenant id */
  tid: string
  role: UserRole
  /** tenant type */
  tt: TenantType
  /** caregiver id vinculado, quando houver */
  cgid?: string | null
  iat?: number
  exp?: number
}

/** Forma normalizada que o resto da aplicação consome. */
export interface AuthenticatedUser {
  userId: string
  tenantId: string
  role: UserRole
  tenantType: TenantType
  caregiverId?: string | null
  /** Preenchido pelo TenantStatusGuard quando a rota precisa do estado da conta. */
  tenantStatus?: TenantStatus
}

/**
 * `id` e `cookies` já vêm dos tipos do pino-http e do cookie-parser — redeclarar
 * aqui conflitaria com eles.
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser
}

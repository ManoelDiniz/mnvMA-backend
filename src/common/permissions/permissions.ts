import { TenantType } from '../enums/tenant.enum'
import { UserRole } from '../enums/user-role.enum'

/**
 * Permissões granulares. Papéis (§12 do planejamento de produto) são apenas
 * atalhos para conjuntos delas — o guard sempre confere a permissão, nunca o
 * papel, para que criar um papel novo não exija tocar em controller.
 */
export const PERMISSIONS = [
  'customers:read',
  'customers:write',
  'customers:delete',
  'caregivers:read',
  'caregivers:write',
  'caregivers:delete',
  'services:read',
  'services:write',
  'availability:read',
  'availability:write',
  'shifts:read',
  'shifts:write',
  'shifts:delete',
  'schedules:read',
  'schedules:write',
  'contracts:read',
  'contracts:write',
  'occurrences:read',
  'occurrences:write',
  'documents:read',
  'documents:write',
  'finance:read',
  'finance:write',
  'reports:read',
  'reports:financial',
  'users:read',
  'users:write',
  'settings:read',
  'settings:write',
  'billing:read',
  'billing:write',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const ALL: Permission[] = [...PERMISSIONS]

const READ_ONLY_OPERATION: Permission[] = [
  'customers:read',
  'caregivers:read',
  'services:read',
  'availability:read',
  'shifts:read',
  'schedules:read',
  'occurrences:read',
  'documents:read',
]

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: ALL,

  /** Dono da conta: tudo dentro do próprio tenant, inclusive assinatura. */
  [UserRole.OWNER]: ALL,

  /** Administra a operação inteira, mas não mexe na assinatura. */
  [UserRole.ADMIN]: ALL.filter((p) => p !== 'billing:write'),

  [UserRole.MANAGER]: [
    ...READ_ONLY_OPERATION,
    'customers:write',
    'caregivers:write',
    'services:write',
    'shifts:write',
    'schedules:write',
    'contracts:read',
    'contracts:write',
    'occurrences:write',
    'finance:read',
    'finance:write',
    'reports:read',
    'reports:financial',
    'users:read',
  ],

  [UserRole.COORDINATOR]: [
    ...READ_ONLY_OPERATION,
    'customers:write',
    'availability:write',
    'shifts:write',
    'schedules:write',
    'occurrences:write',
    'reports:read',
  ],

  [UserRole.FINANCE]: [
    'customers:read',
    'caregivers:read',
    'services:read',
    'shifts:read',
    'contracts:read',
    'finance:read',
    'finance:write',
    'reports:read',
    'reports:financial',
  ],

  /**
   * Portal do cuidador: só os próprios dados. O recorte por `caregiverId` é
   * feito pelo OwnDataGuard — a permissão aqui apenas abre a porta da rota.
   */
  [UserRole.CAREGIVER]: [
    'customers:read',
    'availability:read',
    'availability:write',
    'shifts:read',
    'schedules:read',
    'occurrences:read',
    'occurrences:write',
    'documents:read',
  ],
}

/** Módulos liberados por tipo de conta (§3 e §4/§5 do planejamento). */
export const TENANT_MODULES: Record<TenantType, string[]> = {
  [TenantType.INDIVIDUAL]: [
    'dashboard',
    'customers',
    'services',
    'availability',
    'shifts',
    'finance',
    'reports',
    'settings',
    'billing',
  ],
  [TenantType.COMPANY]: [
    'dashboard',
    'customers',
    'caregivers',
    'services',
    'availability',
    'shifts',
    'schedules',
    'contracts',
    'occurrences',
    'substitutions',
    'teams',
    'documents',
    'finance',
    'reports',
    'profitability',
    'users',
    'settings',
    'billing',
  ],
}

export function permissionsFor(role: UserRole, tenantType: TenantType): Permission[] {
  const modules = new Set(TENANT_MODULES[tenantType])
  return ROLE_PERMISSIONS[role].filter((p) => modules.has(p.split(':')[0]))
}

export function hasPermission(
  role: UserRole,
  tenantType: TenantType,
  required: Permission,
): boolean {
  return permissionsFor(role, tenantType).includes(required)
}

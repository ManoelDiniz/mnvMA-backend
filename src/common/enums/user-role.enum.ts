export enum UserRole {
  /** Dono do SaaS (MNVMA Core). Não pertence a nenhum tenant de cliente. */
  SUPER_ADMIN = 'SUPER_ADMIN',
  /** Quem criou a conta. Acesso total dentro do próprio tenant. */
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  COORDINATOR = 'COORDINATOR',
  FINANCE = 'FINANCE',
  /** Profissional: enxerga apenas os próprios dados. */
  CAREGIVER = 'CAREGIVER',
}

/**
 * Rótulo em português, exibido no painel e nos convites. Fica junto do enum
 * porque backend e e-mail precisam da mesma palavra que a tela mostra — o
 * usuário convidado como "Coordenador" não pode receber um e-mail dizendo
 * COORDINATOR.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: 'Super admin',
  [UserRole.OWNER]: 'Titular da conta',
  [UserRole.ADMIN]: 'Administrador',
  [UserRole.MANAGER]: 'Gestor',
  [UserRole.COORDINATOR]: 'Coordenador',
  [UserRole.FINANCE]: 'Financeiro',
  [UserRole.CAREGIVER]: 'Cuidador',
}

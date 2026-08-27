export enum TenantType {
  INDIVIDUAL = 'INDIVIDUAL',
  COMPANY = 'COMPANY',
}

/**
 * Estado comercial da conta. Governa o que o painel libera:
 * TRIAL/ACTIVE/PAST_DUE → leitura e escrita.
 * SUSPENDED/EXPIRED/CANCELED → leitura e exportação, escrita bloqueada.
 * Suspender NUNCA tira o acesso de leitura ao próprio histórico.
 */
export enum TenantStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  SUSPENDED = 'SUSPENDED',
  EXPIRED = 'EXPIRED',
  CANCELED = 'CANCELED',
}

export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  SUSPENDED = 'SUSPENDED',
  CANCELED = 'CANCELED',
}

/** Estados em que a escrita continua liberada. */
export const WRITABLE_TENANT_STATUSES: readonly TenantStatus[] = [
  TenantStatus.TRIAL,
  TenantStatus.ACTIVE,
  TenantStatus.PAST_DUE,
]

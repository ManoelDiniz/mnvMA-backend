/**
 * Só os campos que o MNVMA realmente lê das respostas do Mercado Pago.
 *
 * Mapear a resposta inteira seria trabalho perdido e frágil: o provedor
 * acrescenta e renomeia campo com frequência, e um tipo exagerado transforma
 * mudança irrelevante deles em quebra de compilação aqui. Tudo é opcional
 * porque nada nesta resposta é contrato nosso.
 */

/** `pending` → criada, esperando o pagador. `authorized` → valendo. */
export type MpPreapprovalStatus = 'pending' | 'authorized' | 'paused' | 'cancelled'

export interface MpPreapproval {
  id: string
  status?: MpPreapprovalStatus
  external_reference?: string
  preapproval_plan_id?: string
  payer_id?: number | string
  payer_email?: string
  init_point?: string
  sandbox_init_point?: string
  next_payment_date?: string
  date_created?: string
  last_modified?: string
  auto_recurring?: {
    frequency?: number
    frequency_type?: string
    transaction_amount?: number
    currency_id?: string
    end_date?: string
  }
}

export interface MpPreapprovalPlan {
  id: string
  status?: string
  reason?: string
  auto_recurring?: {
    frequency?: number
    frequency_type?: string
    transaction_amount?: number
    currency_id?: string
  }
}

/** Cobrança recorrente gerada por uma assinatura. */
export interface MpAuthorizedPayment {
  id: number | string
  preapproval_id?: string
  status?: string
  transaction_amount?: number
  currency_id?: string
  payment?: {
    id?: number | string
    status?: string
    status_detail?: string
    payment_method_id?: string
  }
  debit_date?: string
  date_created?: string
  last_modified?: string
  next_retry_date?: string
  retry_attempts?: number
}

/** Pagamento avulso — usado no Fluxo B e na conferência de recibo. */
export interface MpPayment {
  id: number | string
  status?: string
  status_detail?: string
  external_reference?: string
  transaction_amount?: number
  currency_id?: string
  payment_method_id?: string
  date_approved?: string
  date_created?: string
  metadata?: Record<string, unknown>
}

/** Corpo da notificação. O Mercado Pago varia entre `type` e `topic`. */
export interface MpNotification {
  id?: number | string
  type?: string
  topic?: string
  action?: string
  live_mode?: boolean
  date_created?: string
  user_id?: number | string
  api_version?: string
  data?: { id?: number | string }
}

export const MP_TOPIC = {
  PREAPPROVAL: 'subscription_preapproval',
  AUTHORIZED_PAYMENT: 'subscription_authorized_payment',
  PREAPPROVAL_PLAN: 'subscription_preapproval_plan',
  PAYMENT: 'payment',
} as const

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { SubscriptionStatus, TenantStatus, TenantType } from '../../../common/enums/tenant.enum'
import { SubscriptionPaymentStatus } from '../entities/subscription-payment.entity'
import { ActiveDiscountDto } from './coupon.dto'

// ─── Entrada ──────────────────────────────────────────────────────────────────

export class SubscribeDto {
  @ApiProperty({ format: 'uuid', description: 'Plano escolhido' })
  @IsUUID('4', { message: 'Escolha um plano' })
  planId: string

  @ApiPropertyOptional({
    example: 'BEMVINDO50',
    description: 'Cupom de desconto. Em 100%, a conta ativa sem checkout e sem cartão',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || undefined : undefined,
  )
  couponCode?: string
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({
    description: 'Por que está cancelando — fica no histórico e orienta o produto',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : undefined,
  )
  reason?: string
}

// ─── Saída ────────────────────────────────────────────────────────────────────

export class PlanLimitsDto {
  @ApiPropertyOptional({ description: 'null = ilimitado' }) maxCustomers: number | null
  @ApiPropertyOptional({ description: 'null = ilimitado' }) maxCaregivers: number | null
  @ApiPropertyOptional({ description: 'null = ilimitado' }) maxShiftsPerMonth: number | null
  @ApiPropertyOptional({ description: 'null = ilimitado' }) maxUsers: number | null
}

export class PlanDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ example: 'company_start' }) code: string
  @ApiProperty() name: string
  @ApiPropertyOptional() description: string | null
  @ApiProperty({ enum: TenantType }) tenantType: TenantType

  @ApiProperty({ description: 'Preço em centavos', example: 14900 }) priceCents: number
  @ApiProperty({ description: 'Preço formatado em reais', example: '149.00' }) price: string
  @ApiProperty({ example: 'months' }) interval: string
  @ApiProperty() trialDays: number

  @ApiProperty({ type: PlanLimitsDto }) limits: PlanLimitsDto
  @ApiProperty({ type: 'object', additionalProperties: true })
  features: Record<string, unknown>

  @ApiProperty({ description: 'É o plano da assinatura atual' }) current: boolean

  /**
   * `false` quando o uso de hoje não cabe neste plano — 40 cuidadores não
   * entram no plano de 10. A tela desabilita e mostra `blockedReason`.
   */
  @ApiProperty() available: boolean

  @ApiPropertyOptional({ example: '40 cuidadores — o plano permite 10' })
  blockedReason: string | null

  /** Plano gratuito e planos sem correspondente no provedor não têm checkout. */
  @ApiProperty({ description: 'Dá para assinar este plano pelo checkout' })
  checkoutAvailable: boolean
}

export class UsageDto {
  @ApiProperty() customers: number
  @ApiProperty() caregivers: number
  @ApiProperty() users: number
  @ApiProperty({ description: 'Plantões com início no mês corrente' })
  shiftsPerMonth: number
}

export class SubscriptionPaymentDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ enum: SubscriptionPaymentStatus }) status: SubscriptionPaymentStatus
  @ApiProperty({ example: '149.00' }) amount: string
  @ApiProperty() currency: string
  @ApiPropertyOptional() paymentMethod: string | null
  @ApiPropertyOptional({ description: 'Motivo da recusa, quando houver' })
  statusDetail: string | null
  @ApiPropertyOptional() dueAt: Date | null
  @ApiPropertyOptional() paidAt: Date | null
  @ApiPropertyOptional() periodStart: Date | null
  @ApiPropertyOptional() periodEnd: Date | null
  @ApiProperty() createdAt: Date
}

export class SubscriptionDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ enum: SubscriptionStatus }) status: SubscriptionStatus
  @ApiProperty({ enum: TenantStatus, description: 'Estado da conta — é ele que libera a escrita' })
  tenantStatus: TenantStatus

  @ApiPropertyOptional({ type: PlanDto }) plan: PlanDto | null

  @ApiPropertyOptional({ description: 'Downgrade agendado para a virada do período' })
  pendingPlan: PlanDto | null

  @ApiPropertyOptional() trialEndsAt: Date | null
  @ApiProperty({ description: 'Dias restantes de teste; 0 fora do trial' }) trialDaysLeft: number
  @ApiPropertyOptional() currentPeriodEnd: Date | null
  @ApiPropertyOptional() nextChargeAt: Date | null
  @ApiPropertyOptional() canceledAt: Date | null
  @ApiPropertyOptional({ description: 'Desde quando está inadimplente' })
  pastDueSince: Date | null

  @ApiProperty({ description: 'A conta pode escrever agora' }) writable: boolean

  @ApiPropertyOptional({
    description: 'Checkout em aberto: quem fechou o navegador no meio volta por aqui',
  })
  checkoutUrl: string | null

  @ApiProperty({ description: 'A cobrança está configurada neste ambiente' })
  providerReady: boolean

  @ApiProperty({ type: UsageDto }) usage: UsageDto

  @ApiPropertyOptional({ type: SubscriptionPaymentDto })
  lastPayment: SubscriptionPaymentDto | null

  @ApiPropertyOptional({
    type: ActiveDiscountDto,
    description: 'Cupom valendo (ou esperando o pagamento confirmar)',
  })
  discount: ActiveDiscountDto | null
}

export class CheckoutDto {
  @ApiPropertyOptional({
    description: 'Para onde o navegador deve ir. Nulo quando não houve checkout a fazer',
  })
  checkoutUrl: string | null

  /**
   * `true` quando a troca já valeu sem passar pelo provedor — plano gratuito,
   * upgrade de valor numa assinatura que já existe, ou downgrade agendado.
   */
  @ApiProperty({ description: 'Já está valendo; não precisa de checkout' })
  applied: boolean

  @ApiPropertyOptional({ description: 'O que aconteceu, em uma frase, para a tela mostrar' })
  message: string | null

  @ApiProperty({ format: 'uuid' }) subscriptionId: string

  @ApiProperty({
    enum: SubscriptionStatus,
    description: 'Estado atual — só vira ACTIVE pelo webhook, nunca pelo retorno do navegador',
  })
  status: SubscriptionStatus
}

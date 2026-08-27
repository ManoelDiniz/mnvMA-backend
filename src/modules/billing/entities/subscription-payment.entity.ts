import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { MoneyColumn } from '../../../common/database/decimal.transformer'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Subscription } from './subscription.entity'

/**
 * Estados de uma cobrança no provedor, traduzidos para o vocabulário do MNVMA.
 * `CHARGED_BACK` é chargeback: o dinheiro entrou e voltou por contestação.
 */
export enum SubscriptionPaymentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REFUNDED = 'REFUNDED',
  CHARGED_BACK = 'CHARGED_BACK',
  CANCELLED = 'CANCELLED',
}

/**
 * O extrato da assinatura — uma linha por cobrança recorrente processada.
 *
 * É o que responde "por que minha conta foi suspensa?" sem abrir o painel do
 * Mercado Pago, e é o gatilho do dunning: cobrança recusada é o dia D+0.
 *
 * O valor é `decimal(12,2)` lido como string, como todo dinheiro do projeto.
 */
@Entity('subscription_payments')
@Index('idx_subscription_payments_assinatura', ['subscriptionId', 'createdAt'])
export class SubscriptionPayment extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  subscriptionId: string

  @ManyToOne(() => Subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: Subscription

  @Column({ length: 30, default: 'mercadopago' })
  provider: string

  /** `authorized_payment.id` do Mercado Pago. Único por provedor. */
  @Column({ length: 120 })
  mpPaymentId: string

  @ApiProperty({ enum: SubscriptionPaymentStatus })
  @Column({
    type: 'enum',
    enum: SubscriptionPaymentStatus,
    default: SubscriptionPaymentStatus.PENDING,
  })
  status: SubscriptionPaymentStatus

  /** Motivo da recusa, quando houver (`cc_rejected_insufficient_amount`…). */
  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 120, nullable: true })
  statusDetail?: string | null

  @ApiProperty({ example: '149.00' })
  @MoneyColumn({ default: '0.00' })
  amount: string

  @ApiProperty({ default: 'BRL' })
  @Column({ length: 3, default: 'BRL' })
  currency: string

  @ApiPropertyOptional({ example: 'credit_card' })
  @Column({ type: 'varchar', length: 60, nullable: true })
  paymentMethod?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  dueAt?: Date | null

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  paidAt?: Date | null

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  periodStart?: Date | null

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  periodEnd?: Date | null
}

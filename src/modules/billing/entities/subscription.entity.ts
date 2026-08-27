import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm'
import { BaseEntity } from '../../../common/entities/base.entity'
import { SubscriptionStatus } from '../../../common/enums/tenant.enum'
import { Tenant } from '../../tenants/entities/tenant.entity'
import { Plan } from './plan.entity'

@Entity('subscriptions')
export class Subscription extends BaseEntity {
  @Column({ type: 'varchar', length: 36, unique: true })
  tenantId: string

  @OneToOne(() => Tenant, (tenant) => tenant.subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant

  @Column({ type: 'varchar', length: 36 })
  planId: string

  @ManyToOne(() => Plan, { eager: true })
  @JoinColumn({ name: 'plan_id' })
  plan?: Plan

  @ApiProperty({ enum: SubscriptionStatus })
  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.TRIAL })
  status: SubscriptionStatus

  @Column({ length: 30, default: 'mercadopago' })
  provider: string

  /** id da assinatura (preapproval) no Mercado Pago. */
  @Column({ type: 'varchar', length: 120, nullable: true, unique: true })
  mpPreapprovalId?: string | null

  @Column({ type: 'varchar', length: 120, nullable: true })
  mpPayerId?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  currentPeriodEnd?: Date | null

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  nextChargeAt?: Date | null

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  canceledAt?: Date | null

  /** Carência antes de suspender de fato (dunning — ver 03-mercado-pago.md). */
  @Column({ type: 'datetime', precision: 6, nullable: true })
  graceUntil?: Date | null

  /**
   * Em que aviso do dunning a conta está (0 = nenhum). O job só manda o
   * próximo, nunca repete o anterior — cinco e-mails iguais em uma semana
   * ensinam o cliente a filtrar o remetente justamente antes da suspensão.
   */
  @Column({ type: 'tinyint', default: 0 })
  dunningStage: number

  /** Desde quando está inadimplente. É a régua dos dias do dunning. */
  @Column({ type: 'datetime', precision: 6, nullable: true })
  pastDueSince?: Date | null

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastDunningAt?: Date | null

  /**
   * Downgrade agendado. Plano menor não vale na hora: quem pagou o mês tem
   * direito ao mês. Entra quando o período vira, e some se a pessoa desistir.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  pendingPlanId?: string | null

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'pending_plan_id' })
  pendingPlan?: Plan | null

  /**
   * Último `init_point` gerado. Serve para o "continuar de onde parei": quem
   * fechou o navegador no meio do checkout volta na mesma URL em vez de gerar
   * outra assinatura pendente no provedor.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  checkoutUrl?: string | null
}

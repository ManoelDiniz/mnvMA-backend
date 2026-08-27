import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { MoneyColumn } from '../../../common/database/decimal.transformer'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Customer } from '../../customers/entities/customer.entity'

export enum ReceivableStatus {
  /** Ainda vai acontecer — plantão agendado, não realizado. */
  FORECAST = 'FORECAST',
  /** Serviço prestado, dinheiro a entrar. */
  PENDING = 'PENDING',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELED = 'CANCELED',
}

/**
 * Dinheiro a entrar.
 *
 * Nasce de duas formas: gerado automaticamente quando um plantão é concluído,
 * ou lançado à mão (uma venda avulsa, um acerto). O `shiftId` distingue as duas
 * e é único por conta — é ele que impede o mesmo plantão de virar duas cobranças
 * se o status for reprocessado.
 */
@Entity('account_receivables')
@Index('idx_receivables_vencimento', ['tenantId', 'dueDate', 'status'])
@Index('idx_receivables_competencia', ['tenantId', 'competence'])
@Index('idx_receivables_cliente', ['tenantId', 'customerId'])
export class AccountReceivable extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  customerId: string

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer

  @ApiPropertyOptional({ description: 'Plantão de origem. Nulo = lançamento manual.' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  shiftId?: string | null

  /**
   * Contrato de origem. Exclusivo com `shiftId`: ou a cobrança nasceu de um
   * plantão realizado, ou da mensalidade do contrato. Ter os dois preenchidos
   * significaria cobrar o mesmo atendimento duas vezes.
   */
  @ApiPropertyOptional({ description: 'Contrato de origem. Nulo = plantão ou lançamento manual.' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  contractId?: string | null

  @ApiProperty({ description: 'Mês de referência', example: '2026-09' })
  @Column({ type: 'char', length: 7 })
  competence: string

  @ApiProperty()
  @Column({ length: 200 })
  description: string

  @ApiProperty({ example: '300.00' })
  @MoneyColumn()
  amount: string

  @ApiProperty({ type: 'string', format: 'date' })
  @Column({ type: 'date' })
  dueDate: string

  @ApiPropertyOptional()
  @Column({ type: 'date', nullable: true })
  paidAt?: string | null

  @ApiPropertyOptional({ description: 'Pode diferir do previsto: desconto, juros, acerto.' })
  @MoneyColumn({ nullable: true })
  paidAmount?: string | null

  @ApiProperty({ enum: ReceivableStatus })
  @Column({ type: 'enum', enum: ReceivableStatus, default: ReceivableStatus.PENDING })
  status: ReceivableStatus

  @ApiPropertyOptional({ description: 'Id do pagamento no Mercado Pago (Fluxo B)' })
  @Column({ type: 'varchar', length: 120, nullable: true })
  externalRef?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  notes?: string | null
}

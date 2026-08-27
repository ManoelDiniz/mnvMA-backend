import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { MoneyColumn } from '../../../common/database/decimal.transformer'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Caregiver } from '../../caregivers/entities/caregiver.entity'

export enum PayableStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELED = 'CANCELED',
}

/**
 * Categorias de despesa (§8 do planejamento de produto).
 *
 * `CAREGIVER` é a única gerada automaticamente — vem do custo do plantão. As
 * demais são lançadas à mão.
 */
export enum PayableCategory {
  CAREGIVER = 'CAREGIVER',
  TRANSPORT = 'TRANSPORT',
  FOOD = 'FOOD',
  SUPPLIES = 'SUPPLIES',
  TAXES = 'TAXES',
  RENT = 'RENT',
  SOFTWARE = 'SOFTWARE',
  ACCOUNTING = 'ACCOUNTING',
  MARKETING = 'MARKETING',
  COURSES = 'COURSES',
  EQUIPMENT = 'EQUIPMENT',
  OTHER = 'OTHER',
}

/**
 * Dinheiro a sair.
 *
 * O par simétrico da conta a receber: o mesmo plantão que gera a cobrança do
 * cliente gera o pagamento do cuidador. É essa simetria que permite responder
 * "quanto sobrou" sem ninguém digitar nada duas vezes.
 */
@Entity('account_payables')
@Index('idx_payables_vencimento', ['tenantId', 'dueDate', 'status'])
@Index('idx_payables_competencia', ['tenantId', 'competence'])
@Index('idx_payables_categoria', ['tenantId', 'category'])
export class AccountPayable extends TenantBaseEntity {
  @ApiPropertyOptional({ description: 'Preenchido quando a despesa é pagamento de cuidador' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  caregiverId?: string | null

  @ManyToOne(() => Caregiver, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'caregiver_id' })
  caregiver?: Caregiver | null

  @ApiPropertyOptional({ description: 'Fornecedor, quando não é cuidador' })
  @Column({ type: 'varchar', length: 160, nullable: true })
  supplier?: string | null

  @ApiProperty({ enum: PayableCategory })
  @Column({ type: 'enum', enum: PayableCategory, default: PayableCategory.OTHER })
  category: PayableCategory

  @ApiPropertyOptional({ description: 'Plantão de origem. Nulo = lançamento manual.' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  shiftId?: string | null

  @ApiProperty({ example: '2026-09' })
  @Column({ type: 'char', length: 7 })
  competence: string

  @ApiProperty()
  @Column({ length: 200 })
  description: string

  @ApiProperty({ example: '180.00' })
  @MoneyColumn()
  amount: string

  @ApiProperty({ type: 'string', format: 'date' })
  @Column({ type: 'date' })
  dueDate: string

  @ApiPropertyOptional()
  @Column({ type: 'date', nullable: true })
  paidAt?: string | null

  @ApiPropertyOptional()
  @MoneyColumn({ nullable: true })
  paidAmount?: string | null

  @ApiProperty({ enum: PayableStatus })
  @Column({ type: 'enum', enum: PayableStatus, default: PayableStatus.PENDING })
  status: PayableStatus

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  notes?: string | null
}

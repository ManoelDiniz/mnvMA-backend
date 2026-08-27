import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { MoneyColumn } from '../../../common/database/decimal.transformer'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Caregiver } from '../../caregivers/entities/caregiver.entity'
import { Customer } from '../../customers/entities/customer.entity'
import { Service } from '../../services/entities/service.entity'

export enum ShiftStatus {
  PLANNED = 'PLANNED',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
  NO_SHOW = 'NO_SHOW',
}

/**
 * O plantão é o centro do sistema. Tudo converge para ele:
 *
 *     PLANTÃO ├── valor cobrado  → conta a receber
 *             └── custo do cuidador → conta a pagar
 *
 * Dois pontos que parecem detalhe e não são:
 *
 * 1. Os valores são COPIADOS do serviço no momento da criação, não referenciados.
 *    Corrigir a tabela de preços em março não pode reescrever o faturamento de
 *    janeiro.
 *
 * 2. `startsAt`/`endsAt` são timestamps completos em UTC, não data + hora. Um
 *    plantão noturno 19h→07h atravessa o dia, e tratar isso como "data + hora
 *    inicial + hora final" quebra o cálculo de horas em toda virada de dia — e
 *    no horário de verão, quando ele voltar.
 */
@Entity('shifts')
@Index('idx_shifts_tenant_inicio', ['tenantId', 'startsAt'])
@Index('idx_shifts_tenant_cuidador', ['tenantId', 'caregiverId', 'startsAt'])
@Index('idx_shifts_tenant_cliente', ['tenantId', 'customerId', 'startsAt'])
@Index('idx_shifts_tenant_status', ['tenantId', 'status'])
export class Shift extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  customerId: string

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer

  @ApiPropertyOptional({ description: 'Nulo = plantão descoberto, sem cuidador' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  caregiverId?: string | null

  @ManyToOne(() => Caregiver, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'caregiver_id' })
  caregiver?: Caregiver | null

  @Column({ type: 'varchar', length: 36, nullable: true })
  serviceId?: string | null

  @ManyToOne(() => Service, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_id' })
  service?: Service | null

  @ApiProperty({ description: 'Início em UTC' })
  @Column({ type: 'datetime', precision: 6 })
  startsAt: Date

  @ApiProperty({ description: 'Fim em UTC. Pode cair no dia seguinte.' })
  @Column({ type: 'datetime', precision: 6 })
  endsAt: Date

  @ApiProperty({ description: 'Valor cobrado do cliente', example: '300.00' })
  @MoneyColumn()
  chargeAmount: string

  @ApiProperty({ description: 'Valor pago ao cuidador. Zero em conta individual.' })
  @MoneyColumn({ default: '0.00' })
  caregiverCost: string

  @ApiProperty({ description: 'Transporte, alimentação, material do plantão' })
  @MoneyColumn({ default: '0.00' })
  otherCosts: string

  @ApiProperty({ enum: ShiftStatus })
  @Column({ type: 'enum', enum: ShiftStatus, default: ShiftStatus.PLANNED })
  status: ShiftStatus

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  checkInAt?: Date | null

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  checkOutAt?: Date | null

  @ApiPropertyOptional({ description: 'Motivo do cancelamento ou da falta' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  statusReason?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  notes?: string | null
}

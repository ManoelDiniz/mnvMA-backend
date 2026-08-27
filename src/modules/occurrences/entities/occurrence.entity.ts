import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Caregiver } from '../../caregivers/entities/caregiver.entity'
import { Customer } from '../../customers/entities/customer.entity'
import { Shift } from '../../shifts/entities/shift.entity'

export enum OccurrenceType {
  /** Piora, mal-estar, alteração de sinais vitais. */
  HEALTH = 'HEALTH',
  FALL = 'FALL',
  /** Medicação esquecida, trocada ou recusada. */
  MEDICATION = 'MEDICATION',
  BEHAVIOR = 'BEHAVIOR',
  /** Cuidador faltou. */
  ABSENCE = 'ABSENCE',
  DELAY = 'DELAY',
  EQUIPMENT = 'EQUIPMENT',
  /** Reclamação ou pedido da família. */
  FAMILY = 'FAMILY',
  OTHER = 'OTHER',
}

/**
 * Gravidade declarada por quem registra.
 *
 * `CRITICAL` é o que exige alguém agora — queda com ferimento, internação. A
 * separação existe para que a lista da coordenação não misture "atrasou 10
 * minutos" com "foi para o pronto-socorro".
 */
export enum OccurrenceSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * Registro de ocorrência no plantão.
 *
 * É o prontuário operacional da empresa: quando a família cobra ou quando surge
 * questionamento trabalhista, o que existe é isto. Por isso três decisões:
 *
 * 1. **Nunca some.** Sem exclusão física; correção vira edição com histórico de
 *    `updatedAt`, não apagamento.
 * 2. **`occurredAt` é separado de `createdAt`.** O cuidador registra depois do
 *    plantão, às vezes no dia seguinte — misturar as duas datas faria o
 *    relatório dizer que a queda aconteceu quando o relato foi digitado.
 * 3. **`shiftId` é opcional.** Nem toda ocorrência acontece dentro de um
 *    plantão: uma ligação da família às 22h também precisa ficar registrada.
 */
@Entity('occurrences')
@Index('idx_occurrences_data', ['tenantId', 'occurredAt'])
@Index('idx_occurrences_cliente', ['tenantId', 'customerId', 'occurredAt'])
@Index('idx_occurrences_cuidador', ['tenantId', 'caregiverId', 'occurredAt'])
@Index('idx_occurrences_gravidade', ['tenantId', 'severity', 'resolvedAt'])
export class Occurrence extends TenantBaseEntity {
  @ApiPropertyOptional({ description: 'Plantão em que aconteceu. Nulo = fora de plantão.' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  shiftId?: string | null

  @ManyToOne(() => Shift, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift | null

  @Column({ type: 'varchar', length: 36 })
  customerId: string

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer

  @ApiPropertyOptional({ description: 'Quem estava no plantão' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  caregiverId?: string | null

  @ManyToOne(() => Caregiver, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'caregiver_id' })
  caregiver?: Caregiver | null

  @ApiProperty({ enum: OccurrenceType })
  @Column({ type: 'enum', enum: OccurrenceType, default: OccurrenceType.OTHER })
  type: OccurrenceType

  @ApiProperty({ enum: OccurrenceSeverity })
  @Column({ type: 'enum', enum: OccurrenceSeverity, default: OccurrenceSeverity.LOW })
  severity: OccurrenceSeverity

  @ApiProperty({ description: 'Quando aconteceu, em UTC' })
  @Column({ type: 'datetime', precision: 6 })
  occurredAt: Date

  @ApiProperty()
  @Column({ length: 200 })
  title: string

  @ApiProperty({ description: 'O relato completo' })
  @Column({ type: 'text' })
  description: string

  @ApiPropertyOptional({ description: 'O que foi feito na hora' })
  @Column({ type: 'text', nullable: true })
  actionTaken?: string | null

  @ApiProperty({ description: 'A família foi avisada' })
  @Column({ default: false })
  familyNotified: boolean

  @ApiPropertyOptional({ description: 'Quando a coordenação deu o caso por encerrado' })
  @Column({ type: 'datetime', precision: 6, nullable: true })
  resolvedAt?: Date | null

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  resolution?: string | null

  @ApiPropertyOptional({ description: 'Usuário que registrou' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  reportedByUserId?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 160, nullable: true })
  reportedByName?: string | null
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Caregiver } from '../../caregivers/entities/caregiver.entity'
import { Shift } from './shift.entity'

/**
 * Histórico de troca de cuidador num plantão.
 *
 * Sem este registro, a substituição some: o plantão passa a mostrar só quem
 * ficou, e ninguém consegue responder "quantas vezes a Maria largou plantão no
 * último mês?" nem "por que o cliente reclamou de rotatividade?". O plantão
 * guarda o estado atual; esta tabela guarda o que aconteceu.
 *
 * `previousCaregiverId` é nulo quando o plantão estava descoberto — cobrir um
 * buraco na escala é diferente de trocar alguém que já estava lá, e o relatório
 * de rotatividade só faz sentido se as duas coisas ficarem separadas.
 */
@Entity('shift_substitutions')
@Index('idx_substitutions_plantao', ['tenantId', 'shiftId'])
@Index('idx_substitutions_anterior', ['tenantId', 'previousCaregiverId'])
export class ShiftSubstitution extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  shiftId: string

  @ManyToOne(() => Shift, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift

  @ApiPropertyOptional({ description: 'Nulo quando o plantão estava sem cuidador' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  previousCaregiverId?: string | null

  @ManyToOne(() => Caregiver, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'previous_caregiver_id' })
  previousCaregiver?: Caregiver | null

  @Column({ type: 'varchar', length: 36 })
  newCaregiverId: string

  @ManyToOne(() => Caregiver, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'new_caregiver_id' })
  newCaregiver?: Caregiver

  @ApiProperty({ description: 'Por que houve a troca' })
  @Column({ length: 255 })
  reason: string

  @ApiPropertyOptional({ description: 'Quem fez a troca' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  changedByUserId?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 160, nullable: true })
  changedByName?: string | null

  @ApiProperty({
    description: 'Custo do cuidador antes da troca. O novo pode cobrar diferente.',
  })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: '0.00' })
  previousCost: string
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Caregiver } from './caregiver.entity'

export enum AvailabilityKind {
  /** "Toda terça, das 7h às 19h" — a rotina do profissional. */
  RECURRING = 'RECURRING',
  /** "De 15/09 a 20/09 não posso, viagem" — indisponibilidade pontual. */
  BLOCK = 'BLOCK',
}

/**
 * Duas coisas diferentes na mesma tabela, de propósito: quem monta a escala
 * precisa responder uma única pergunta — "esta pessoa pode neste horário?" — e
 * separar em duas tabelas obrigaria a consultar as duas em toda verificação.
 *
 * O bloqueio SEMPRE vence a recorrência. Quem avisou que viaja não deve
 * aparecer como disponível só porque a terça-feira dele é livre.
 */
@Entity('caregiver_availabilities')
@Index('idx_availability_cuidador', ['tenantId', 'caregiverId'])
export class CaregiverAvailability extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  caregiverId: string

  @ManyToOne(() => Caregiver, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caregiver_id' })
  caregiver?: Caregiver

  @ApiProperty({ enum: AvailabilityKind })
  @Column({ type: 'enum', enum: AvailabilityKind })
  kind: AvailabilityKind

  @ApiPropertyOptional({ description: 'RECURRING: 0 = domingo … 6 = sábado' })
  @Column({ type: 'tinyint', nullable: true })
  weekday?: number | null

  @ApiPropertyOptional({ description: 'RECURRING: "07:00"' })
  @Column({ type: 'time', nullable: true })
  startTime?: string | null

  @ApiPropertyOptional({ description: 'RECURRING: "19:00". Menor que o início = vira o dia.' })
  @Column({ type: 'time', nullable: true })
  endTime?: string | null

  @ApiPropertyOptional({ description: 'BLOCK: início em UTC' })
  @Column({ type: 'datetime', precision: 6, nullable: true })
  blockedFrom?: Date | null

  @ApiPropertyOptional({ description: 'BLOCK: fim em UTC' })
  @Column({ type: 'datetime', precision: 6, nullable: true })
  blockedTo?: Date | null

  @ApiPropertyOptional({ example: 'Viagem' })
  @Column({ type: 'varchar', length: 160, nullable: true })
  reason?: string | null
}

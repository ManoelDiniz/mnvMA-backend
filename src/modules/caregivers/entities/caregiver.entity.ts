import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index } from 'typeorm'
import { MoneyColumn } from '../../../common/database/decimal.transformer'
import { TenantBaseEntity } from '../../../common/entities/base.entity'

/**
 * Profissional que executa o plantão.
 *
 * Na conta INDIVIDUAL existe exatamente um, com `isOwner = true`, criado junto
 * com o cadastro. Parece redundante, mas é o que faz a conta individual e a
 * empresarial compartilharem o mesmo modelo de plantão, escala e custo — e o
 * que permite migrar de uma para a outra sem mover dado nenhum.
 */
@Entity('caregivers')
@Index('idx_caregivers_tenant_name', ['tenantId', 'name'])
export class Caregiver extends TenantBaseEntity {
  @ApiProperty()
  @Column()
  name: string

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 14, nullable: true })
  cpf?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 180, nullable: true })
  email?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'date', nullable: true })
  birthDate?: string | null

  @ApiPropertyOptional({ example: 'CLT | PJ | AUTONOMO | DIARISTA' })
  @Column({ type: 'varchar', length: 30, nullable: true })
  contractType?: string | null

  @ApiPropertyOptional({ description: 'Valor/hora em reais', example: '25.00' })
  @MoneyColumn({ nullable: true })
  hourlyRate?: string | null

  @ApiPropertyOptional({ description: 'Valor do plantão em reais', example: '180.00' })
  @MoneyColumn({ nullable: true })
  shiftRate?: string | null

  @ApiProperty({ description: 'É o próprio dono da conta individual' })
  @Column({ default: false })
  isOwner: boolean

  @ApiProperty()
  @Column({ default: true })
  isActive: boolean

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  notes?: string | null
}

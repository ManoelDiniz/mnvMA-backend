import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index } from 'typeorm'
import { MoneyColumn } from '../../../common/database/decimal.transformer'
import { TenantBaseEntity } from '../../../common/entities/base.entity'

export enum ServiceUnit {
  /** Um plantão fechado (12h, 24h). É a unidade mais comum no setor. */
  SHIFT = 'PLANTAO',
  HOUR = 'HORA',
  DAY = 'DIA',
}

/**
 * Catálogo de serviços: "Cuidador 12h diurno", "Acompanhante hospitalar".
 *
 * Guarda os DOIS valores — o que se cobra do cliente e o que se paga ao
 * profissional — porque é daqui que sai a margem de cada plantão. Numa conta
 * individual `caregiverCost` fica nulo: não existe custo com terceiro, o
 * dinheiro todo é do próprio cuidador.
 */
@Entity('services')
@Index('idx_services_tenant_name', ['tenantId', 'name'])
export class Service extends TenantBaseEntity {
  @ApiProperty({ example: 'Cuidador 12h diurno' })
  @Column({ length: 160 })
  name: string

  @ApiPropertyOptional({ description: 'Código interno para relatórios', example: 'CD12D' })
  @Column({ type: 'varchar', length: 30, nullable: true })
  code?: string | null

  @ApiProperty({ enum: ServiceUnit, default: ServiceUnit.SHIFT })
  @Column({ type: 'enum', enum: ServiceUnit, default: ServiceUnit.SHIFT })
  unit: ServiceUnit

  @ApiProperty({ description: 'Valor cobrado do cliente', example: '300.00' })
  @MoneyColumn()
  salePrice: string

  @ApiPropertyOptional({
    description: 'Valor pago ao cuidador. Nulo em conta individual.',
    example: '180.00',
  })
  @MoneyColumn({ nullable: true })
  caregiverCost?: string | null

  @ApiPropertyOptional({ description: 'Duração em horas, para calcular valor/hora' })
  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  hours?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  notes?: string | null

  @ApiProperty()
  @Column({ default: true })
  isActive: boolean
}

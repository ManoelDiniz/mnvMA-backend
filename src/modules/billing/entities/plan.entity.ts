import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity } from 'typeorm'
import { BaseEntity } from '../../../common/entities/base.entity'
import { TenantType } from '../../../common/enums/tenant.enum'

/**
 * Catálogo global de planos — não pertence a nenhum tenant e por isso não tem
 * RLS. Editável pelo Super Admin (§19: "os limites devem ser configuráveis").
 *
 * `mpPreapprovalPlanId` é o id do plano de assinatura correspondente no Mercado
 * Pago; fica nulo no plano gratuito, que não existe lá.
 */
@Entity('plans')
export class Plan extends BaseEntity {
  @ApiProperty({ example: 'individual_pro' })
  @Column({ length: 60, unique: true })
  code: string

  @ApiProperty({ example: 'Individual Pro' })
  @Column()
  name: string

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  description?: string | null

  @ApiProperty({ enum: TenantType })
  @Column({ type: 'enum', enum: TenantType })
  tenantType: TenantType

  @ApiProperty({ description: 'Preço em centavos', example: 4990 })
  @Column({ type: 'int' })
  priceCents: number

  @ApiProperty({ default: 'months' })
  @Column({ default: 'months' })
  interval: string

  @ApiProperty({ default: 1 })
  @Column({ type: 'int', default: 1 })
  intervalCount: number

  @ApiProperty({ default: 14 })
  @Column({ type: 'int', default: 14 })
  trialDays: number

  @ApiPropertyOptional({ description: 'null = ilimitado' })
  @Column({ type: 'int', nullable: true })
  maxCustomers?: number | null

  @ApiPropertyOptional({ description: 'null = ilimitado' })
  @Column({ type: 'int', nullable: true })
  maxCaregivers?: number | null

  @ApiPropertyOptional({ description: 'null = ilimitado' })
  @Column({ type: 'int', nullable: true })
  maxShiftsPerMonth?: number | null

  @ApiPropertyOptional({ description: 'null = ilimitado' })
  @Column({ type: 'int', nullable: true })
  maxUsers?: number | null

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ type: 'json', nullable: true })
  features: Record<string, unknown>

  @Column({ type: 'varchar', nullable: true })
  mpPreapprovalPlanId?: string | null

  @ApiProperty()
  @Column({ default: true })
  isActive: boolean

  @ApiProperty({ description: 'Ordem de exibição na tela de planos' })
  @Column({ type: 'int', default: 0 })
  sortOrder: number
}

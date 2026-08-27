import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, OneToMany, OneToOne } from 'typeorm'
import { BaseEntity } from '../../../common/entities/base.entity'
import { TenantStatus, TenantType } from '../../../common/enums/tenant.enum'
import type { Subscription } from '../../billing/entities/subscription.entity'
import type { User } from '../../users/entities/user.entity'

/**
 * Raiz do multi-tenant. Toda entidade de negócio aponta para cá via `tenant_id`.
 *
 * Individual e Empresa são o MESMO registro com `type` diferente: é isso que
 * torna a migração Individual → Empresa (§18) uma troca de enum e liberação de
 * módulos, sem mover um único dado de tabela.
 */
@Entity('tenants')
export class Tenant extends BaseEntity {
  @ApiProperty({ example: 'Cuidados São João' })
  @Column()
  name: string

  @ApiProperty({ enum: TenantType })
  @Column({ type: 'enum', enum: TenantType })
  type: TenantType

  @ApiPropertyOptional({ description: 'CPF (individual) ou CNPJ (empresa)' })
  @Index()
  @Column({ type: 'varchar', length: 18, nullable: true })
  document?: string | null

  @ApiProperty({ enum: TenantStatus })
  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.TRIAL })
  status: TenantStatus

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  trialEndsAt?: Date | null

  @ApiProperty({ default: 'America/Sao_Paulo' })
  @Column({ default: 'America/Sao_Paulo' })
  timezone: string

  @OneToMany('User', 'tenant')
  users?: User[]

  @OneToOne('Subscription', 'tenant')
  subscription?: Subscription
}

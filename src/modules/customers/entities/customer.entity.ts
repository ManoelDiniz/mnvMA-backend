import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, OneToMany } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { CustomerResponsible } from './customer-responsible.entity'

export interface CustomerAddress {
  street?: string
  number?: string
  complement?: string
  district?: string
  city?: string
  state?: string
  zipCode?: string
}

@Entity('customers')
@Index('idx_customers_tenant_name', ['tenantId', 'name'])
export class Customer extends TenantBaseEntity {
  @ApiProperty({ example: 'Maria da Silva' })
  @Column()
  name: string

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 14, nullable: true })
  cpf?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'date', nullable: true })
  birthDate?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 180, nullable: true })
  email?: string | null

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @Column({ type: 'json', nullable: true })
  address?: CustomerAddress | null

  @ApiPropertyOptional({ description: 'Observações de cuidado, rotina, restrições' })
  @Column({ type: 'text', nullable: true })
  notes?: string | null

  @ApiProperty()
  @Column({ default: true })
  isActive: boolean

  @ApiPropertyOptional({ type: () => [CustomerResponsible] })
  @OneToMany(() => CustomerResponsible, (responsible) => responsible.customer, {
    cascade: ['insert', 'update'],
  })
  responsibles?: CustomerResponsible[]
}

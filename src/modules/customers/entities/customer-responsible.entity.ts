import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Customer } from './customer.entity'

/**
 * Um cliente pode ter vários responsáveis, e os papéis não são exclusivos: quem
 * recebe a cobrança pode não ser quem se chama numa emergência. Por isso três
 * flags independentes em vez de um enum de "tipo de responsável".
 */
@Entity('customer_responsibles')
@Index('idx_customer_responsibles_customer', ['tenantId', 'customerId'])
export class CustomerResponsible extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  customerId: string

  @ManyToOne(() => Customer, (customer) => customer.responsibles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer

  @ApiProperty()
  @Column()
  name: string

  @ApiPropertyOptional({ example: 'Filha' })
  @Column({ type: 'varchar', length: 60, nullable: true })
  relationship?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 180, nullable: true })
  email?: string | null

  @ApiProperty({ description: 'Contato principal do cliente' })
  @Column({ default: false })
  isPrimary: boolean

  @ApiProperty({ description: 'Recebe as cobranças' })
  @Column({ default: false })
  isFinancial: boolean

  @ApiProperty({ description: 'Acionado em emergências' })
  @Column({ default: false })
  isEmergency: boolean
}

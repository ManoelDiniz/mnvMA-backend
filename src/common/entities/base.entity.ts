import { ApiProperty } from '@nestjs/swagger'
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
// Import de TIPO apenas: `TenantBaseEntity` é a base de quase toda entidade, e
// importar a classe Tenant aqui criaria um ciclo em tempo de execução
// (tenant.entity → base.entity → tenant.entity). A relação usa o nome da
// entidade em string, que o TypeORM resolve depois de tudo carregado.
import type { Tenant } from '../../modules/tenants/entities/tenant.entity'

/**
 * `datetime(6)` guarda UTC puro — o MySQL não tem tipo com fuso. A conversão
 * para America/Sao_Paulo acontece só na borda (API formatando ou painel
 * exibindo), e a conexão usa `timezone: 'Z'` para nunca reinterpretar valor.
 */
export abstract class BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string

  @ApiProperty()
  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date

  @ApiProperty()
  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date

  /**
   * Soft delete. Histórico financeiro nunca é apagado de verdade — um plantão
   * pago que some leva junto a conta a receber que o originou.
   */
  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true })
  deletedAt?: Date | null
}

/**
 * Base de toda entidade de negócio. O `tenantId` é preenchido pelo
 * TenantScopedRepository e conferido por trigger no MySQL. Nenhum service deve
 * setar esse campo na mão.
 */
export abstract class TenantBaseEntity extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 36 })
  tenantId: string

  @ManyToOne('Tenant', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant
}

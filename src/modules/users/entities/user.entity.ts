import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Exclude } from 'class-transformer'
import { Column, Entity, Index } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { UserRole } from '../../../common/enums/user-role.enum'

/**
 * O e-mail é único globalmente (não por tenant): o login procura por e-mail
 * antes de saber a que conta ele pertence, e dois usuários com o mesmo endereço
 * em contas diferentes tornariam a autenticação ambígua.
 *
 * A unicidade real está na migration, com a coluna gerada `deleted_marker` —
 * o MySQL não tem índice parcial (`WHERE deleted_at IS NULL`), então o truque é
 * incluir um marcador na chave.
 */
@Entity('users')
@Index('idx_users_tenant_email', ['tenantId', 'email'])
export class User extends TenantBaseEntity {
  @ApiProperty()
  @Column()
  name: string

  @ApiProperty({ format: 'email' })
  @Column({ length: 180 })
  email: string

  /** `select: false`: nunca sai numa consulta por acidente. */
  @Exclude()
  @Column({ select: false })
  passwordHash: string

  @ApiProperty({ enum: UserRole })
  @Column({ type: 'enum', enum: UserRole })
  role: UserRole

  @ApiPropertyOptional({ description: 'Cuidador vinculado (papel CAREGIVER)' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  caregiverId?: string | null

  @ApiProperty()
  @Column({ default: true })
  isActive: boolean

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastLoginAt?: Date | null
}

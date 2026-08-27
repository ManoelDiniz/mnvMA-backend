import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Exclude } from 'class-transformer'
import { Column, Entity, Index } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { UserRole } from '../../../common/enums/user-role.enum'

/**
 * Convite para entrar numa conta.
 *
 * O usuário só existe depois de aceitar. Criar a conta na hora do convite e
 * deixá-la "pendente" pareceria mais simples, mas queimaria o e-mail: a
 * unicidade global de `users.email` impediria a pessoa de ser convidada por
 * outra empresa enquanto o primeiro convite dormisse na caixa de entrada.
 *
 * O token vai por e-mail e **só o hash fica aqui**. Um dump do banco não deve
 * entregar acesso a nenhuma conta, e um convite é exatamente isso: uma chave de
 * entrada com papel já definido.
 */
@Entity('invitations')
@Index('idx_invitations_email', ['tenantId', 'email'])
@Index('idx_invitations_token', ['tokenHash'])
export class Invitation extends TenantBaseEntity {
  @ApiProperty({ format: 'email' })
  @Column({ length: 180 })
  email: string

  @ApiProperty()
  @Column({ length: 160 })
  name: string

  @ApiProperty({ enum: UserRole })
  @Column({ type: 'enum', enum: UserRole })
  role: UserRole

  @ApiPropertyOptional({ description: 'Cuidador a vincular quando o papel é CAREGIVER' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  caregiverId?: string | null

  /** SHA-256 do token. `select: false`: nunca sai numa consulta por acidente. */
  @Exclude()
  @Column({ length: 64, select: false })
  tokenHash: string

  @ApiProperty()
  @Column({ type: 'datetime', precision: 6 })
  expiresAt: Date

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  acceptedAt?: Date | null

  @ApiPropertyOptional({ description: 'Convite cancelado antes de ser aceito' })
  @Column({ type: 'datetime', precision: 6, nullable: true })
  revokedAt?: Date | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 36, nullable: true })
  invitedByUserId?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 160, nullable: true })
  invitedByName?: string | null
}

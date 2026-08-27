import { Exclude } from 'class-transformer'
import { Column, Entity, Index } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'

/**
 * Pedido de redefinição de senha.
 *
 * Mesmo desenho do convite e do refresh token: o segredo vai por e-mail e aqui
 * fica **só o SHA-256**. Um dump do banco não pode virar acesso a conta nenhuma,
 * e um token de redefinição é exatamente isso — uma chave que troca a senha de
 * alguém sem saber a antiga.
 *
 * A linha não é apagada depois do uso: `usedAt` preenchido é o que permite
 * responder "este link já foi usado" em vez de "link inválido", e é o registro
 * de que a senha daquele usuário mudou por este caminho.
 */
@Entity('password_reset_tokens')
@Index('idx_password_resets_token', ['tokenHash'], { unique: true })
@Index('idx_password_resets_user', ['userId', 'usedAt'])
export class PasswordResetToken extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  userId: string

  /** SHA-256 do token. `select: false`: nunca sai numa consulta por acidente. */
  @Exclude()
  @Column({ length: 64, select: false })
  tokenHash: string

  @Column({ type: 'datetime', precision: 6 })
  expiresAt: Date

  @Column({ type: 'datetime', precision: 6, nullable: true })
  usedAt?: Date | null

  /** De onde veio o pedido — para investigar abuso sem precisar do log bruto. */
  @Column({ type: 'varchar', length: 45, nullable: true })
  requestedIp?: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  requestedUserAgent?: string | null
}

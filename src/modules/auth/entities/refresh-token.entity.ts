import { Column, Entity, Index } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'

/**
 * Refresh token rotativo com detecção de reuso.
 *
 * Guardamos apenas o HASH do token (SHA-256) — o valor em claro só existe no
 * cookie do usuário. Se um token já rotacionado for apresentado de novo, é
 * sinal de roubo: toda a família (`familyId`) é revogada de uma vez.
 */
@Entity('refresh_tokens')
@Index('idx_refresh_tokens_family', ['familyId'])
export class RefreshToken extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  userId: string

  @Index('uq_refresh_tokens_hash', { unique: true })
  @Column({ type: 'char', length: 64 })
  tokenHash: string

  /** Agrupa a cadeia de rotações originada de um mesmo login. */
  @Column({ type: 'varchar', length: 36 })
  familyId: string

  @Column({ type: 'datetime', precision: 6 })
  expiresAt: Date

  @Column({ type: 'datetime', precision: 6, nullable: true })
  revokedAt?: Date | null

  @Column({ type: 'varchar', length: 36, nullable: true })
  replacedById?: string | null

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip?: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent?: string | null
}

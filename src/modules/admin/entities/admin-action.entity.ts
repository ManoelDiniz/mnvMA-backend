import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index } from 'typeorm'
import { BaseEntity } from '../../../common/entities/base.entity'

/** O que o dono do SaaS pode fazer na conta de um cliente. */
export enum AdminActionType {
  TENANT_SUSPEND = 'tenant.suspend',
  TENANT_REACTIVATE = 'tenant.reactivate',
  COUPON_CREATE = 'coupon.create',
  COUPON_UPDATE = 'coupon.update',
  COUPON_REDEMPTION_CANCEL = 'coupon.redemption.cancel',
}

export const ROTULO_ACAO: Record<AdminActionType, string> = {
  [AdminActionType.TENANT_SUSPEND]: 'Conta suspensa',
  [AdminActionType.TENANT_REACTIVATE]: 'Conta reativada',
  [AdminActionType.COUPON_CREATE]: 'Cupom criado',
  [AdminActionType.COUPON_UPDATE]: 'Cupom alterado',
  [AdminActionType.COUPON_REDEMPTION_CANCEL]: 'Resgate de cupom cancelado',
}

/**
 * Uma ação administrativa sobre uma conta de cliente.
 *
 * A pergunta que esta tabela responde é sempre a mesma, e sempre num momento
 * ruim: "por que a minha conta parou?". Sem ela, a resposta depende de alguém
 * lembrar o que fez, ou de caçar linha em agregador de log.
 *
 * `reason` é obrigatório nas ações que mudam a vida do cliente — não por
 * burocracia, mas porque a ação sem motivo é a que ninguém consegue explicar
 * depois.
 */
@Entity('admin_actions')
@Index('idx_admin_actions_conta', ['targetTenantId', 'createdAt'])
export class AdminAction extends BaseEntity {
  @Column({ type: 'varchar', length: 36 })
  actorUserId: string

  /** Copiado no momento da ação: o usuário pode mudar de e-mail depois. */
  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 180, nullable: true })
  actorEmail?: string | null

  @ApiProperty({ enum: AdminActionType })
  @Column({ length: 60 })
  action: string

  @ApiPropertyOptional({ format: 'uuid' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  targetTenantId?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 500, nullable: true })
  reason?: string | null

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null
}

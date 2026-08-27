import { ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { BaseEntity } from '../../../common/entities/base.entity'
import { Coupon } from './coupon.entity'

/**
 * Quem tem direito a um cupom restrito.
 *
 * Cupom **sem nenhum alvo é aberto**: qualquer conta resgata. Basta uma linha
 * aqui para ele virar restrito, e aí só quem está na lista entra. É essa
 * inversão que permite os dois tipos de campanha sem coluna de configuração:
 * a pública e a nominal.
 *
 * O alvo é por e-mail ou por conta. E-mail existe porque a campanha costuma vir
 * antes do cadastro — você negocia com dez donas de casa de repouso e manda o
 * código; nenhuma delas tem conta ainda. Conta existe para o caso oposto: dar
 * desconto a um cliente que já está aqui, sem depender de qual e-mail ele usa
 * para entrar.
 *
 * A coluna é `target_tenant_id`, e não `tenant_id`, de propósito: neste projeto
 * `tenant_id` significa "esta linha pertence a este tenant" e vem com trigger
 * de guarda. Aqui é só um ponteiro numa tabela administrativa global.
 */
@Entity('coupon_targets')
@Index('uq_coupon_targets_email', ['couponId', 'email'], { unique: true })
@Index('uq_coupon_targets_tenant', ['couponId', 'targetTenantId'], { unique: true })
export class CouponTarget extends BaseEntity {
  @Column({ type: 'varchar', length: 36 })
  couponId: string

  @ManyToOne(() => Coupon, (coupon) => coupon.targets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coupon_id' })
  coupon?: Coupon

  /** Sempre em minúsculas: e-mail não diferencia caixa na prática. */
  @ApiPropertyOptional({ format: 'email' })
  @Column({ type: 'varchar', length: 180, nullable: true })
  email?: string | null

  @ApiPropertyOptional({ format: 'uuid' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  targetTenantId?: string | null
}

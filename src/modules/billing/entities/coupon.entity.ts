import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, OneToMany } from 'typeorm'
import { BaseEntity } from '../../../common/entities/base.entity'
import { TenantType } from '../../../common/enums/tenant.enum'
import { CouponTarget } from './coupon-target.entity'

/**
 * Um cupom de desconto sobre a mensalidade.
 *
 * Catálogo global, como `Plan`: não pertence a tenant nenhum e só o dono do
 * SaaS cria. Quem usa é a conta, e o uso vira `CouponRedemption`.
 *
 * Duas datas que parecem a mesma coisa e não são, e confundi-las é o erro mais
 * comum aqui:
 *
 *   • `expiresAt` fecha a janela de RESGATE — até quando dá para digitar o
 *     código. Não tem nada a ver com quanto tempo o desconto dura.
 *   • `maxInvoices` é a DURAÇÃO do benefício: por quantas faturas ele vale.
 *     Num cupom de 100%, é por quantos ciclos a conta fica em cortesia.
 *
 * Um cupom "50% nas 3 primeiras faturas, resgatável até 31/12" é
 * `discountPercent: 50, maxInvoices: 3, expiresAt: 2026-12-31`.
 */
@Entity('coupons')
@Index('idx_coupons_ativos', ['isActive', 'expiresAt'])
export class Coupon extends BaseEntity {
  /** Normalizado em maiúsculas na entrada: `bemvindo10` e `BEMVINDO10` são o mesmo. */
  @ApiProperty({ example: 'BEMVINDO50' })
  @Column({ length: 40, unique: true })
  code: string

  @ApiProperty({ example: 'Campanha de lançamento' })
  @Column({ length: 120 })
  name: string

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  description?: string | null

  @ApiProperty({ minimum: 1, maximum: 100, example: 50 })
  @Column({ type: 'tinyint', unsigned: true })
  discountPercent: number

  @ApiProperty({ description: 'Por quantas faturas o desconto vale', default: 1 })
  @Column({ type: 'int', default: 1 })
  maxInvoices: number

  @ApiPropertyOptional({ description: 'Antes disto o código não é aceito' })
  @Column({ type: 'datetime', precision: 6, nullable: true })
  startsAt?: Date | null

  @ApiPropertyOptional({ description: 'Fim da janela de RESGATE, não do desconto' })
  @Column({ type: 'datetime', precision: 6, nullable: true })
  expiresAt?: Date | null

  @ApiPropertyOptional({ description: 'Teto de contas que podem resgatar. null = sem teto' })
  @Column({ type: 'int', nullable: true })
  maxRedemptions?: number | null

  @ApiPropertyOptional({
    enum: TenantType,
    description: 'Restringe a um tipo de conta. null = os dois',
  })
  @Column({ type: 'enum', enum: TenantType, nullable: true })
  tenantType?: TenantType | null

  /**
   * Só para quem nunca teve assinatura paga.
   *
   * Sem isto, um cupom de "50% nos 3 primeiros meses" vira desconto perpétuo:
   * basta cancelar e assinar de novo a cada três meses. A trava de uma vez por
   * conta já barra o mesmo cupom, mas não uma sequência deles.
   */
  @ApiProperty({ default: false })
  @Column({ default: false })
  firstSubscriptionOnly: boolean

  @ApiProperty({ default: true })
  @Column({ default: true })
  isActive: boolean

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdByUserId?: string | null

  @OneToMany(() => CouponTarget, (target) => target.coupon)
  targets?: CouponTarget[]
}

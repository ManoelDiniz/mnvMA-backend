import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Coupon } from './coupon.entity'

export enum CouponRedemptionStatus {
  /** Resgatado, esperando a assinatura ativar (checkout ainda em aberto). */
  PENDING = 'PENDING',
  /** Valendo: descontando das faturas ou segurando a cortesia. */
  ACTIVE = 'ACTIVE',
  /** Acabaram as faturas com desconto, ou a cortesia venceu. */
  EXHAUSTED = 'EXHAUSTED',
  /** Cancelado pelo dono do SaaS. Libera a vaga no teto do cupom. */
  CANCELED = 'CANCELED',
}

/**
 * O uso de um cupom por uma conta.
 *
 * `discountPercent` e `maxInvoices` são **cópias**, não referências. Mexer no
 * cupom depois — corrigir um percentual digitado errado, encurtar a campanha —
 * não pode mudar o desconto de quem já resgatou: quem entrou com 50% por 3
 * meses combinou 50% por 3 meses, e é isso que precisa valer mesmo que o cupom
 * seja editado ou desligado no dia seguinte.
 *
 * A chave única `(coupon_id, tenant_id)` é a regra "cada cupom uma vez por
 * conta" — o banco recusando a segunda linha, não um `if` que alguém pode
 * esquecer de escrever num caminho novo.
 */
@Entity('coupon_redemptions')
@Index('uq_coupon_redemptions_conta', ['couponId', 'tenantId'], { unique: true })
@Index('idx_coupon_redemptions_situacao', ['status', 'endsAt'])
export class CouponRedemption extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  couponId: string

  @ManyToOne(() => Coupon, { eager: true })
  @JoinColumn({ name: 'coupon_id' })
  coupon?: Coupon

  /** Quem digitou o código. Fica para a conferência de campanha. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  userId?: string | null

  @Column({ type: 'varchar', length: 36, nullable: true })
  subscriptionId?: string | null

  @ApiProperty({ description: 'Congelado no resgate' })
  @Column({ type: 'tinyint', unsigned: true })
  discountPercent: number

  @ApiProperty({ description: 'Congelado no resgate' })
  @Column({ type: 'int', default: 1 })
  maxInvoices: number

  @ApiProperty({ description: 'Quantas faturas já saíram com desconto' })
  @Column({ type: 'int', default: 0 })
  invoicesUsed: number

  @ApiProperty({ enum: CouponRedemptionStatus })
  @Column({
    type: 'enum',
    enum: CouponRedemptionStatus,
    default: CouponRedemptionStatus.PENDING,
  })
  status: CouponRedemptionStatus

  @ApiProperty()
  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  redeemedAt: Date

  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  activatedAt?: Date | null

  /**
   * Quando o benefício acaba. Só é preenchido na cortesia (100%), onde não
   * existe fatura para contar: o que limita é o calendário. Nos demais, quem
   * limita é `invoicesUsed` chegando em `maxInvoices`.
   */
  @ApiPropertyOptional()
  @Column({ type: 'datetime', precision: 6, nullable: true })
  endsAt?: Date | null

  /**
   * Em que aviso de fim de cortesia a conta está (0 = nenhum, 1 = D-3,
   * 2 = D-1, 3 = encerrada). É o que permite o job rodar de hora em hora sem
   * mandar o mesmo e-mail vinte e quatro vezes por dia.
   */
  @Column({ type: 'tinyint', default: 0 })
  warnedStage: number

  /** Cortesia: 100% de desconto, sem cobrança e sem cartão. */
  get isCortesia(): boolean {
    return this.discountPercent >= 100
  }
}

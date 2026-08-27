import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Tenant } from '../tenants/entities/tenant.entity'
import { User } from '../users/entities/user.entity'
import { BillingController } from './billing.controller'
import { BillingService } from './billing.service'
import { CouponsAdminController } from './coupons-admin.controller'
import { CouponsAdminService } from './coupons-admin.service'
import { CouponsService } from './coupons.service'
import { CouponRedemption } from './entities/coupon-redemption.entity'
import { CouponTarget } from './entities/coupon-target.entity'
import { Coupon } from './entities/coupon.entity'
import { Plan } from './entities/plan.entity'
import { SubscriptionPayment } from './entities/subscription-payment.entity'
import { Subscription } from './entities/subscription.entity'
import { WebhookEvent } from './entities/webhook-event.entity'
import { MercadoPagoClient } from './mercadopago/mercadopago.client'
import { PlanLimitsService } from './plan-limits.service'
import { SubscriptionStatusService } from './subscription-status.service'
import { WebhookProcessorService } from './webhook-processor.service'
import { WebhookQueue } from './webhook-queue.service'
import { WebhooksController } from './webhooks.controller'

/**
 * O dinheiro do Fluxo A: a mensalidade que o cuidador ou a empresa paga ao
 * MNVMA (ver `docs/mnvma/03-mercado-pago.md`).
 *
 * Nenhum service daqui usa `TenantScopedRepository`: metade do módulo roda sem
 * requisição de usuário — webhook e jobs chegam sem tenant e o descobrem pelo
 * `external_reference`, por dentro do SystemScope. A parte que roda no request
 * usa o `EntityManager` da transação e filtra por `tenant_id` explicitamente.
 *
 * `PlanLimitsService` é exportado porque o PlanLimitGuard, que é global, faz a
 * mesma pergunta a cada criação de cliente, cuidador, usuário ou plantão.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Plan,
      Subscription,
      SubscriptionPayment,
      WebhookEvent,
      Coupon,
      CouponTarget,
      CouponRedemption,
      Tenant,
      User,
    ]),
  ],
  controllers: [BillingController, WebhooksController, CouponsAdminController],
  providers: [
    MercadoPagoClient,
    PlanLimitsService,
    SubscriptionStatusService,
    CouponsService,
    CouponsAdminService,
    BillingService,
    WebhookProcessorService,
    WebhookQueue,
  ],
  exports: [
    MercadoPagoClient,
    PlanLimitsService,
    SubscriptionStatusService,
    CouponsService,
    BillingService,
    WebhookProcessorService,
    WebhookQueue,
  ],
})
export class BillingModule {}

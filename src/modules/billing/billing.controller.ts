import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser, ReadOnlyAllowed, RequirePermission } from '../../common/decorators'
import { BillingService } from './billing.service'
import {
  CancelSubscriptionDto,
  CheckoutDto,
  PlanDto,
  SubscribeDto,
  SubscriptionDto,
  SubscriptionPaymentDto,
} from './dto/billing.dto'
import { CouponPreviewDto, PreviewCouponDto } from './dto/coupon.dto'

/**
 * Todas as rotas daqui são `@ReadOnlyAllowed()`, inclusive as que escrevem — e
 * isso é proposital, não descuido.
 *
 * O TenantStatusGuard bloqueia escrita quando a conta está suspensa ou com o
 * teste vencido. Se essa regra valesse aqui, a única tela capaz de resolver a
 * suspensão seria a primeira a ser bloqueada por ela: o cliente veria "conta
 * suspensa, regularize a assinatura" e receberia 403 ao tentar exatamente isso.
 */
@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  @RequirePermission('billing:read')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Planos disponíveis para o tipo da conta',
    description:
      'Cada plano já vem com `available` e `blockedReason`: o uso atual da conta pode não caber num plano menor.',
  })
  plans(): Promise<PlanDto[]> {
    return this.billing.planos()
  }

  @Get('subscription')
  @RequirePermission('billing:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Assinatura da conta, com uso atual e última cobrança' })
  subscription(): Promise<SubscriptionDto> {
    return this.billing.assinatura()
  }

  @Get('payments')
  @RequirePermission('billing:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Extrato das cobranças da assinatura' })
  payments(@Query('limit') limit?: string): Promise<SubscriptionPaymentDto[]> {
    const numero = Number(limit)
    return this.billing.pagamentos(Number.isFinite(numero) && numero > 0 ? numero : undefined)
  }

  @Post('subscribe')
  @RequirePermission('billing:write')
  @ReadOnlyAllowed()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assina um plano, troca de plano ou reativa',
    description:
      'Devolve `checkoutUrl` quando é preciso passar pelo Mercado Pago, ou `applied: true` quando a mudança já valeu. ' +
      'A conta só vira ACTIVE pelo webhook — nunca pelo retorno do navegador.',
  })
  subscribe(
    @Body() dto: SubscribeDto,
    @CurrentUser('userId') userId: string,
  ): Promise<CheckoutDto> {
    return this.billing.assinar(dto.planId, userId, dto.couponCode)
  }

  @Post('coupons/preview')
  @RequirePermission('billing:read')
  @ReadOnlyAllowed()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confere um cupom sem gastá-lo',
    description:
      'Mesma validação do resgate — o que impede a tela de prometer um desconto que a assinatura vai recusar. ' +
      'Devolve `courtesy: true` quando o cupom é de 100%: nesse caso não há checkout nem cartão.',
  })
  previewCoupon(@Body() dto: PreviewCouponDto): Promise<CouponPreviewDto> {
    return this.billing.previewCupom(dto)
  }

  @Post('sync')
  @RequirePermission('billing:read')
  @ReadOnlyAllowed()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reconsulta o provedor e aplica o estado real',
    description:
      'A tela de retorno do checkout chama isto enquanto espera o webhook, e resolve o caso raro do webhook perdido.',
  })
  sync(): Promise<SubscriptionDto> {
    return this.billing.sincronizar()
  }

  @Post('cancel')
  @RequirePermission('billing:write')
  @ReadOnlyAllowed()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancela a assinatura',
    description: 'A conta continua funcionando até o fim do período já pago.',
  })
  cancel(@Body() dto: CancelSubscriptionDto): Promise<SubscriptionDto> {
    return this.billing.cancelar(dto)
  }
}

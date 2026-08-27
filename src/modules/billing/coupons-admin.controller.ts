import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser, ReadOnlyAllowed, SomenteSuperAdmin } from '../../common/decorators'
import { CouponsAdminService } from './coupons-admin.service'
import {
  CouponRedemptionResponseDto,
  CouponResponseDto,
  CouponTargetsDto,
  CreateCouponDto,
  UpdateCouponDto,
} from './dto/coupon.dto'

/**
 * Administração de cupons — o primeiro pedaço do MNVMA Core.
 *
 * `@SomenteSuperAdmin()` no controller inteiro: nenhuma rota daqui é do
 * assinante, e a marcação na classe evita o esquecimento de anotar um método
 * novo. `@ReadOnlyAllowed()` porque o estado comercial da conta do
 * administrador não tem nada a ver com o direito de administrar o SaaS — e
 * seria absurdo o dono do produto perder o painel por causa do próprio trial.
 *
 * A tela disto vem no Sprint 8; até lá, o Swagger em `/docs` é a interface.
 */
@ApiTags('admin: cupons')
@Controller('admin/coupons')
@SomenteSuperAdmin()
@ReadOnlyAllowed()
export class CouponsAdminController {
  constructor(private readonly cupons: CouponsAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista os cupons com o uso de cada um',
    description: 'Cada cupom traz `redeemable` e `blockedReason` — por que ninguém está conseguindo usar.',
  })
  list(@Query('includeInactive') includeInactive?: string): Promise<CouponResponseDto[]> {
    return this.cupons.listar(includeInactive !== 'false')
  }

  @Post()
  @ApiOperation({
    summary: 'Cria um cupom',
    description:
      'Sem `targets`, o cupom é aberto: qualquer conta resgata. Com `targets`, vira nominal. ' +
      'Percentual 100 é cortesia: a conta ativa sem checkout e sem cartão, até o fim dos ciclos.',
  })
  create(
    @Body() dto: CreateCouponDto,
    @CurrentUser('userId') userId: string,
  ): Promise<CouponResponseDto> {
    return this.cupons.criar(dto, userId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do cupom, com alvos e contagem de resgates' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<CouponResponseDto> {
    return this.cupons.detalhe(id)
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Atualiza o cupom',
    description:
      'Mudar percentual ou faturas vale só para quem ainda vai resgatar: o resgate congela o benefício.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
  ): Promise<CouponResponseDto> {
    return this.cupons.atualizar(id, dto)
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Desliga o cupom',
    description: 'Fecha para novos resgates. Quem já resgatou continua com o desconto combinado.',
  })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<CouponResponseDto> {
    return this.cupons.desligar(id)
  }

  @Post(':id/targets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Acrescenta e-mails ou contas à lista de quem pode usar',
    description: 'Basta um alvo para o cupom deixar de ser aberto.',
  })
  addTargets(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CouponTargetsDto,
  ): Promise<CouponResponseDto> {
    return this.cupons.adicionarAlvos(id, dto)
  }

  @Delete(':id/targets/:target')
  @ApiOperation({
    summary: 'Tira um e-mail ou conta da lista',
    description: 'Não desfaz resgate já feito — o combinado com aquela pessoa já aconteceu.',
  })
  removeTarget(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('target') target: string,
  ): Promise<CouponResponseDto> {
    return this.cupons.removerAlvo(id, target)
  }

  @Get(':id/redemptions')
  @ApiOperation({ summary: 'Quem resgatou este cupom e em que pé está cada um' })
  redemptions(@Param('id', ParseUUIDPipe) id: string): Promise<CouponRedemptionResponseDto[]> {
    return this.cupons.resgates(id)
  }

  @Delete(':id/redemptions/:redemptionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cancela um resgate e devolve a vaga ao teto',
    description: 'Para resgate por engano ou campanha nominal que foi para a pessoa errada.',
  })
  cancelRedemption(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('redemptionId', ParseUUIDPipe) redemptionId: string,
  ): Promise<void> {
    return this.cupons.cancelarResgate(id, redemptionId)
  }
}

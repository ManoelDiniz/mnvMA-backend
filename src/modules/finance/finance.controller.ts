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
import { ReadOnlyAllowed, RequirePermission } from '../../common/decorators'
import {
  CashflowPointDto,
  CashflowQueryDto,
  CreatePayableDto,
  CreateReceivableDto,
  FinanceQueryDto,
  FinanceSummaryDto,
  PayableResponseDto,
  ReceivableResponseDto,
  SettleDto,
  UpdatePayableDto,
  UpdateReceivableDto,
} from './dto/finance.dto'
import { FinanceService } from './finance.service'

@ApiTags('finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  // ─── Visão consolidada ────────────────────────────────────────────────────

  @Get('summary')
  @RequirePermission('finance:read')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Resumo do período',
    description:
      'Separa previsto de realizado: "a receber" e "recebido" são perguntas diferentes.',
  })
  summary(@Query('from') from: string, @Query('to') to: string): Promise<FinanceSummaryDto> {
    return this.finance.summary(from, to)
  }

  @Get('cashflow')
  @RequirePermission('finance:read')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Fluxo de caixa',
    description: 'Pelo dinheiro que circulou de fato — agrupado pela data de pagamento.',
  })
  cashflow(@Query() query: CashflowQueryDto): Promise<CashflowPointDto[]> {
    return this.finance.cashflow(query)
  }

  @Post('mark-overdue')
  @RequirePermission('finance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marca vencidos (vira job diário no Sprint 7)' })
  markOverdue(): Promise<{ receivables: number; payables: number }> {
    return this.finance.markOverdue()
  }

  // ─── Contas a receber ─────────────────────────────────────────────────────

  @Get('receivables')
  @RequirePermission('finance:read')
  @ReadOnlyAllowed()
  listReceivables(@Query() query: FinanceQueryDto): Promise<ReceivableResponseDto[]> {
    return this.finance.listReceivables(query)
  }

  @Get('receivables/:id')
  @RequirePermission('finance:read')
  @ReadOnlyAllowed()
  findReceivable(@Param('id', ParseUUIDPipe) id: string): Promise<ReceivableResponseDto> {
    return this.finance.findReceivable(id)
  }

  @Post('receivables')
  @RequirePermission('finance:write')
  createReceivable(@Body() dto: CreateReceivableDto): Promise<ReceivableResponseDto> {
    return this.finance.createReceivable(dto)
  }

  @Patch('receivables/:id')
  @RequirePermission('finance:write')
  updateReceivable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReceivableDto,
  ): Promise<ReceivableResponseDto> {
    return this.finance.updateReceivable(id, dto)
  }

  @Post('receivables/:id/settle')
  @RequirePermission('finance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Baixa: registra que o dinheiro entrou' })
  settleReceivable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleDto,
  ): Promise<ReceivableResponseDto> {
    return this.finance.settleReceivable(id, dto)
  }

  @Post('receivables/:id/unsettle')
  @RequirePermission('finance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desfaz a baixa (baixa lançada por engano)' })
  unsettleReceivable(@Param('id', ParseUUIDPipe) id: string): Promise<ReceivableResponseDto> {
    return this.finance.unsettleReceivable(id)
  }

  @Delete('receivables/:id')
  @RequirePermission('finance:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeReceivable(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.finance.removeReceivable(id)
  }

  // ─── Contas a pagar ───────────────────────────────────────────────────────

  @Get('payables')
  @RequirePermission('finance:read')
  @ReadOnlyAllowed()
  listPayables(@Query() query: FinanceQueryDto): Promise<PayableResponseDto[]> {
    return this.finance.listPayables(query)
  }

  @Get('payables/:id')
  @RequirePermission('finance:read')
  @ReadOnlyAllowed()
  findPayable(@Param('id', ParseUUIDPipe) id: string): Promise<PayableResponseDto> {
    return this.finance.findPayable(id)
  }

  @Post('payables')
  @RequirePermission('finance:write')
  createPayable(@Body() dto: CreatePayableDto): Promise<PayableResponseDto> {
    return this.finance.createPayable(dto)
  }

  @Patch('payables/:id')
  @RequirePermission('finance:write')
  updatePayable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayableDto,
  ): Promise<PayableResponseDto> {
    return this.finance.updatePayable(id, dto)
  }

  @Post('payables/:id/settle')
  @RequirePermission('finance:write')
  @HttpCode(HttpStatus.OK)
  settlePayable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleDto,
  ): Promise<PayableResponseDto> {
    return this.finance.settlePayable(id, dto)
  }

  @Post('payables/:id/unsettle')
  @RequirePermission('finance:write')
  @HttpCode(HttpStatus.OK)
  unsettlePayable(@Param('id', ParseUUIDPipe) id: string): Promise<PayableResponseDto> {
    return this.finance.unsettlePayable(id)
  }

  @Delete('payables/:id')
  @RequirePermission('finance:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePayable(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.finance.removePayable(id)
  }
}

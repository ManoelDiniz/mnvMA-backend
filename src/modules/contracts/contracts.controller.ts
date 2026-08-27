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
import { PageDto } from '../../common/dto/pagination.dto'
import { ContractBillingService } from './contract-billing.service'
import { ContractsService } from './contracts.service'
import {
  BillingRunResultDto,
  ChangeContractStatusDto,
  ContractBillingDto,
  ContractQueryDto,
  ContractResponseDto,
  CreateContractDto,
  GenerateBillingDto,
  UpdateContractDto,
} from './dto/contract.dto'

@ApiTags('contracts')
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly billing: ContractBillingService,
  ) {}

  @Get()
  @RequirePermission('contracts:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Lista contratos com a receita mensal prevista' })
  list(@Query() query: ContractQueryDto): Promise<PageDto<ContractResponseDto>> {
    return this.contracts.list(query)
  }

  @Post('generate-billing')
  @RequirePermission('finance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gera as cobranças da competência para todos os contratos ativos',
    description:
      'Idempotente: rodar duas vezes não cobra duas vezes. Use `dryRun` para conferir a prévia antes de disparar.',
  })
  generateBilling(@Body() dto: GenerateBillingDto): Promise<BillingRunResultDto> {
    return this.billing.gerarCompetencia(dto.competence, { dryRun: dto.dryRun })
  }

  @Get(':id')
  @RequirePermission('contracts:read')
  @ReadOnlyAllowed()
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ContractResponseDto> {
    return this.contracts.findOne(id)
  }

  @Get(':id/billings')
  @RequirePermission('contracts:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Cobranças já emitidas pelo contrato' })
  billings(@Param('id', ParseUUIDPipe) id: string): Promise<ContractBillingDto[]> {
    return this.contracts.cobrancas(id)
  }

  @Post()
  @RequirePermission('contracts:write')
  @ApiOperation({
    summary: 'Cria contrato',
    description: 'Nasce como rascunho — ative-o depois de conferir valor e vencimento.',
  })
  create(@Body() dto: CreateContractDto): Promise<ContractResponseDto> {
    return this.contracts.create(dto)
  }

  @Patch(':id')
  @RequirePermission('contracts:write')
  @ApiOperation({
    summary: 'Atualiza contrato',
    description: 'Reajuste vale da próxima competência: cobrança já emitida não muda de valor.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
  ): Promise<ContractResponseDto> {
    return this.contracts.update(id, dto)
  }

  @Post(':id/status')
  @RequirePermission('contracts:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ativa, suspende ou encerra. Suspender e encerrar exigem motivo.' })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeContractStatusDto,
  ): Promise<ContractResponseDto> {
    return this.contracts.changeStatus(id, dto)
  }

  @Post(':id/generate-billing')
  @RequirePermission('finance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gera a cobrança da competência só deste contrato' })
  generateOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateBillingDto,
  ): Promise<BillingRunResultDto> {
    return this.billing.gerarCompetencia(dto.competence, { dryRun: dto.dryRun, contractId: id })
  }

  @Delete(':id')
  @RequirePermission('contracts:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Exclui contrato que ainda não gerou cobrança' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.contracts.remove(id)
  }
}

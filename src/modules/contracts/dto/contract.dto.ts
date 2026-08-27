import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'
import { ReceivableStatus } from '../../finance/entities/account-receivable.entity'
import { BillingCycle, ContractStatus } from '../entities/contract.entity'
import { dinheiro } from '../../../common/dto/transforms'

const texto = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() || undefined) : undefined

export class CreateContractDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Escolha o cliente' })
  customerId: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Serviço inválido' })
  serviceId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Cuidador inválido' })
  caregiverId?: string

  @ApiProperty({ example: 'Acompanhamento 12h — Dona Marta' })
  @IsString()
  @MinLength(3, { message: 'Dê um nome ao contrato' })
  @MaxLength(160)
  name: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(texto)
  code?: string

  @ApiProperty({ example: '2026-09-01' })
  @IsDateString({ strict: false }, { message: 'Data de início inválida' })
  startDate: string

  @ApiPropertyOptional({ example: '2027-08-31', description: 'Vazio = sem prazo' })
  @IsOptional()
  @IsDateString({ strict: false }, { message: 'Data de término inválida' })
  endDate?: string

  @ApiPropertyOptional({ enum: BillingCycle, default: BillingCycle.MONTHLY })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle

  @ApiProperty({ description: 'Valor de cada cobrança', example: '3200.00' })
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Informe o valor da mensalidade' })
  amount: string

  @ApiPropertyOptional({ example: '1900.00' })
  @IsOptional()
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Custo estimado inválido' })
  estimatedCost?: string

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'O dia do vencimento vai de 1 a 31' })
  @Max(31, { message: 'O dia do vencimento vai de 1 a 31' })
  billingDay?: number

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  billInArrears?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(texto)
  notes?: string
}

export class UpdateContractDto extends PartialType(CreateContractDto) {}

export class ChangeContractStatusDto {
  @ApiProperty({ enum: ContractStatus })
  @IsEnum(ContractStatus, { message: 'Situação inválida' })
  status: ContractStatus

  @ApiPropertyOptional({ description: 'Obrigatório ao suspender ou encerrar' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(texto)
  reason?: string
}

export class GenerateBillingDto {
  @ApiPropertyOptional({
    example: '2026-09',
    description: 'Competência a gerar. Padrão: o mês corrente.',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Competência no formato AAAA-MM' })
  competence?: string

  @ApiPropertyOptional({
    default: false,
    description: 'Simula sem gravar nada — mostra quanto sairia antes de disparar.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean
}

export class ContractQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string

  @ApiPropertyOptional({ enum: ContractStatus })
  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus
}

export class ContractResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ format: 'uuid' }) customerId: string
  @ApiProperty() customerName: string
  @ApiPropertyOptional() serviceId: string | null
  @ApiPropertyOptional() serviceName: string | null
  @ApiPropertyOptional() caregiverId: string | null
  @ApiPropertyOptional() caregiverName: string | null
  @ApiProperty() name: string
  @ApiPropertyOptional() code: string | null
  @ApiProperty({ enum: ContractStatus }) status: ContractStatus
  @ApiProperty() startDate: string
  @ApiPropertyOptional() endDate: string | null
  @ApiProperty({ enum: BillingCycle }) billingCycle: BillingCycle
  @ApiProperty() amount: string
  @ApiPropertyOptional() estimatedCost: string | null
  @ApiProperty() billingDay: number
  @ApiProperty() billInArrears: boolean
  @ApiPropertyOptional() lastBilledCompetence: string | null
  @ApiPropertyOptional() statusReason: string | null
  @ApiPropertyOptional() notes: string | null

  @ApiProperty({ description: 'Cobranças por competência: 1 mensal, 2 quinzenal' })
  billingsPerCompetence: number

  @ApiProperty({ description: 'Receita prevista por mês', example: '3200.00' })
  monthlyAmount: string

  @ApiProperty({ description: 'Margem prevista por mês. Nula sem custo estimado.' })
  monthlyMargin: string | null

  @ApiProperty({ description: 'Está valendo hoje — ativo e dentro da vigência' })
  inForce: boolean
}

export class BillingRunItemDto {
  @ApiProperty({ format: 'uuid' }) contractId: string
  @ApiProperty() contractName: string
  @ApiProperty() customerName: string
  @ApiProperty() competence: string
  @ApiProperty({ isArray: true, type: String, description: 'Vencimentos gerados' })
  dueDates: string[]
  @ApiProperty() amount: string
  @ApiProperty({ enum: ['created', 'skipped'] }) result: 'created' | 'skipped'
  @ApiPropertyOptional({ description: 'Por que foi pulado' }) reason?: string
}

export class BillingRunResultDto {
  @ApiProperty() competence: string
  @ApiProperty() dryRun: boolean
  @ApiProperty() created: number
  @ApiProperty() skipped: number
  @ApiProperty({ description: 'Total faturado na rodada', example: '18400.00' })
  total: string
  @ApiProperty({ type: [BillingRunItemDto] }) items: BillingRunItemDto[]
}

export class ContractBillingDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ example: '2026-09' }) competence: string
  @ApiProperty() description: string
  @ApiProperty() amount: string
  @ApiProperty({ type: 'string', format: 'date' }) dueDate: string
  @ApiPropertyOptional() paidAt: string | null
  @ApiPropertyOptional() paidAmount: string | null
  @ApiProperty({ enum: ReceivableStatus }) status: ReceivableStatus
}

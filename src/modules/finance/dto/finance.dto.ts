import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { PayableCategory, PayableStatus } from '../entities/account-payable.entity'
import { ReceivableStatus } from '../entities/account-receivable.entity'
import { dinheiro } from '../../../common/dto/transforms'

// ─── Contas a receber ─────────────────────────────────────────────────────────

export class CreateReceivableDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Selecione o cliente' })
  customerId: string

  @ApiProperty({ example: 'Mensalidade setembro' })
  @IsString()
  @MinLength(2, { message: 'Informe a descrição' })
  @MaxLength(200)
  description: string

  @ApiProperty({ example: '1500.00' })
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Valor inválido' })
  amount: string

  @ApiProperty({ type: 'string', format: 'date', example: '2026-09-30' })
  @IsDateString({ strict: true }, { message: 'Data de vencimento inválida' })
  dueDate: string

  @ApiPropertyOptional({ example: '2026-09', description: 'Padrão: mês do vencimento' })
  @IsOptional()
  @IsString()
  @MaxLength(7)
  competence?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class UpdateReceivableDto extends PartialType(CreateReceivableDto) {}

// ─── Contas a pagar ───────────────────────────────────────────────────────────

export class CreatePayableDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Quando a despesa é pagamento de cuidador' })
  @IsOptional()
  @IsUUID()
  caregiverId?: string

  @ApiPropertyOptional({ example: 'Posto Ipiranga' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  supplier?: string

  @ApiProperty({ enum: PayableCategory })
  @IsEnum(PayableCategory)
  category: PayableCategory

  @ApiProperty({ example: 'Combustível — visitas de setembro' })
  @IsString()
  @MinLength(2, { message: 'Informe a descrição' })
  @MaxLength(200)
  description: string

  @ApiProperty({ example: '250.00' })
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Valor inválido' })
  amount: string

  @ApiProperty({ type: 'string', format: 'date' })
  @IsDateString({ strict: true }, { message: 'Data de vencimento inválida' })
  dueDate: string

  @ApiPropertyOptional({ example: '2026-09' })
  @IsOptional()
  @IsString()
  @MaxLength(7)
  competence?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class UpdatePayableDto extends PartialType(CreatePayableDto) {}

// ─── Baixa ────────────────────────────────────────────────────────────────────

export class SettleDto {
  @ApiPropertyOptional({
    type: 'string',
    format: 'date',
    description: 'Data em que o dinheiro entrou/saiu. Padrão: hoje.',
  })
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Data inválida' })
  paidAt?: string

  @ApiPropertyOptional({
    description: 'Valor efetivo. Pode diferir do previsto — desconto, juros, acerto.',
  })
  @IsOptional()
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Valor inválido' })
  paidAmount?: string
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export class FinanceQueryDto {
  @ApiPropertyOptional({ type: 'string', format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string

  @ApiPropertyOptional({ type: 'string', format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string

  @ApiPropertyOptional({ example: '2026-09' })
  @IsOptional()
  @IsString()
  @MaxLength(7)
  competence?: string

  @ApiPropertyOptional({ description: 'Status separados por vírgula, ou "all"' })
  @IsOptional()
  @IsString()
  status?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  caregiverId?: string

  @ApiPropertyOptional({ enum: PayableCategory })
  @IsOptional()
  @IsEnum(PayableCategory)
  category?: PayableCategory

  @ApiPropertyOptional({ default: 200, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 200
}

export class CashflowQueryDto {
  @ApiProperty({ type: 'string', format: 'date' })
  @IsDateString({ strict: true })
  from: string

  @ApiProperty({ type: 'string', format: 'date' })
  @IsDateString({ strict: true })
  to: string

  @ApiPropertyOptional({ enum: ['day', 'month'], default: 'month' })
  @IsOptional()
  @IsIn(['day', 'month'])
  groupBy: 'day' | 'month' = 'month'
}

// ─── Respostas ────────────────────────────────────────────────────────────────

export class ReceivableResponseDto {
  @ApiProperty() id: string
  @ApiProperty() customerId: string
  @ApiProperty() customerName: string
  @ApiPropertyOptional({ description: 'Plantão de origem' }) shiftId?: string | null
  @ApiPropertyOptional({
    description: 'Contrato de origem. Exclusivo com `shiftId` — a cobrança nasce de um ou de outro.',
  })
  contractId?: string | null
  @ApiProperty() competence: string
  @ApiProperty() description: string
  @ApiProperty() amount: string
  @ApiProperty() dueDate: string
  @ApiPropertyOptional() paidAt?: string | null
  @ApiPropertyOptional() paidAmount?: string | null
  @ApiProperty({ enum: ReceivableStatus }) status: ReceivableStatus
  @ApiProperty({ description: 'Dias de atraso; 0 quando em dia' }) daysOverdue: number
  @ApiPropertyOptional() notes?: string | null
}

export class PayableResponseDto {
  @ApiProperty() id: string
  @ApiPropertyOptional() caregiverId?: string | null
  @ApiPropertyOptional() caregiverName?: string | null
  @ApiPropertyOptional() supplier?: string | null
  @ApiProperty({ enum: PayableCategory }) category: PayableCategory
  @ApiPropertyOptional() shiftId?: string | null
  @ApiProperty() competence: string
  @ApiProperty() description: string
  @ApiProperty() amount: string
  @ApiProperty() dueDate: string
  @ApiPropertyOptional() paidAt?: string | null
  @ApiPropertyOptional() paidAmount?: string | null
  @ApiProperty({ enum: PayableStatus }) status: PayableStatus
  @ApiProperty() daysOverdue: number
  @ApiPropertyOptional() notes?: string | null
}

export class FinanceSummaryDto {
  @ApiProperty({ description: 'Total previsto a receber no período' }) toReceive: string
  @ApiProperty({ description: 'Total já recebido' }) received: string
  @ApiProperty({ description: 'Vencido e não recebido' }) overdueReceivable: string
  @ApiProperty({ description: 'Total previsto a pagar' }) toPay: string
  @ApiProperty({ description: 'Total já pago' }) paid: string
  @ApiProperty({ description: 'Vencido e não pago' }) overduePayable: string
  @ApiProperty({ description: 'Recebido menos pago — dinheiro que de fato circulou' })
  cashResult: string
  @ApiProperty({ description: 'Previsto a receber menos previsto a pagar' })
  expectedResult: string
}

export class CashflowPointDto {
  @ApiProperty({ example: '2026-09' }) period: string
  @ApiProperty() income: string
  @ApiProperty() expense: string
  @ApiProperty() balance: string
}

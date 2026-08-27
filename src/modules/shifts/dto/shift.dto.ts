import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
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
import { ShiftStatus } from '../entities/shift.entity'
import { dinheiro } from '../../../common/dto/transforms'

export class CreateShiftDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Selecione o cliente' })
  customerId: string

  @ApiPropertyOptional({ format: 'uuid', description: 'Vazio = plantão sem cuidador definido' })
  @IsOptional()
  @IsUUID()
  caregiverId?: string

  @ApiPropertyOptional({ format: 'uuid', description: 'Preenche valores automaticamente' })
  @IsOptional()
  @IsUUID()
  serviceId?: string

  @ApiProperty({ example: '2026-08-25T07:00:00-03:00' })
  @IsDateString({ strict: true }, { message: 'Data/hora de início inválida' })
  startsAt: string

  @ApiProperty({ example: '2026-08-25T19:00:00-03:00' })
  @IsDateString({ strict: true }, { message: 'Data/hora de término inválida' })
  endsAt: string

  @ApiPropertyOptional({ description: 'Sobrescreve o valor vindo do serviço' })
  @IsOptional()
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Valor cobrado inválido' })
  chargeAmount?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Custo do cuidador inválido' })
  caregiverCost?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Outros custos inválidos' })
  otherCosts?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class UpdateShiftDto extends PartialType(CreateShiftDto) {}

export class ChangeShiftStatusDto {
  @ApiProperty({ enum: ShiftStatus })
  @IsEnum(ShiftStatus)
  status: ShiftStatus

  @ApiPropertyOptional({ description: 'Obrigatório ao cancelar ou marcar falta' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string
}

/** Geração em lote de escala recorrente ("toda seg/qua/sex por 4 semanas"). */
export class CreateShiftBatchDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  caregiverId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  serviceId?: string

  @ApiProperty({ example: '2026-09-01', description: 'Primeiro dia (data local)' })
  @IsDateString({ strict: true })
  fromDate: string

  @ApiProperty({ example: '2026-09-30', description: 'Último dia (inclusive)' })
  @IsDateString({ strict: true })
  toDate: string

  @ApiProperty({ example: [1, 3, 5], description: '0 = domingo … 6 = sábado' })
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays: number[]

  @ApiProperty({ example: '07:00' })
  @IsString()
  startTime: string

  @ApiProperty({ example: '19:00', description: 'Menor que o início = plantão vira o dia' })
  @IsString()
  endTime: string

  @ApiPropertyOptional({ default: true, description: 'Pula dias que já têm plantão igual' })
  @IsOptional()
  @IsBoolean()
  skipConflicts?: boolean = true
}

export class ShiftQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01T00:00:00-03:00' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59-03:00' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  caregiverId?: string

  @ApiPropertyOptional({ enum: ShiftStatus })
  @IsOptional()
  @IsEnum(ShiftStatus)
  status?: ShiftStatus

  @ApiPropertyOptional({ description: 'Só plantões sem cuidador definido' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  uncovered?: boolean

  @ApiPropertyOptional({ default: 500, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit = 500
}

export class ShiftResponseDto {
  @ApiProperty() id: string
  @ApiProperty() customerId: string
  @ApiProperty() customerName: string
  @ApiPropertyOptional() caregiverId?: string | null
  @ApiPropertyOptional() caregiverName?: string | null
  @ApiPropertyOptional() serviceId?: string | null
  @ApiPropertyOptional() serviceName?: string | null
  @ApiProperty() startsAt: string
  @ApiProperty() endsAt: string
  @ApiProperty() chargeAmount: string
  @ApiProperty() caregiverCost: string
  @ApiProperty() otherCosts: string
  @ApiProperty({ enum: ShiftStatus }) status: ShiftStatus
  @ApiPropertyOptional() statusReason?: string | null
  @ApiPropertyOptional() checkInAt?: string | null
  @ApiPropertyOptional() checkOutAt?: string | null
  @ApiPropertyOptional() notes?: string | null

  @ApiProperty({ description: 'Duração planejada, em horas', example: 12 })
  hours: number

  @ApiProperty({ description: 'Cobrado menos custos', example: '100.00' })
  margin: string
}

// ─── Substituição ─────────────────────────────────────────────────────────────

export class SubstituteShiftDto {
  @ApiProperty({ format: 'uuid', description: 'Quem assume o plantão' })
  @IsUUID('4', { message: 'Escolha o cuidador que vai assumir' })
  caregiverId: string

  @ApiProperty({ example: 'Cuidadora com atestado médico' })
  @IsString()
  @MinLength(3, { message: 'Informe o motivo da troca' })
  @MaxLength(255)
  reason: string

  @ApiPropertyOptional({
    description:
      'Custo do novo cuidador. Sem isso, mantém o custo que já estava no plantão.',
    example: '200.00',
  })
  @IsOptional()
  @Transform(dinheiro)
  @IsNumberString({ no_symbols: false }, { message: 'Valor inválido' })
  caregiverCost?: string

  @ApiPropertyOptional({
    default: false,
    description:
      'Escala mesmo com bloqueio declarado ou conflito de horário. Fica registrado no motivo.',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean
}

export class SubstitutionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ format: 'uuid' }) shiftId: string
  @ApiProperty() shiftStartsAt: string
  @ApiProperty() customerName: string
  @ApiPropertyOptional() previousCaregiverId: string | null
  @ApiPropertyOptional() previousCaregiverName: string | null
  @ApiProperty() newCaregiverId: string
  @ApiProperty() newCaregiverName: string
  @ApiProperty() reason: string
  @ApiPropertyOptional() changedByName: string | null
  @ApiProperty() createdAt: string
  @ApiProperty({ description: 'Plantão estava descoberto — cobertura, não troca' })
  wasUncovered: boolean
}

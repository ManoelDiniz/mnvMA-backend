import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsMilitaryTime,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class FaixaRecorrenteDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = domingo … 6 = sábado' })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number

  @ApiProperty({ example: '07:00' })
  @IsMilitaryTime({ message: 'Horário inválido (use HH:MM)' })
  startTime: string

  @ApiProperty({ example: '19:00', description: 'Menor que o início = vira o dia' })
  @IsMilitaryTime({ message: 'Horário inválido (use HH:MM)' })
  endTime: string
}

/**
 * Substitui a grade inteira de uma vez.
 *
 * Editar faixa a faixa exigiria o cliente rastrear ids e mandar criações,
 * atualizações e remoções separadas — para uma grade semanal que cabe numa tela,
 * mandar o conjunto todo é mais simples e não deixa estado inconsistente no meio.
 */
export class SetAvailabilityDto {
  @ApiProperty({ type: [FaixaRecorrenteDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FaixaRecorrenteDto)
  slots: FaixaRecorrenteDto[]
}

export class CreateBlockDto {
  @ApiProperty({ example: '2026-09-15T00:00:00-03:00' })
  @IsDateString({ strict: true }, { message: 'Data inicial inválida' })
  blockedFrom: string

  @ApiProperty({ example: '2026-09-20T23:59:59-03:00' })
  @IsDateString({ strict: true }, { message: 'Data final inválida' })
  blockedTo: string

  @ApiPropertyOptional({ example: 'Viagem' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  reason?: string
}

export class AvailabilityResponseDto {
  @ApiProperty({ type: [FaixaRecorrenteDto] })
  slots: Array<FaixaRecorrenteDto & { id: string }>

  @ApiProperty()
  blocks: Array<{
    id: string
    blockedFrom: string
    blockedTo: string
    reason?: string | null
  }>
}

export class CandidatoDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiPropertyOptional() shiftRate?: string | null
  @ApiProperty({ description: 'Livre de conflito e dentro da disponibilidade' })
  available: boolean
  @ApiProperty({
    description: 'Por que não pode, quando `available` é falso',
    example: 'Já tem plantão nesse horário',
  })
  reason: string | null
  @ApiProperty({ description: 'Plantões já atribuídos no mesmo dia' })
  shiftsSameDay: number
}

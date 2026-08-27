import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator'
import { ShiftStatus } from '../../shifts/entities/shift.entity'

const DATA = /^\d{4}-\d{2}-\d{2}$/

export class ScheduleQueryDto {
  @ApiProperty({ example: '2026-09-01', description: 'Primeiro dia da grade (data local)' })
  @Matches(DATA, { message: 'Data inicial no formato AAAA-MM-DD' })
  from: string

  @ApiProperty({ example: '2026-09-07', description: 'Último dia da grade (data local, inclusive)' })
  @Matches(DATA, { message: 'Data final no formato AAAA-MM-DD' })
  to: string

  @ApiPropertyOptional({ format: 'uuid', description: 'Filtra a grade por cliente' })
  @IsOptional()
  @IsUUID()
  customerId?: string

  @ApiPropertyOptional({
    default: false,
    description: 'Inclui cuidadores inativos, para conferir escala antiga',
  })
  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean
}

export class CopyWeekDto {
  @ApiProperty({ example: '2026-09-01', description: 'Segunda-feira da semana modelo' })
  @Matches(DATA, { message: 'Data no formato AAAA-MM-DD' })
  sourceWeekStart: string

  @ApiProperty({ example: '2026-09-08', description: 'Primeiro dia da semana de destino' })
  @Matches(DATA, { message: 'Data no formato AAAA-MM-DD' })
  targetWeekStart: string

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 12, description: 'Quantas semanas repetir' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  repeat?: number

  @ApiPropertyOptional({
    default: true,
    description: 'Leva junto o cuidador de cada plantão. Falso gera a escala descoberta.',
  })
  @IsOptional()
  @IsBoolean()
  keepCaregivers?: boolean
}

export class ScheduleShiftDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ format: 'uuid' }) customerId: string
  @ApiProperty() customerName: string
  @ApiPropertyOptional() serviceName: string | null
  @ApiProperty({ description: 'Início em UTC' }) startsAt: string
  @ApiProperty({ description: 'Fim em UTC' }) endsAt: string
  @ApiProperty({ example: '07:00', description: 'Hora local de início' }) startTime: string
  @ApiProperty({ example: '19:00', description: 'Hora local de fim' }) endTime: string
  @ApiProperty({ enum: ShiftStatus }) status: ShiftStatus
  @ApiProperty({ description: 'Termina no dia seguinte' }) overnight: boolean
  @ApiProperty() hours: number
  @ApiProperty() chargeAmount: string
  @ApiProperty() caregiverCost: string
}

export class ScheduleCellDto {
  @ApiProperty({ example: '2026-09-01' }) date: string
  @ApiProperty({ type: [ScheduleShiftDto] }) shifts: ScheduleShiftDto[]
  @ApiProperty({ description: 'Horas escaladas no dia' }) hours: number
}

export class ScheduleRowDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Nulo na linha dos plantões descobertos' })
  caregiverId: string | null
  @ApiProperty() caregiverName: string
  @ApiProperty() isActive: boolean
  @ApiProperty({ type: [ScheduleCellDto] }) cells: ScheduleCellDto[]
  @ApiProperty() totalShifts: number
  @ApiProperty() totalHours: number
  @ApiProperty({ description: 'Custo do período com este cuidador' }) totalCost: string
}

export class ScheduleDayDto {
  @ApiProperty({ example: '2026-09-01' }) date: string
  @ApiProperty({ description: '0 = domingo', example: 1 }) weekday: number
  @ApiProperty({ example: 'seg' }) weekdayLabel: string
  @ApiProperty({ example: '01/09' }) dayLabel: string
  @ApiProperty() isWeekend: boolean
}

export class ScheduleResponseDto {
  @ApiProperty() from: string
  @ApiProperty() to: string
  @ApiProperty({ type: [ScheduleDayDto] }) days: ScheduleDayDto[]
  @ApiProperty({ type: [ScheduleRowDto], description: 'Uma linha por cuidador' })
  rows: ScheduleRowDto[]
  @ApiProperty({
    type: ScheduleRowDto,
    description: 'Plantões sem cuidador. Sempre presente, mesmo vazia.',
  })
  uncovered: ScheduleRowDto
  @ApiProperty() totalShifts: number
  @ApiProperty() totalHours: number
  @ApiProperty() uncoveredShifts: number
  @ApiProperty() chargeTotal: string
  @ApiProperty() costTotal: string
}

export class CopyWeekResultDto {
  @ApiProperty() created: number
  @ApiProperty({ description: 'Já existia plantão igual no destino' }) skipped: number
  @ApiProperty({ description: 'Recusados por conflito de horário do cuidador' }) conflicts: number
  @ApiProperty({ isArray: true, type: String, description: 'O que não deu, em texto legível' })
  warnings: string[]
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsIn, IsOptional } from 'class-validator'

export class ReportQueryDto {
  @ApiPropertyOptional({ type: 'string', format: 'date', example: '2026-09-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string

  @ApiPropertyOptional({ type: 'string', format: 'date', example: '2026-09-30' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string

  @ApiPropertyOptional({ enum: ['customer', 'caregiver', 'service'], default: 'customer' })
  @IsOptional()
  @IsIn(['customer', 'caregiver', 'service'])
  by: 'customer' | 'caregiver' | 'service' = 'customer'
}

export class LinhaRentabilidadeDto {
  @ApiPropertyOptional({ description: 'Nulo quando o agrupamento não estava preenchido' })
  id: string | null

  @ApiProperty() name: string
  @ApiProperty() shifts: number
  @ApiProperty() hours: number
  @ApiProperty({ example: '6500.00' }) revenue: string
  @ApiProperty({ example: '4200.00' }) cost: string
  @ApiProperty({ example: '2300.00' }) result: string
  @ApiPropertyOptional({ example: 35.4 }) marginPercent: number | null
}

export class RentabilidadeDto {
  @ApiProperty({ enum: ['customer', 'caregiver', 'service'] })
  by: 'customer' | 'caregiver' | 'service'

  @ApiProperty({ type: [LinhaRentabilidadeDto] })
  rows: LinhaRentabilidadeDto[]

  @ApiProperty({ description: 'Soma de todas as linhas' })
  total: Omit<LinhaRentabilidadeDto, 'id' | 'name'>
}

export class ResumoOperacionalDto {
  @ApiProperty() completed: number
  @ApiProperty() planned: number
  @ApiProperty() confirmed: number
  @ApiProperty() inProgress: number
  @ApiProperty() canceled: number
  @ApiProperty() noShow: number
  @ApiProperty({ description: 'Plantões ainda sem cuidador definido' }) uncovered: number
  @ApiProperty({ description: 'Horas dos plantões concluídos' }) hoursWorked: number
  @ApiProperty({ description: 'Faltas sobre o que deveria ter acontecido, em %' })
  noShowRate: number
}

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'
import { ServiceUnit } from '../entities/service.entity'
import { dinheiro } from '../../../common/dto/transforms'

/**
 * Dinheiro entra e sai como string decimal ("300.00"). Aceitar `number` aqui
 * abriria a porta para 0.1 + 0.2 no cliente e diferença de centavo no relatório
 * de rentabilidade no fim do mês.
 */
export class CreateServiceDto {
  @ApiProperty({ example: 'Cuidador 12h diurno' })
  @IsString()
  @MinLength(2, { message: 'Informe o nome do serviço' })
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name: string

  @ApiPropertyOptional({ example: 'CD12D' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string

  @ApiProperty({ enum: ServiceUnit, default: ServiceUnit.SHIFT })
  @IsEnum(ServiceUnit)
  unit: ServiceUnit = ServiceUnit.SHIFT

  @ApiProperty({ description: 'Valor cobrado do cliente', example: '300.00' })
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Valor de venda inválido' })
  salePrice: string

  @ApiPropertyOptional({ description: 'Valor pago ao cuidador', example: '180.00' })
  @IsOptional()
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Valor do cuidador inválido' })
  caregiverCost?: string

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Quantidade de horas inválida' })
  hours?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class UpdateServiceDto extends PartialType(CreateServiceDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class ServiceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'active'
}

export class ServiceResponseDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiPropertyOptional() code?: string | null
  @ApiProperty({ enum: ServiceUnit }) unit: ServiceUnit
  @ApiProperty() salePrice: string
  @ApiPropertyOptional() caregiverCost?: string | null
  @ApiPropertyOptional() hours?: string | null
  @ApiPropertyOptional() notes?: string | null
  @ApiProperty() isActive: boolean

  @ApiProperty({ description: 'Venda menos custo do cuidador', example: '120.00' })
  margin: string

  @ApiPropertyOptional({ description: 'Margem sobre a venda, em %', example: 40 })
  marginPercent: number | null

  @ApiPropertyOptional({ description: 'Valor de venda dividido pelas horas' })
  hourlyRate: string | null
}

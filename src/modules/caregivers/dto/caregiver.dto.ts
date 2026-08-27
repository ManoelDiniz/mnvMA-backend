import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'
import { digitos, dinheiro } from '../../../common/dto/transforms'

export class CreateCaregiverDto {
  @ApiProperty({ example: 'Carlos Souza' })
  @IsString()
  @MinLength(2, { message: 'Informe o nome do cuidador' })
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name: string

  @ApiPropertyOptional({ description: 'Só dígitos' })
  @IsOptional()
  @IsString()
  @MaxLength(11)
  @Transform(digitos)
  cpf?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(11)
  @Transform(digitos)
  phone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Data de nascimento inválida' })
  birthDate?: string

  @ApiPropertyOptional({ enum: ['CLT', 'PJ', 'AUTONOMO', 'DIARISTA'] })
  @IsOptional()
  @IsIn(['CLT', 'PJ', 'AUTONOMO', 'DIARISTA'])
  contractType?: string

  @ApiPropertyOptional({ example: '25.00' })
  @IsOptional()
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Valor/hora inválido' })
  hourlyRate?: string

  @ApiPropertyOptional({ example: '180.00' })
  @IsOptional()
  @Transform(dinheiro)
  @IsNumberString({}, { message: 'Valor do plantão inválido' })
  shiftRate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class UpdateCaregiverDto extends PartialType(CreateCaregiverDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class CaregiverQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'active'
}

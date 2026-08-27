import { ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'

const digitsOnly = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\D/g, '') || undefined : value

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value

export class AddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) street?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) number?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) complement?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) district?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2) state?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(digitsOnly) @MaxLength(8) zipCode?: string
}

export class ResponsibleInputDto {
  @ApiPropertyOptional({ description: 'Informe para atualizar um responsável existente' })
  @IsOptional()
  @IsString()
  id?: string

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trimmed)
  name: string

  @ApiPropertyOptional({ example: 'Filha' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  relationship?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string

  @ApiPropertyOptional({ description: 'Contato principal' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean

  @ApiPropertyOptional({ description: 'Recebe as cobranças' })
  @IsOptional()
  @IsBoolean()
  isFinancial?: boolean

  @ApiPropertyOptional({ description: 'Acionado em emergências' })
  @IsOptional()
  @IsBoolean()
  isEmergency?: boolean
}

export class CreateCustomerDto {
  @IsString()
  @MinLength(2, { message: 'Informe o nome do cliente' })
  @MaxLength(160)
  @Transform(trimmed)
  name: string

  @ApiPropertyOptional({ description: 'Só dígitos' })
  @IsOptional()
  @IsString()
  @MaxLength(11)
  @Transform(digitsOnly)
  cpf?: string

  @ApiPropertyOptional({ format: 'date', example: '1948-03-22' })
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Data de nascimento inválida' })
  birthDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(digitsOnly)
  phone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto

  @ApiPropertyOptional({ description: 'Rotina, restrições, medicações, preferências' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string

  @ApiPropertyOptional({ type: [ResponsibleInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResponsibleInputDto)
  responsibles?: ResponsibleInputDto[]
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class CustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'active'

  @ApiPropertyOptional({
    enum: ['name', '-name', 'createdAt', '-createdAt'],
    default: 'name',
  })
  @IsOptional()
  @IsIn(['name', '-name', 'createdAt', '-createdAt'])
  sort: 'name' | '-name' | 'createdAt' | '-createdAt' = 'name'
}

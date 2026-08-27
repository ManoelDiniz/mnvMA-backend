import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'
import { OccurrenceSeverity, OccurrenceType } from '../entities/occurrence.entity'

const texto = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() || undefined) : undefined

export class CreateOccurrenceDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Plantão em que aconteceu' })
  @IsOptional()
  @IsUUID('4', { message: 'Plantão inválido' })
  shiftId?: string

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Dispensável quando vem do plantão — nesse caso herda o cliente dele.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Cliente inválido' })
  customerId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Cuidador inválido' })
  caregiverId?: string

  @ApiProperty({ enum: OccurrenceType })
  @IsEnum(OccurrenceType, { message: 'Escolha o tipo da ocorrência' })
  type: OccurrenceType

  @ApiProperty({ enum: OccurrenceSeverity })
  @IsEnum(OccurrenceSeverity, { message: 'Escolha a gravidade' })
  severity: OccurrenceSeverity

  @ApiPropertyOptional({ description: 'Quando aconteceu. Padrão: agora.' })
  @IsOptional()
  @IsDateString({ strict: false }, { message: 'Data da ocorrência inválida' })
  occurredAt?: string

  @ApiProperty({ example: 'Queda no banheiro' })
  @IsString()
  @MinLength(3, { message: 'Descreva a ocorrência em poucas palavras' })
  @MaxLength(200)
  title: string

  @ApiProperty()
  @IsString()
  @MinLength(5, { message: 'Conte o que aconteceu' })
  @MaxLength(5000)
  description: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @Transform(texto)
  actionTaken?: string

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  familyNotified?: boolean
}

export class UpdateOccurrenceDto extends PartialType(CreateOccurrenceDto) {}

export class ResolveOccurrenceDto {
  @ApiProperty({ description: 'Como o caso foi encerrado' })
  @IsString()
  @MinLength(3, { message: 'Diga como o caso foi resolvido' })
  @MaxLength(2000)
  resolution: string
}

export class OccurrenceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  caregiverId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  shiftId?: string

  @ApiPropertyOptional({ enum: OccurrenceType })
  @IsOptional()
  @IsEnum(OccurrenceType)
  type?: OccurrenceType

  @ApiPropertyOptional({ enum: OccurrenceSeverity })
  @IsOptional()
  @IsEnum(OccurrenceSeverity)
  severity?: OccurrenceSeverity

  @ApiPropertyOptional({ enum: ['all', 'open', 'resolved'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'open', 'resolved'])
  situation: 'all' | 'open' | 'resolved' = 'all'

  @ApiPropertyOptional({ description: 'Início do período (ISO)' })
  @IsOptional()
  @IsDateString({ strict: false })
  from?: string

  @ApiPropertyOptional({ description: 'Fim do período (ISO)' })
  @IsOptional()
  @IsDateString({ strict: false })
  to?: string
}

export class OccurrenceResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiPropertyOptional() shiftId: string | null
  @ApiPropertyOptional() shiftStartsAt: string | null
  @ApiProperty({ format: 'uuid' }) customerId: string
  @ApiProperty() customerName: string
  @ApiPropertyOptional() caregiverId: string | null
  @ApiPropertyOptional() caregiverName: string | null
  @ApiProperty({ enum: OccurrenceType }) type: OccurrenceType
  @ApiProperty({ enum: OccurrenceSeverity }) severity: OccurrenceSeverity
  @ApiProperty() occurredAt: string
  @ApiProperty() title: string
  @ApiProperty() description: string
  @ApiPropertyOptional() actionTaken: string | null
  @ApiProperty() familyNotified: boolean
  @ApiPropertyOptional() resolvedAt: string | null
  @ApiPropertyOptional() resolution: string | null
  @ApiPropertyOptional() reportedByName: string | null
  @ApiProperty({ description: 'Ainda em aberto' }) open: boolean
}

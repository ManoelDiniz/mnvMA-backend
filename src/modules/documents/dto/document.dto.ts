import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'
import { DocumentStatus, DocumentType } from '../entities/caregiver-document.entity'

const texto = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() || undefined) : undefined

export class CreateDocumentDto {
  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType, { message: 'Escolha o tipo do documento' })
  type: DocumentType

  @ApiPropertyOptional({ description: 'Obrigatório quando o tipo é OTHER' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(texto)
  label?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(texto)
  number?: string

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @IsDateString({ strict: false }, { message: 'Data de emissão inválida' })
  issuedAt?: string

  @ApiPropertyOptional({ example: '2027-01-15', description: 'Vazio = sem validade' })
  @IsOptional()
  @IsDateString({ strict: false }, { message: 'Data de validade inválida' })
  expiresAt?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  @Transform(texto)
  fileKey?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(texto)
  fileName?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(texto)
  notes?: string
}

export class UpdateDocumentDto extends PartialType(CreateDocumentDto) {}

export class DocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  caregiverId?: string

  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType

  @ApiPropertyOptional({
    enum: ['all', 'pending', 'expiring', 'expired'],
    default: 'all',
    description: '`pending` = vencendo ou vencido — é a lista que a operação abre.',
  })
  @IsOptional()
  @IsIn(['all', 'pending', 'expiring', 'expired'])
  situation: 'all' | 'pending' | 'expiring' | 'expired' = 'all'
}

export class ExpiringQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days = 30
}

export class DocumentResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ format: 'uuid' }) caregiverId: string
  @ApiProperty() caregiverName: string
  @ApiProperty({ enum: DocumentType }) type: DocumentType
  @ApiProperty({ description: 'Rótulo pronto para exibir' }) title: string
  @ApiPropertyOptional() label: string | null
  @ApiPropertyOptional() number: string | null
  @ApiPropertyOptional() issuedAt: string | null
  @ApiPropertyOptional() expiresAt: string | null
  @ApiPropertyOptional() fileKey: string | null
  @ApiPropertyOptional() fileName: string | null
  @ApiPropertyOptional() notes: string | null
  @ApiProperty({ enum: DocumentStatus }) status: DocumentStatus
  @ApiPropertyOptional({ description: 'Dias até vencer. Negativo = vencido há N dias.' })
  daysToExpire: number | null
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage = 25

  @ApiPropertyOptional({ description: 'Busca textual livre' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  q?: string

  get skip(): number {
    return (this.page - 1) * this.perPage
  }
}

export class PageMetaDto {
  @ApiProperty() page: number
  @ApiProperty() perPage: number
  @ApiProperty() total: number
  @ApiProperty() totalPages: number
}

export class PageDto<T> {
  @ApiProperty({ isArray: true })
  data: T[]

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto

  constructor(data: T[], total: number, query: PaginationQueryDto) {
    this.data = data
    this.meta = {
      page: query.page,
      perPage: query.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.perPage)),
    }
  }
}

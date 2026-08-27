import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { TenantType } from '../../../common/enums/tenant.enum'
import { CouponRedemptionStatus } from '../entities/coupon-redemption.entity'

const texto = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : undefined

// ─── Uso pelo assinante ───────────────────────────────────────────────────────

export class PreviewCouponDto {
  @ApiProperty({ example: 'BEMVINDO50' })
  @IsString()
  @MinLength(3, { message: 'Informe o código do cupom' })
  @MaxLength(40)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  code: string

  @ApiProperty({ format: 'uuid', description: 'Plano em que o desconto seria aplicado' })
  @IsUUID('4', { message: 'Escolha um plano' })
  planId: string
}

export class CouponPreviewDto {
  @ApiProperty({ example: 'BEMVINDO50' }) code: string
  @ApiProperty() name: string
  @ApiPropertyOptional() description: string | null

  @ApiProperty({ example: 50 }) discountPercent: number
  @ApiProperty({ description: 'Por quantas faturas o desconto vale' }) maxInvoices: number

  /** 100%: não passa por checkout e não pede cartão. */
  @ApiProperty({ description: 'É cortesia — 100% de desconto' }) courtesy: boolean

  @ApiProperty({ example: 14900 }) priceCents: number
  @ApiProperty({ example: 7450 }) discountedPriceCents: number
  @ApiProperty({ example: '74.50' }) discountedPrice: string
  @ApiProperty({ description: 'Total economizado em todas as faturas', example: 22350 })
  totalSavingsCents: number

  @ApiProperty({ description: 'Frase pronta para a tela', example: '50% nas 3 primeiras faturas' })
  summary: string

  @ApiProperty({ description: 'Ainda será preciso passar pelo Mercado Pago' })
  requiresCheckout: boolean

  @ApiPropertyOptional({ description: 'Até quando a cortesia valeria, se resgatada agora' })
  courtesyEndsAt: Date | null
}

/** O desconto valendo hoje, para a tela de assinatura. */
export class ActiveDiscountDto {
  @ApiProperty() code: string
  @ApiProperty() discountPercent: number
  @ApiProperty() maxInvoices: number
  @ApiProperty() invoicesUsed: number
  @ApiProperty() courtesy: boolean
  @ApiProperty({ enum: CouponRedemptionStatus }) status: CouponRedemptionStatus
  @ApiPropertyOptional({ description: 'Fim da cortesia' }) endsAt: Date | null
  @ApiProperty({ example: '50% de desconto — 1 de 3 faturas usadas' }) summary: string
}

// ─── Administração (SUPER_ADMIN) ──────────────────────────────────────────────

export class CouponTargetsDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'E-mails que podem usar. Vazio junto com tenantIds = cupom aberto',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsEmail({}, { each: true, message: 'E-mail inválido na lista de alvos' })
  emails?: string[]

  @ApiPropertyOptional({ type: [String], description: 'Contas que podem usar' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true, message: 'Conta inválida na lista de alvos' })
  tenantIds?: string[]
}

export class CreateCouponDto {
  @ApiProperty({ example: 'BEMVINDO50', description: 'Vira maiúsculas; precisa ser único' })
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'Use só letras, números e hífen — o código é digitado à mão pelo cliente',
  })
  code: string

  @ApiProperty({ example: 'Campanha de lançamento' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(texto)
  description?: string

  @ApiProperty({ minimum: 1, maximum: 100, description: '100 = cortesia, sem cobrança' })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'O desconto vai de 1% a 100%' })
  @Max(100, { message: 'O desconto vai de 1% a 100%' })
  discountPercent: number

  @ApiPropertyOptional({ default: 1, description: 'Por quantas faturas (ou ciclos) vale' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  maxInvoices?: number

  @ApiPropertyOptional({ description: 'Antes disto o código não é aceito' })
  @IsOptional()
  @IsDateString({}, { message: 'Data de início inválida' })
  startsAt?: string

  @ApiPropertyOptional({ description: 'Fim da janela de resgate — não é a duração do desconto' })
  @IsOptional()
  @IsDateString({}, { message: 'Data de expiração inválida' })
  expiresAt?: string

  @ApiPropertyOptional({ description: 'Teto de contas que podem resgatar' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptions?: number

  @ApiPropertyOptional({ enum: TenantType, description: 'Restringe a um tipo de conta' })
  @IsOptional()
  @IsEnum(TenantType)
  tenantType?: TenantType

  @ApiPropertyOptional({ default: false, description: 'Só para quem nunca teve assinatura paga' })
  @IsOptional()
  @IsBoolean()
  firstSubscriptionOnly?: boolean

  @ApiPropertyOptional({ type: CouponTargetsDto, description: 'Deixe vazio para cupom aberto' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CouponTargetsDto)
  targets?: CouponTargetsDto
}

/**
 * O código não entra: trocá-lo depois de o cupom circular quebraria os links já
 * enviados. Percentual e faturas entram, mas só valem para quem ainda vai
 * resgatar — o resgate congela o benefício.
 */
export class UpdateCouponDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(texto)
  description?: string

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent?: number

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  maxInvoices?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({}, { message: 'Data de início inválida' })
  startsAt?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({}, { message: 'Data de expiração inválida' })
  expiresAt?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptions?: number

  @ApiPropertyOptional({ enum: TenantType })
  @IsOptional()
  @IsEnum(TenantType)
  tenantType?: TenantType

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  firstSubscriptionOnly?: boolean

  @ApiPropertyOptional({ description: 'Desligar não apaga: quem já resgatou continua com o desconto' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class CouponResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty() code: string
  @ApiProperty() name: string
  @ApiPropertyOptional() description: string | null
  @ApiProperty() discountPercent: number
  @ApiProperty() maxInvoices: number
  @ApiProperty() courtesy: boolean
  @ApiPropertyOptional() startsAt: Date | null
  @ApiPropertyOptional() expiresAt: Date | null
  @ApiPropertyOptional() maxRedemptions: number | null
  @ApiPropertyOptional({ enum: TenantType }) tenantType: TenantType | null
  @ApiProperty() firstSubscriptionOnly: boolean
  @ApiProperty() isActive: boolean

  @ApiProperty({ description: 'Resgates que contam para o teto' }) redemptions: number
  @ApiProperty({ description: 'Quantos estão descontando agora' }) activeRedemptions: number
  @ApiProperty({ description: 'Restrito a pessoas específicas' }) restricted: boolean
  @ApiProperty({ type: [String], description: 'E-mails com direito' }) targetEmails: string[]
  @ApiProperty({ type: [String], description: 'Contas com direito' }) targetTenantIds: string[]

  @ApiProperty({ description: 'Dá para resgatar agora' }) redeemable: boolean
  @ApiPropertyOptional({ description: 'Por que não dá' }) blockedReason: string | null

  @ApiProperty() createdAt: Date
}

export class CouponRedemptionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ format: 'uuid' }) tenantId: string
  @ApiProperty() tenantName: string
  @ApiProperty() couponCode: string
  @ApiProperty({ enum: CouponRedemptionStatus }) status: CouponRedemptionStatus
  @ApiProperty() discountPercent: number
  @ApiProperty() maxInvoices: number
  @ApiProperty() invoicesUsed: number
  @ApiProperty() redeemedAt: Date
  @ApiPropertyOptional() activatedAt: Date | null
  @ApiPropertyOptional() endsAt: Date | null
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'
import {
  SubscriptionStatus,
  TenantStatus,
  TenantType,
} from '../../../common/enums/tenant.enum'

// ─── Métricas ─────────────────────────────────────────────────────────────────

export class ContagemPorStatusDto {
  @ApiProperty() TRIAL: number
  @ApiProperty() ACTIVE: number
  @ApiProperty() PAST_DUE: number
  @ApiProperty() SUSPENDED: number
  @ApiProperty() EXPIRED: number
  @ApiProperty() CANCELED: number
}

export class MetricasDto {
  @ApiProperty({ description: 'Contas não excluídas' }) contas: number
  @ApiProperty({ description: 'Pagando agora: assinatura ACTIVE com plano pago' })
  pagantes: number

  @ApiProperty({ type: ContagemPorStatusDto }) porStatus: ContagemPorStatusDto
  @ApiProperty() individuais: number
  @ApiProperty() empresas: number

  @ApiProperty({
    description: 'Receita recorrente mensal em centavos, JÁ com os cupons ativos descontados',
    example: 149000,
  })
  mrrCents: number

  @ApiProperty({ example: '1490.00' }) mrr: string

  @ApiProperty({ description: 'Contas em atraso ou suspensas por falta de pagamento' })
  inadimplentes: number

  @ApiProperty({ description: 'Contas em cortesia por cupom de 100%' }) cortesias: number

  @ApiProperty({ description: 'Contas criadas no mês corrente' }) novasNoMes: number
  @ApiProperty({ description: 'Assinaturas canceladas no mês corrente' })
  canceladasNoMes: number

  @ApiProperty({ description: 'Testes que terminam nos próximos 7 dias' })
  testesTerminando: number

  @ApiProperty({ description: 'Eventos do provedor sem processar ou órfãos' })
  webhooksPendentes: number
}

// ─── Contas ───────────────────────────────────────────────────────────────────

export class ListarContasDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus

  @ApiPropertyOptional({ enum: TenantType })
  @IsOptional()
  @IsEnum(TenantType)
  type?: TenantType
}

export class ContaResumoDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty() name: string
  @ApiProperty({ enum: TenantType }) type: TenantType
  @ApiProperty({ enum: TenantStatus }) status: TenantStatus
  @ApiPropertyOptional() document: string | null
  @ApiPropertyOptional() trialEndsAt: Date | null

  @ApiPropertyOptional() planName: string | null
  @ApiPropertyOptional({ enum: SubscriptionStatus }) subscriptionStatus: SubscriptionStatus | null
  @ApiProperty({ description: 'O que esta conta paga por mês, em centavos' })
  monthlyCents: number

  @ApiPropertyOptional({ description: 'Cupom valendo, se houver' }) couponCode: string | null
  @ApiProperty() users: number
  @ApiPropertyOptional({ description: 'E-mail do titular' }) ownerEmail: string | null
  @ApiProperty() createdAt: Date
}

export class UsuarioDaContaDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty() name: string
  @ApiProperty() email: string
  @ApiProperty() role: string
  @ApiProperty() roleLabel: string
  @ApiProperty() isActive: boolean
  @ApiPropertyOptional() lastLoginAt: Date | null
}

export class AcaoAdministrativaDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty() action: string
  @ApiProperty() actionLabel: string
  @ApiPropertyOptional() actorEmail: string | null
  @ApiPropertyOptional() reason: string | null
  @ApiProperty() createdAt: Date
}

export class ContaDetalheDto extends ContaResumoDto {
  @ApiProperty({ description: 'Uso atual da conta' })
  usage: { customers: number; caregivers: number; users: number; shiftsPerMonth: number }

  @ApiPropertyOptional() currentPeriodEnd: Date | null
  @ApiPropertyOptional() nextChargeAt: Date | null
  @ApiPropertyOptional() pastDueSince: Date | null
  @ApiPropertyOptional() canceledAt: Date | null

  @ApiProperty({ type: [UsuarioDaContaDto] }) usuarios: UsuarioDaContaDto[]

  @ApiProperty({ description: 'Últimas cobranças da assinatura' })
  cobrancas: Array<{
    id: string
    status: string
    amount: string
    statusDetail: string | null
    paidAt: Date | null
    createdAt: Date
  }>

  @ApiProperty({ description: 'Cupons que esta conta resgatou' })
  cupons: Array<{
    code: string
    discountPercent: number
    maxInvoices: number
    invoicesUsed: number
    status: string
    endsAt: Date | null
  }>

  @ApiProperty({ type: [AcaoAdministrativaDto], description: 'O que a administração já fez aqui' })
  historico: AcaoAdministrativaDto[]
}

export class MotivoDto {
  @ApiProperty({
    example: 'Fraude confirmada no chargeback de agosto',
    description: 'Obrigatório: ação sem motivo é a que ninguém consegue explicar depois',
  })
  @IsString()
  @MinLength(5, { message: 'Descreva o motivo — ele fica no histórico da conta' })
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  reason: string
}

export class LimiteDeHistoricoDto {
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number
}

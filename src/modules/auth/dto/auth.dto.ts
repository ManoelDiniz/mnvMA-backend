import { applyDecorators } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'
import { TenantType } from '../../../common/enums/tenant.enum'

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

/**
 * Regra de senha em um lugar só. Cadastro, convite aceito, redefinição e troca
 * usam exatamente estas mensagens — duas cópias divergentes viram, meses
 * depois, um subconjunto de usuários com senha mais fraca que o resto.
 */
export const SENHA_DECORATORS = () =>
  applyDecorators(
    ApiProperty({ minLength: 8, description: 'Mínimo 8 caracteres, com letra e número' }),
    IsString(),
    MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' }),
    MaxLength(72),
    Matches(/(?=.*[A-Za-zÀ-ú])(?=.*\d)/, { message: 'A senha precisa conter letras e números' }),
  )

export class RegisterDto {
  @ApiProperty({ example: 'João Pereira', description: 'Nome de quem está criando a conta' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name: string

  @ApiProperty({ format: 'email' })
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(180)
  @Transform(normalizeEmail)
  email: string

  @SENHA_DECORATORS()
  password: string

  @ApiProperty({ enum: TenantType, description: 'Cuidador Independente ou Empresa' })
  @IsEnum(TenantType)
  accountType: TenantType

  @ApiPropertyOptional({
    description: 'Nome da empresa. Se vazio, usamos o nome da pessoa.',
    example: 'Cuidados São João',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  companyName?: string

  @ApiPropertyOptional({ description: 'CPF ou CNPJ, só dígitos' })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  document?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string
}

export class LoginDto {
  @ApiProperty({ format: 'email' })
  @IsEmail({}, { message: 'E-mail inválido' })
  @Transform(normalizeEmail)
  email: string

  @ApiProperty()
  @IsString()
  @MaxLength(72)
  password: string
}

export class ForgotPasswordDto {
  @ApiProperty({ format: 'email' })
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(180)
  @Transform(normalizeEmail)
  email: string
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recebido por e-mail' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string

  @SENHA_DECORATORS()
  password: string
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Senha atual, para confirmar que é você' })
  @IsString()
  @MaxLength(72)
  currentPassword: string

  @SENHA_DECORATORS()
  password: string
}

export class ResetPasswordPreviewDto {
  @ApiProperty({ description: 'E-mail parcialmente oculto, só para a pessoa se reconhecer' })
  email: string

  @ApiProperty({ description: 'Nome de quem vai trocar a senha' })
  name: string

  @ApiProperty() expiresAt: Date
}

export class AuthTenantDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty({ enum: TenantType }) type: TenantType
  @ApiProperty() status: string
  @ApiPropertyOptional() trialEndsAt?: Date | null
  @ApiProperty({ description: 'Dias restantes de teste; 0 quando não está em trial' })
  trialDaysLeft: number
}

export class AuthUserDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty() email: string
  @ApiProperty() role: string
  @ApiPropertyOptional() caregiverId?: string | null
}

export class SessionDto {
  @ApiProperty({ description: 'Access token JWT. Guarde em memória, nunca em localStorage.' })
  accessToken: string

  @ApiProperty({ description: 'Segundos até expirar' })
  expiresIn: number

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto

  @ApiProperty({ type: AuthTenantDto })
  tenant: AuthTenantDto

  @ApiProperty({ isArray: true, type: String })
  permissions: string[]

  @ApiProperty({ isArray: true, type: String, description: 'Módulos liberados para o tipo de conta' })
  modules: string[]
}

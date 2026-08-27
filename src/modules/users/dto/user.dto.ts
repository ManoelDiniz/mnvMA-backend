import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'
import { SENHA_DECORATORS } from '../../auth/dto/auth.dto'
import { UserRole } from '../../../common/enums/user-role.enum'

const email = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

const texto = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() || undefined) : undefined

/** Papéis que uma conta de cliente pode conceder. SUPER_ADMIN é do MNVMA Core. */
export const PAPEIS_CONCEDIVEIS = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.COORDINATOR,
  UserRole.FINANCE,
  UserRole.CAREGIVER,
] as const

export class InviteUserDto {
  @ApiProperty({ format: 'email' })
  @Transform(email)
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(180)
  email: string

  @ApiProperty()
  @IsString()
  @MinLength(2, { message: 'Informe o nome de quem está sendo convidado' })
  @MaxLength(160)
  name: string

  @ApiProperty({ enum: PAPEIS_CONCEDIVEIS })
  @IsIn(PAPEIS_CONCEDIVEIS, { message: 'Papel inválido' })
  role: UserRole

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Cuidador a vincular. Obrigatório quando o papel é CAREGIVER.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Cuidador inválido' })
  caregiverId?: string
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(texto)
  name?: string

  @ApiPropertyOptional({ enum: PAPEIS_CONCEDIVEIS })
  @IsOptional()
  @IsIn(PAPEIS_CONCEDIVEIS, { message: 'Papel inválido' })
  role?: UserRole

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Cuidador inválido' })
  caregiverId?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole

  @ApiPropertyOptional({ enum: ['all', 'active', 'inactive'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'active', 'inactive'])
  status: 'all' | 'active' | 'inactive' = 'all'
}

export class InvitationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'pending', 'accepted', 'expired', 'revoked'],
    default: 'pending',
    description: 'O padrão é `pending`: a lista existe para cobrar quem ainda não entrou.',
  })
  @IsOptional()
  @IsIn(['all', 'pending', 'accepted', 'expired', 'revoked'])
  situation: 'all' | 'pending' | 'accepted' | 'expired' | 'revoked' = 'pending'
}

export class AcceptInviteDto {
  @ApiProperty({ description: 'Token recebido no convite' })
  @IsString()
  @MinLength(20, { message: 'Convite inválido' })
  @MaxLength(200)
  token: string

  @ApiPropertyOptional({ description: 'Permite corrigir o nome sugerido no convite' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(texto)
  name?: string

  // Mesma regra do cadastro: quem entra por convite não pode acabar com uma
  // senha mais fraca que quem se cadastrou sozinho.
  @SENHA_DECORATORS()
  password: string
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty() name: string
  @ApiProperty({ format: 'email' }) email: string
  @ApiProperty({ enum: UserRole }) role: UserRole
  @ApiProperty({ description: 'Rótulo do papel em português' }) roleLabel: string
  @ApiPropertyOptional() caregiverId: string | null
  @ApiPropertyOptional() caregiverName: string | null
  @ApiProperty() isActive: boolean
  @ApiPropertyOptional() lastLoginAt: string | null
  @ApiProperty() createdAt: string
  @ApiProperty({ description: 'É o próprio usuário da sessão' }) isSelf: boolean
}

export class InvitationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ format: 'email' }) email: string
  @ApiProperty() name: string
  @ApiProperty({ enum: UserRole }) role: UserRole
  @ApiProperty() roleLabel: string
  @ApiPropertyOptional() caregiverId: string | null
  @ApiProperty() expiresAt: string
  @ApiPropertyOptional() acceptedAt: string | null
  @ApiPropertyOptional() revokedAt: string | null
  @ApiPropertyOptional() invitedByName: string | null
  @ApiProperty({ enum: ['pending', 'accepted', 'expired', 'revoked'] })
  situation: 'pending' | 'accepted' | 'expired' | 'revoked'
  @ApiProperty() createdAt: string
}

export class InviteCreatedDto {
  @ApiProperty({ type: InvitationResponseDto }) invitation: InvitationResponseDto

  @ApiProperty({
    description:
      'Link de aceite. Aparece UMA vez — o servidor guarda só o hash. Envie-o a quem foi convidado.',
  })
  inviteUrl: string

  @ApiProperty({
    description:
      'Se o convite saiu por e-mail. Quando é `false`, a tela precisa insistir no link acima — ' +
      'foi ele que sobrou.',
  })
  emailDelivered: boolean
}

/** Preview público do convite, mostrado antes de a pessoa criar a senha. */
export class InvitePreviewDto {
  @ApiProperty() tenantName: string
  @ApiProperty({ format: 'email' }) email: string
  @ApiProperty() name: string
  @ApiProperty({ enum: UserRole }) role: UserRole
  @ApiProperty() roleLabel: string
  @ApiProperty() expiresAt: string
}

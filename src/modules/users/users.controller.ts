import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import {
  CurrentUser,
  PlanLimit,
  Public,
  ReadOnlyAllowed,
  RequirePermission,
} from '../../common/decorators'
import { PageDto } from '../../common/dto/pagination.dto'
import type { AuthenticatedRequest, AuthenticatedUser } from '../../common/types/authenticated-request'
import { SessionDto } from '../auth/dto/auth.dto'
import { TokenService } from '../auth/token.service'
import {
  AcceptInviteDto,
  InvitationQueryDto,
  InvitationResponseDto,
  InviteCreatedDto,
  InvitePreviewDto,
  InviteUserDto,
  UpdateUserDto,
  UserQueryDto,
  UserResponseDto,
} from './dto/user.dto'
import { UsersService } from './users.service'

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  // ─── Fluxo público de convite ───────────────────────────────────────────────
  //
  // Vem primeiro no arquivo por ser a parte sem sessão: quem chega aqui ainda
  // não é usuário de ninguém.

  @Public()
  @Get('invites/:token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Mostra de quem é o convite, antes de pedir a senha',
    description: 'Token inválido, expirado ou cancelado devolvem a mesma resposta 404.',
  })
  @ApiResponse({ status: 200, type: InvitePreviewDto })
  preview(@Param('token') token: string): Promise<InvitePreviewDto> {
    return this.users.previewInvite(token)
  }

  @Public()
  @Post('invites/accept')
  @HttpCode(HttpStatus.OK)
  // Mesmo limite do login: é o outro jeito de criar sessão.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cria a senha, entra na conta e já autentica' })
  @ApiResponse({ status: 200, type: SessionDto })
  async accept(
    @Body() dto: AcceptInviteDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionDto> {
    const { session, refreshToken } = await this.users.accept(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    })

    this.tokens.setRefreshCookie(response, refreshToken)
    return session
  }

  // ─── Convites (dentro da conta) ─────────────────────────────────────────────
  //
  // Declarados ANTES de `users/:id`: o Nest casa as rotas na ordem em que são
  // registradas, e `/users/invites` bateria em `users/:id` com id="invites",
  // devolvendo 400 do ParseUUIDPipe em vez da lista.

  @Get('users/invites')
  @RequirePermission('users:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Convites enviados' })
  listInvitations(@Query() query: InvitationQueryDto): Promise<PageDto<InvitationResponseDto>> {
    return this.users.listInvitations(query)
  }

  @Post('users/invites')
  @RequirePermission('users:write')
  @PlanLimit('users')
  @ApiOperation({
    summary: 'Convida alguém para a conta',
    description:
      'Devolve o link de aceite UMA vez — o servidor guarda só o hash do token. Enquanto não há envio de e-mail, quem convida repassa o link.',
  })
  @ApiResponse({ status: 201, type: InviteCreatedDto })
  invite(
    @Body() dto: InviteUserDto,
    @CurrentUser() atual: AuthenticatedUser,
  ): Promise<InviteCreatedDto> {
    return this.users.invite(dto, atual)
  }

  @Post('users/invites/:id/resend')
  @RequirePermission('users:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reenvia o convite',
    description: 'Gera um token novo e invalida o anterior.',
  })
  resend(@Param('id', ParseUUIDPipe) id: string): Promise<InviteCreatedDto> {
    return this.users.resendInvitation(id)
  }

  @Delete('users/invites/:id')
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Cancela o convite' })
  revoke(@Param('id', ParseUUIDPipe) id: string): Promise<InvitationResponseDto> {
    return this.users.revokeInvitation(id)
  }

  // ─── Equipe ─────────────────────────────────────────────────────────────────

  @Get('users')
  @RequirePermission('users:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Lista os acessos da conta' })
  list(
    @Query() query: UserQueryDto,
    @CurrentUser() atual: AuthenticatedUser,
  ): Promise<PageDto<UserResponseDto>> {
    return this.users.list(query, atual)
  }

  @Get('users/:id')
  @RequirePermission('users:read')
  @ReadOnlyAllowed()
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() atual: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.users.findOne(id, atual)
  }

  @Patch('users/:id')
  @RequirePermission('users:write')
  @ApiOperation({
    summary: 'Altera papel, vínculo com cuidador e acesso',
    description: 'O titular da conta não pode ser rebaixado nem desativado.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() atual: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.users.update(id, dto, atual)
  }

  @Delete('users/:id')
  @RequirePermission('users:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove o acesso',
    description: 'O histórico que a pessoa registrou continua no lugar, com o nome dela.',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() atual: AuthenticatedUser,
  ): Promise<void> {
    return this.users.remove(id, atual)
  }
}

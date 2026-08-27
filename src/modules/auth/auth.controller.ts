import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { RequestContext } from '../../common/context/request-context'
import { CurrentUser, Public, ReadOnlyAllowed } from '../../common/decorators'
import type { AuthenticatedRequest } from '../../common/types/authenticated-request'
import { AuthService } from './auth.service'
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  ResetPasswordPreviewDto,
  SessionDto,
} from './dto/auth.dto'
import { PasswordService } from './password.service'
import { REFRESH_COOKIE, TokenService } from './token.service'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cria a conta (individual ou empresa) e já autentica' })
  @ApiResponse({ status: 201, type: SessionDto })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionDto> {
    const { session, refreshToken } = await this.auth.register(dto, contextOf(request))
    this.tokens.setRefreshCookie(response, refreshToken)
    return session
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Rate limit apertado: é a porta de entrada para força bruta.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Autentica e devolve o access token' })
  @ApiResponse({ status: 200, type: SessionDto })
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionDto> {
    const { session, refreshToken } = await this.auth.login(dto, contextOf(request))
    this.tokens.setRefreshCookie(response, refreshToken)
    return session
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotaciona a sessão usando o cookie httpOnly',
    description:
      'O PWA chama isto ao abrir: o access token vive só em memória e some a cada recarga.',
  })
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionDto> {
    const raw = readRefreshCookie(request)
    const { session, refreshToken } = await this.auth.refresh(raw, contextOf(request))
    this.tokens.setRefreshCookie(response, refreshToken)
    return session
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token e limpa o cookie' })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(request.cookies?.[REFRESH_COOKIE] as string | undefined)
    this.tokens.clearRefreshCookie(response)
  }

  @Get('me')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Sessão atual: usuário, conta, plano, permissões e módulos',
    description: 'É daqui que o painel monta o menu — nada é decidido no cliente.',
  })
  @ApiResponse({ status: 200, type: SessionDto })
  me(@CurrentUser('userId') userId: string): Promise<SessionDto> {
    return this.auth.currentSession(RequestContext.manager(), userId)
  }

  // ─── Senha ──────────────────────────────────────────────────────────────────

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  // Por IP. O teto por usuário fica no serviço: um só não substitui o outro —
  // este segura a varredura, aquele segura o flood na caixa de uma pessoa.
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @ApiOperation({
    summary: 'Envia o link de redefinição de senha',
    description:
      'Responde 204 sempre, inclusive para e-mail que não existe: distinguir os casos ' +
      'transformaria esta rota pública num verificador de quem é cliente.',
  })
  @ApiResponse({ status: 204 })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.passwords.forgot(dto.email, contextOf(request))
  }

  @Public()
  @Get('reset-password/:token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Confere o link antes da pessoa digitar a senha nova',
    description: 'Deixa a tela dizer "este link expirou" antes do formulário, e não depois.',
  })
  @ApiResponse({ status: 200, type: ResetPasswordPreviewDto })
  previewReset(@Param('token') token: string): Promise<ResetPasswordPreviewDto> {
    return this.passwords.preview(token)
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @ApiOperation({
    summary: 'Grava a senha nova e derruba todas as sessões',
    description:
      'Se a redefinição aconteceu porque alguém tomou a conta, deixar a sessão do invasor ' +
      'viva anularia a redefinição.',
  })
  @ApiResponse({ status: 204 })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.passwords.reset(dto.token, dto.password)
    // O aparelho que redefiniu também recomeça: o cookie que ele carregava
    // aponta para um refresh token que acabou de ser revogado.
    this.tokens.clearRefreshCookie(response)
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Troca a senha de quem está logado',
    description:
      'Revoga as demais sessões e renova o cookie desta — quem está trocando a senha não ' +
      'deve ser expulso da própria tela por causa da troca.',
  })
  @ApiResponse({ status: 204 })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser('userId') userId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const { refreshToken } = await this.passwords.change(
      RequestContext.manager(),
      userId,
      dto,
      contextOf(request),
    )
    this.tokens.setRefreshCookie(response, refreshToken)
  }
}

function contextOf(request: AuthenticatedRequest): { ip?: string; userAgent?: string } {
  return {
    ip: request.ip,
    userAgent: request.get('user-agent') ?? undefined,
  }
}

function readRefreshCookie(request: AuthenticatedRequest): string {
  const raw = request.cookies?.[REFRESH_COOKIE] as string | undefined
  if (!raw) {
    // Código próprio para o cliente distinguir "nunca logou" de "token expirou".
    throw new UnauthorizedException({ code: 'NO_SESSION', message: 'Nenhuma sessão ativa.' })
  }
  return raw
}

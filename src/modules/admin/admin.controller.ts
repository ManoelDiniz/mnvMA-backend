import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser, ReadOnlyAllowed, SomenteSuperAdmin } from '../../common/decorators'
import { PageDto } from '../../common/dto/pagination.dto'
import type { AuthenticatedUser } from '../../common/types/authenticated-request'
import { AdminService, type Administrador } from './admin.service'
import {
  ContaDetalheDto,
  ContaResumoDto,
  ListarContasDto,
  MetricasDto,
  MotivoDto,
} from './dto/admin.dto'

/**
 * MNVMA Core — o painel do dono do SaaS.
 *
 * `@SomenteSuperAdmin()` na classe inteira, e não método a método: é o tipo de
 * anotação que alguém esquece de repetir ao acrescentar uma rota, e aqui o
 * esquecimento significaria expor a lista de todos os clientes.
 *
 * `@ReadOnlyAllowed()` porque o estado comercial da conta em que o administrador
 * está logado não tem nada a ver com o direito de administrar a plataforma —
 * seria absurdo perder o Core porque o próprio teste venceu.
 */
@ApiTags('admin: core')
@Controller('admin')
@SomenteSuperAdmin()
@ReadOnlyAllowed()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('metrics')
  @ApiOperation({
    summary: 'Os números do negócio',
    description:
      'MRR já com os cupons ativos descontados — é o que será cobrado no próximo ciclo, não o preço de tabela.',
  })
  metrics(): Promise<MetricasDto> {
    return this.admin.metricas()
  }

  @Get('tenants')
  @ApiOperation({ summary: 'Contas, com filtro por situação, tipo e busca' })
  tenants(@Query() query: ListarContasDto): Promise<PageDto<ContaResumoDto>> {
    return this.admin.contas(query)
  }

  @Get('tenants/:id')
  @ApiOperation({
    summary: 'Detalhe da conta',
    description: 'Assinatura, uso, usuários, cobranças, cupons e o histórico do que a administração já fez.',
  })
  tenant(@Param('id', ParseUUIDPipe) id: string): Promise<ContaDetalheDto> {
    return this.admin.conta(id)
  }

  @Post('tenants/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspende a conta',
    description:
      'Bloqueia a escrita e preserva a leitura, como a suspensão por falta de pagamento. O motivo é obrigatório e fica no histórico.',
  })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MotivoDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ContaDetalheDto> {
    return this.admin.suspender(id, dto.reason, administrador(user))
  }

  @Post('tenants/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reativa a conta',
    description:
      'Volta para ACTIVE só se houver período pago valendo; senão devolve ao teste ou ao estado de "precisa assinar".',
  })
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MotivoDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ContaDetalheDto> {
    return this.admin.reativar(id, dto.reason, administrador(user))
  }
}

/**
 * Quem está agindo vem do token, nunca do corpo da requisição — e só o id: o
 * e-mail que vai para o histórico é resolvido no serviço, a partir dele.
 */
function administrador(user: AuthenticatedUser): Administrador {
  return { userId: user.userId }
}

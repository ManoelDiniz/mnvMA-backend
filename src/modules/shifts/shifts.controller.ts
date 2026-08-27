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
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser, PlanLimit, ReadOnlyAllowed, RequirePermission } from '../../common/decorators'
import type { AuthenticatedUser } from '../../common/types/authenticated-request'
import {
  ChangeShiftStatusDto,
  CreateShiftBatchDto,
  CreateShiftDto,
  ShiftQueryDto,
  ShiftResponseDto,
  SubstituteShiftDto,
  SubstitutionResponseDto,
  UpdateShiftDto,
} from './dto/shift.dto'
import { CandidatoDto } from '../caregivers/dto/availability.dto'
import { ShiftsService } from './shifts.service'

@ApiTags('shifts')
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  @RequirePermission('shifts:read')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Lista plantões de um período',
    description:
      'O filtro é por sobreposição: um plantão noturno que começa no dia 31 aparece também na consulta do mês seguinte.',
  })
  list(@Query() query: ShiftQueryDto): Promise<ShiftResponseDto[]> {
    return this.shifts.list(query)
  }

  @Get(':id')
  @RequirePermission('shifts:read')
  @ReadOnlyAllowed()
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ShiftResponseDto> {
    return this.shifts.findOne(id)
  }

  @Get(':id/candidates')
  @RequirePermission('shifts:read')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Cuidadores que podem cobrir o plantão',
    description:
      'Traz a equipe inteira com o motivo de quem não pode — some da lista sem explicação é pior que aparecer bloqueado.',
  })
  candidates(@Param('id', ParseUUIDPipe) id: string): Promise<CandidatoDto[]> {
    return this.shifts.candidatos(id)
  }

  @Get(':id/substitutions')
  @RequirePermission('shifts:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Histórico de trocas de cuidador do plantão' })
  substitutions(@Param('id', ParseUUIDPipe) id: string): Promise<SubstitutionResponseDto[]> {
    return this.shifts.historicoSubstituicoes(id)
  }

  @Post()
  @RequirePermission('shifts:write')
  @PlanLimit('shiftsPerMonth')
  @ApiOperation({
    summary: 'Agenda um plantão',
    description: 'Valores vêm do serviço escolhido e ficam gravados no plantão.',
  })
  create(@Body() dto: CreateShiftDto): Promise<ShiftResponseDto> {
    return this.shifts.create(dto)
  }

  @Post('batch')
  @RequirePermission('shifts:write')
  @ApiOperation({ summary: 'Gera escala recorrente (ex.: seg/qua/sex por um mês)' })
  createBatch(@Body() dto: CreateShiftBatchDto): Promise<{ criados: number; pulados: number }> {
    return this.shifts.createBatch(dto)
  }

  @Patch(':id')
  @RequirePermission('shifts:write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDto,
  ): Promise<ShiftResponseDto> {
    return this.shifts.update(id, dto)
  }

  @Post(':id/status')
  @RequirePermission('shifts:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Muda o status do plantão',
    description: 'Cancelar e marcar falta exigem motivo. Plantão concluído não volta atrás.',
  })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeShiftStatusDto,
  ): Promise<ShiftResponseDto> {
    return this.shifts.changeStatus(id, dto)
  }

  @Post(':id/substitute')
  @RequirePermission('shifts:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Troca o cuidador do plantão registrando o motivo',
    description:
      'Diferente do PATCH: aqui a troca fica no histórico, com motivo e autor. Use `force` só na emergência — a marca fica no motivo.',
  })
  substitute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubstituteShiftDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShiftResponseDto> {
    return this.shifts.substituir(id, dto, user)
  }

  @Delete(':id')
  @RequirePermission('shifts:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.shifts.remove(id)
  }
}

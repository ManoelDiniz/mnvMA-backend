import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ReadOnlyAllowed, RequirePermission } from '../../common/decorators'
import {
  CopyWeekDto,
  CopyWeekResultDto,
  ScheduleQueryDto,
  ScheduleResponseDto,
} from './dto/schedule.dto'
import { SchedulesService } from './schedules.service'

@ApiTags('schedules')
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @RequirePermission('schedules:read')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Grade da escala: uma linha por cuidador, uma coluna por dia',
    description:
      'O plantão aparece no dia em que começa, mesmo virando a noite. A linha "Sem cuidador" vem sempre, mesmo vazia.',
  })
  grid(@Query() query: ScheduleQueryDto): Promise<ScheduleResponseDto> {
    return this.schedules.grade(query)
  }

  @Post('copy-week')
  @RequirePermission('schedules:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Repete a escala de uma semana nas seguintes',
    description:
      'Copia só plantões planejados e confirmados. Conflito de horário não interrompe a rodada — volta em `warnings`.',
  })
  copyWeek(@Body() dto: CopyWeekDto): Promise<CopyWeekResultDto> {
    return this.schedules.copiarSemana(dto)
  }
}

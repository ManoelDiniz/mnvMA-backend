import { Controller, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ReadOnlyAllowed, RequirePermission } from '../../common/decorators'
import { RentabilidadeDto, ReportQueryDto, ResumoOperacionalDto } from './dto/reports.dto'
import { ReportsService } from './reports.service'

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('profitability')
  @RequirePermission('reports:financial')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Rentabilidade por cliente, cuidador ou serviço',
    description:
      'Conta apenas plantões CONCLUÍDOS — incluir o que está planejado responderia outra pergunta.',
  })
  profitability(@Query() query: ReportQueryDto): Promise<RentabilidadeDto> {
    return this.reports.rentabilidade(query)
  }

  @Get('operations')
  @RequirePermission('reports:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Panorama operacional: plantões, horas, faltas, descobertos' })
  operations(@Query() query: ReportQueryDto): Promise<ResumoOperacionalDto> {
    return this.reports.operacional(query)
  }
}

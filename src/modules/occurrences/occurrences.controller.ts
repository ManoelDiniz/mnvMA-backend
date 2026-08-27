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
import { CurrentUser, ReadOnlyAllowed, RequirePermission } from '../../common/decorators'
import { PageDto } from '../../common/dto/pagination.dto'
import type { AuthenticatedUser } from '../../common/types/authenticated-request'
import {
  CreateOccurrenceDto,
  OccurrenceQueryDto,
  OccurrenceResponseDto,
  ResolveOccurrenceDto,
  UpdateOccurrenceDto,
} from './dto/occurrence.dto'
import { OccurrencesService } from './occurrences.service'

@ApiTags('occurrences')
@Controller('occurrences')
export class OccurrencesController {
  constructor(private readonly occurrences: OccurrencesService) {}

  @Get()
  @RequirePermission('occurrences:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Lista ocorrências, da mais recente para a mais antiga' })
  list(@Query() query: OccurrenceQueryDto): Promise<PageDto<OccurrenceResponseDto>> {
    return this.occurrences.list(query)
  }

  @Get('open-critical')
  @RequirePermission('occurrences:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Ocorrências graves ainda em aberto (painel da coordenação)' })
  openCritical(): Promise<OccurrenceResponseDto[]> {
    return this.occurrences.criticasEmAberto()
  }

  @Get(':id')
  @RequirePermission('occurrences:read')
  @ReadOnlyAllowed()
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OccurrenceResponseDto> {
    return this.occurrences.findOne(id)
  }

  @Post()
  @RequirePermission('occurrences:write')
  @ApiOperation({
    summary: 'Registra ocorrência',
    description: 'Informando o plantão, cliente e cuidador são herdados dele.',
  })
  create(
    @Body() dto: CreateOccurrenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OccurrenceResponseDto> {
    return this.occurrences.create(dto, user)
  }

  @Patch(':id')
  @RequirePermission('occurrences:write')
  @ApiOperation({ summary: 'Corrige o relato. Bloqueado se a ocorrência já foi encerrada.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOccurrenceDto,
  ): Promise<OccurrenceResponseDto> {
    return this.occurrences.update(id, dto)
  }

  @Post(':id/resolve')
  @RequirePermission('occurrences:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Encerra o caso com a descrição do desfecho' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveOccurrenceDto,
  ): Promise<OccurrenceResponseDto> {
    return this.occurrences.resolve(id, dto)
  }

  @Post(':id/reopen')
  @RequirePermission('occurrences:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reabre a ocorrência para correção ou novo desdobramento' })
  reopen(@Param('id', ParseUUIDPipe) id: string): Promise<OccurrenceResponseDto> {
    return this.occurrences.reopen(id)
  }

  @Delete(':id')
  @RequirePermission('occurrences:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.occurrences.remove(id)
  }
}

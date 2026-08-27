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
import { ReadOnlyAllowed, RequirePermission } from '../../common/decorators'
import { PageDto } from '../../common/dto/pagination.dto'
import {
  CreateDocumentDto,
  DocumentQueryDto,
  DocumentResponseDto,
  ExpiringQueryDto,
  UpdateDocumentDto,
} from './dto/document.dto'
import { DocumentsService } from './documents.service'

@ApiTags('documents')
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('documents')
  @RequirePermission('documents:read')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Lista documentos da equipe',
    description: 'Ordenado pelo que vence primeiro. Documento sem validade vai para o fim.',
  })
  list(@Query() query: DocumentQueryDto): Promise<PageDto<DocumentResponseDto>> {
    return this.documents.list(query)
  }

  @Get('documents/expiring')
  @RequirePermission('documents:read')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Documentos vencendo ou já vencidos',
    description:
      'Alimenta o alerta do painel. Inclui o que já venceu — um atestado vencido há 40 dias é mais urgente que um vencendo amanhã.',
  })
  expiring(@Query() query: ExpiringQueryDto): Promise<DocumentResponseDto[]> {
    return this.documents.expiring(query.days)
  }

  @Get('caregivers/:caregiverId/documents')
  @RequirePermission('documents:read')
  @ReadOnlyAllowed()
  byCaregiver(
    @Param('caregiverId', ParseUUIDPipe) caregiverId: string,
    @Query() query: DocumentQueryDto,
  ): Promise<PageDto<DocumentResponseDto>> {
    return this.documents.list({ ...query, caregiverId } as DocumentQueryDto)
  }

  @Post('caregivers/:caregiverId/documents')
  @RequirePermission('documents:write')
  @ApiOperation({ summary: 'Anexa documento ao cuidador' })
  create(
    @Param('caregiverId', ParseUUIDPipe) caregiverId: string,
    @Body() dto: CreateDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.documents.create(caregiverId, dto)
  }

  @Get('documents/:id')
  @RequirePermission('documents:read')
  @ReadOnlyAllowed()
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentResponseDto> {
    return this.documents.findOne(id)
  }

  @Patch('documents/:id')
  @RequirePermission('documents:write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.documents.update(id, dto)
  }

  @Delete('documents/:id')
  @RequirePermission('documents:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.documents.remove(id)
  }
}

import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { memoryStorage } from 'multer'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ReadOnlyAllowed, RequirePermission } from '../../common/decorators'
import { PageDto } from '../../common/dto/pagination.dto'
import {
  CreateDocumentDto,
  DocumentQueryDto,
  DocumentResponseDto,
  ExpiringQueryDto,
  UpdateDocumentDto,
} from './dto/document.dto'
import type { ArquivoRecebido } from '../../common/storage/storage.service'
import { TAMANHO_MAXIMO_BYTES } from '../../common/storage/storage.types'
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

  @Post('documents/:id/file')
  @RequirePermission('documents:write')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      // Memória, não disco: o arquivo vai direto para o armazenamento e nunca
      // encosta no sistema de arquivos da API. O limite duplo (aqui e no
      // serviço) é de propósito — este corta a conexão antes de ler 500 MB.
      storage: memoryStorage(),
      limits: { fileSize: TAMANHO_MAXIMO_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({
    summary: 'Anexa ou troca o arquivo do documento',
    description:
      'PDF ou imagem, até 10 MB. O tipo é conferido pelos primeiros bytes, não pelo que o navegador declara. Trocar remove o arquivo anterior.',
  })
  uploadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: ArquivoRecebido,
  ): Promise<DocumentResponseDto> {
    if (!file) {
      throw new BadRequestException({
        code: 'ARQUIVO_AUSENTE',
        message: 'Escolha um arquivo para anexar.',
      })
    }
    return this.documents.anexarArquivo(id, file)
  }

  @Delete('documents/:id/file')
  @RequirePermission('documents:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove o arquivo, mantendo o registro do documento',
    description: 'A validade continua sendo controlada mesmo sem o arquivo anexado.',
  })
  removeFile(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentResponseDto> {
    return this.documents.removerArquivo(id)
  }

  @Delete('documents/:id')
  @RequirePermission('documents:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.documents.remove(id)
  }
}

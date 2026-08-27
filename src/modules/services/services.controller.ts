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
  CreateServiceDto,
  ServiceQueryDto,
  ServiceResponseDto,
  UpdateServiceDto,
} from './dto/service.dto'
import { ServicesService } from './services.service'

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @RequirePermission('services:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Lista serviços com margem calculada' })
  list(@Query() query: ServiceQueryDto): Promise<PageDto<ServiceResponseDto>> {
    return this.services.list(query)
  }

  @Get(':id')
  @RequirePermission('services:read')
  @ReadOnlyAllowed()
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ServiceResponseDto> {
    return this.services.findOne(id)
  }

  @Post()
  @RequirePermission('services:write')
  @ApiOperation({ summary: 'Cadastra serviço com valor de venda e custo' })
  create(@Body() dto: CreateServiceDto): Promise<ServiceResponseDto> {
    return this.services.create(dto)
  }

  @Patch(':id')
  @RequirePermission('services:write')
  @ApiOperation({
    summary: 'Atualiza serviço',
    description:
      'Mudar o preço aqui não altera plantões já criados — cada plantão guarda os próprios valores.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ): Promise<ServiceResponseDto> {
    return this.services.update(id, dto)
  }

  @Delete(':id')
  @RequirePermission('services:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.services.remove(id)
  }
}

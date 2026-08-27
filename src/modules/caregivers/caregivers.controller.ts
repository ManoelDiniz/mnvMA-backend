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
  Put,
  Query,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PlanLimit, ReadOnlyAllowed, RequirePermission } from '../../common/decorators'
import { PageDto } from '../../common/dto/pagination.dto'
import { AvailabilityService } from './availability.service'
import { CaregiversService } from './caregivers.service'
import {
  AvailabilityResponseDto,
  CreateBlockDto,
  SetAvailabilityDto,
} from './dto/availability.dto'
import { CaregiverQueryDto, CreateCaregiverDto, UpdateCaregiverDto } from './dto/caregiver.dto'
import { Caregiver } from './entities/caregiver.entity'

@ApiTags('caregivers')
@Controller('caregivers')
export class CaregiversController {
  constructor(
    private readonly caregivers: CaregiversService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get()
  @RequirePermission('caregivers:read')
  @ReadOnlyAllowed()
  @ApiOperation({
    summary: 'Lista cuidadores',
    description:
      'Na conta individual devolve um só: o próprio titular, criado junto com o cadastro.',
  })
  list(@Query() query: CaregiverQueryDto): Promise<PageDto<Caregiver>> {
    return this.caregivers.list(query)
  }

  @Get(':id')
  @RequirePermission('caregivers:read')
  @ReadOnlyAllowed()
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Caregiver> {
    return this.caregivers.findOne(id)
  }

  @Post()
  @RequirePermission('caregivers:write')
  @PlanLimit('caregivers')
  @ApiOperation({ summary: 'Cadastra um profissional na equipe' })
  create(@Body() dto: CreateCaregiverDto): Promise<Caregiver> {
    return this.caregivers.create(dto)
  }

  @Patch(':id')
  @RequirePermission('caregivers:write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaregiverDto,
  ): Promise<Caregiver> {
    return this.caregivers.update(id, dto)
  }

  @Delete(':id')
  @RequirePermission('caregivers:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove (soft delete). O titular da conta não pode ser removido.' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.caregivers.remove(id)
  }

  // ─── Disponibilidade ──────────────────────────────────────────────────────

  @Get(':id/availability')
  @RequirePermission('availability:read')
  @ReadOnlyAllowed()
  @ApiOperation({ summary: 'Grade semanal e bloqueios do cuidador' })
  getAvailability(@Param('id', ParseUUIDPipe) id: string): Promise<AvailabilityResponseDto> {
    return this.availability.get(id)
  }

  @Put(':id/availability')
  @RequirePermission('availability:write')
  @ApiOperation({
    summary: 'Substitui a grade semanal inteira',
    description: 'Os bloqueios pontuais não são afetados.',
  })
  setAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAvailabilityDto,
  ): Promise<AvailabilityResponseDto> {
    return this.availability.setSlots(id, dto)
  }

  @Post(':id/blocks')
  @RequirePermission('availability:write')
  @ApiOperation({
    summary: 'Registra indisponibilidade pontual',
    description: 'Férias, viagem, atestado. O bloqueio sempre vence a grade semanal.',
  })
  addBlock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBlockDto,
  ): Promise<AvailabilityResponseDto> {
    return this.availability.addBlock(id, dto)
  }

  @Delete(':id/blocks/:blockId')
  @RequirePermission('availability:write')
  @ApiOperation({ summary: 'Remove um bloqueio' })
  removeBlock(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ): Promise<AvailabilityResponseDto> {
    return this.availability.removeBlock(id, blockId)
  }
}

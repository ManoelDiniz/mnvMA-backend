import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { PageDto } from '../../common/dto/pagination.dto'
import type { AuthenticatedUser } from '../../common/types/authenticated-request'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { Customer } from '../customers/entities/customer.entity'
import { Shift } from '../shifts/entities/shift.entity'
import { User } from '../users/entities/user.entity'
import { Occurrence, OccurrenceSeverity } from './entities/occurrence.entity'
import type {
  CreateOccurrenceDto,
  OccurrenceQueryDto,
  OccurrenceResponseDto,
  ResolveOccurrenceDto,
  UpdateOccurrenceDto,
} from './dto/occurrence.dto'

@Injectable()
export class OccurrencesService {
  private readonly logger = new Logger(OccurrencesService.name)

  constructor(
    @InjectTenantRepository(Occurrence)
    private readonly occurrences: TenantScopedRepository<Occurrence>,
    @InjectTenantRepository(Shift)
    private readonly shifts: TenantScopedRepository<Shift>,
    @InjectTenantRepository(Customer)
    private readonly customers: TenantScopedRepository<Customer>,
    @InjectTenantRepository(Caregiver)
    private readonly caregivers: TenantScopedRepository<Caregiver>,
    @InjectTenantRepository(User)
    private readonly users: TenantScopedRepository<User>,
  ) {}

  async list(query: OccurrenceQueryDto): Promise<PageDto<OccurrenceResponseDto>> {
    const qb = this.occurrences
      .qb('o')
      .leftJoinAndSelect('o.customer', 'cliente')
      .leftJoinAndSelect('o.caregiver', 'cuidador')
      .leftJoinAndSelect('o.shift', 'plantao')

    if (query.customerId) qb.andWhere('o.customerId = :cli', { cli: query.customerId })
    if (query.caregiverId) qb.andWhere('o.caregiverId = :cui', { cui: query.caregiverId })
    if (query.shiftId) qb.andWhere('o.shiftId = :pl', { pl: query.shiftId })
    if (query.type) qb.andWhere('o.type = :tipo', { tipo: query.type })
    if (query.severity) qb.andWhere('o.severity = :grav', { grav: query.severity })
    if (query.from) qb.andWhere('o.occurredAt >= :de', { de: new Date(query.from) })
    if (query.to) qb.andWhere('o.occurredAt <= :ate', { ate: new Date(query.to) })

    if (query.situation === 'open') qb.andWhere('o.resolvedAt IS NULL')
    if (query.situation === 'resolved') qb.andWhere('o.resolvedAt IS NOT NULL')

    if (query.q) {
      qb.andWhere('(o.title LIKE :busca OR o.description LIKE :busca OR cliente.name LIKE :busca)', {
        busca: `%${query.q}%`,
      })
    }

    const [dados, total] = await qb
      .orderBy('o.occurredAt', 'DESC')
      .skip(query.skip)
      .take(query.perPage)
      .getManyAndCount()

    return new PageDto(dados.map(paraResposta), total, query)
  }

  /** Em aberto e graves. É o que o painel da coordenação mostra em cima. */
  async criticasEmAberto(limite = 10): Promise<OccurrenceResponseDto[]> {
    const lista = await this.occurrences
      .qb('o')
      .leftJoinAndSelect('o.customer', 'cliente')
      .leftJoinAndSelect('o.caregiver', 'cuidador')
      .leftJoinAndSelect('o.shift', 'plantao')
      .andWhere('o.resolvedAt IS NULL')
      .andWhere('o.severity IN (:...graves)', {
        graves: [OccurrenceSeverity.HIGH, OccurrenceSeverity.CRITICAL],
      })
      .orderBy('o.occurredAt', 'DESC')
      .take(limite)
      .getMany()

    return lista.map(paraResposta)
  }

  async findOne(id: string): Promise<OccurrenceResponseDto> {
    const ocorrencia = await this.occurrences.findByIdOrFail(
      id,
      { relations: { customer: true, caregiver: true, shift: true } },
      'Ocorrência não encontrada.',
    )
    return paraResposta(ocorrencia)
  }

  async create(dto: CreateOccurrenceDto, autor: AuthenticatedUser): Promise<OccurrenceResponseDto> {
    const { customerId, caregiverId, shiftId } = await this.resolverVinculos(dto)

    // O nome fica COPIADO na ocorrência. O usuário pode sair da empresa e ter o
    // cadastro removido; o relato precisa continuar dizendo quem o escreveu.
    const autorNome = (await this.users.findById(autor.userId))?.name ?? null

    const ocorrencia = await this.occurrences.createAndSave({
      shiftId,
      customerId,
      caregiverId,
      type: dto.type,
      severity: dto.severity,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      title: dto.title.trim(),
      description: dto.description.trim(),
      actionTaken: dto.actionTaken ?? null,
      familyNotified: dto.familyNotified ?? false,
      reportedByUserId: autor.userId ?? null,
      reportedByName: autorNome,
    })

    this.logger.log(
      { occurrenceId: ocorrencia.id, severity: dto.severity, type: dto.type },
      'ocorrência registrada',
    )

    return this.findOne(ocorrencia.id)
  }

  async update(id: string, dto: UpdateOccurrenceDto): Promise<OccurrenceResponseDto> {
    const atual = await this.occurrences.findByIdOrFail(id, {}, 'Ocorrência não encontrada.')

    // Caso encerrado não é reescrito por engano: reabra antes de corrigir. O
    // relato é peça de defesa em questionamento trabalhista — editar em
    // silêncio depois de fechado tira o valor dele.
    if (atual.resolvedAt) {
      throw new ConflictException({
        code: 'OCCURRENCE_RESOLVED',
        message: 'Esta ocorrência já foi encerrada. Reabra-a para poder alterar.',
      })
    }

    await this.occurrences.updateById(id, {
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.severity !== undefined ? { severity: dto.severity } : {}),
      ...(dto.occurredAt !== undefined ? { occurredAt: new Date(dto.occurredAt) } : {}),
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
      ...(dto.actionTaken !== undefined ? { actionTaken: dto.actionTaken ?? null } : {}),
      ...(dto.familyNotified !== undefined ? { familyNotified: dto.familyNotified } : {}),
    })

    return this.findOne(id)
  }

  async resolve(id: string, dto: ResolveOccurrenceDto): Promise<OccurrenceResponseDto> {
    const atual = await this.occurrences.findByIdOrFail(id, {}, 'Ocorrência não encontrada.')

    if (atual.resolvedAt) return this.findOne(id)

    await this.occurrences.updateById(id, {
      resolvedAt: new Date(),
      resolution: dto.resolution.trim(),
    })

    return this.findOne(id)
  }

  async reopen(id: string): Promise<OccurrenceResponseDto> {
    await this.occurrences.findByIdOrFail(id, {}, 'Ocorrência não encontrada.')
    // `resolution` fica: é o histórico de como se achou que estava resolvido.
    await this.occurrences.updateById(id, { resolvedAt: null })
    return this.findOne(id)
  }

  async remove(id: string): Promise<void> {
    await this.occurrences.softDeleteById(id)
  }

  /**
   * Cliente e cuidador podem vir do plantão.
   *
   * Quem registra do celular já está dentro do plantão e não deveria ter de
   * escolher de novo o cliente — errar essa escolha põe a ocorrência no
   * prontuário da pessoa errada.
   */
  private async resolverVinculos(dto: CreateOccurrenceDto): Promise<{
    customerId: string
    caregiverId: string | null
    shiftId: string | null
  }> {
    if (dto.shiftId) {
      const plantao = await this.shifts.findByIdOrFail(dto.shiftId, {}, 'Plantão não encontrado.')
      return {
        shiftId: plantao.id,
        customerId: dto.customerId ?? plantao.customerId,
        caregiverId: dto.caregiverId ?? plantao.caregiverId ?? null,
      }
    }

    if (!dto.customerId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Escolha o cliente ou o plantão.',
        fields: { customerId: 'Escolha o cliente.' },
      })
    }

    await this.customers.findByIdOrFail(dto.customerId, {}, 'Cliente não encontrado.')
    if (dto.caregiverId) {
      await this.caregivers.findByIdOrFail(dto.caregiverId, {}, 'Cuidador não encontrado.')
    }

    return { shiftId: null, customerId: dto.customerId, caregiverId: dto.caregiverId ?? null }
  }
}

export const ROTULOS_GRAVIDADE: Record<OccurrenceSeverity, string> = {
  [OccurrenceSeverity.LOW]: 'Leve',
  [OccurrenceSeverity.MEDIUM]: 'Moderada',
  [OccurrenceSeverity.HIGH]: 'Grave',
  [OccurrenceSeverity.CRITICAL]: 'Crítica',
}

function paraResposta(o: Occurrence): OccurrenceResponseDto {
  return {
    id: o.id,
    shiftId: o.shiftId ?? null,
    shiftStartsAt: o.shift?.startsAt?.toISOString() ?? null,
    customerId: o.customerId,
    customerName: o.customer?.name ?? '',
    caregiverId: o.caregiverId ?? null,
    caregiverName: o.caregiver?.name ?? null,
    type: o.type,
    severity: o.severity,
    occurredAt: o.occurredAt.toISOString(),
    title: o.title,
    description: o.description,
    actionTaken: o.actionTaken ?? null,
    familyNotified: o.familyNotified,
    resolvedAt: o.resolvedAt?.toISOString() ?? null,
    resolution: o.resolution ?? null,
    reportedByName: o.reportedByName ?? null,
    open: !o.resolvedAt,
  }
}

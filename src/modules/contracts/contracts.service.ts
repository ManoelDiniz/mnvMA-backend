import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { fromCents, toCents } from '../../common/database/decimal.transformer'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { PageDto } from '../../common/dto/pagination.dto'
import { dataLocal } from '../../common/utils/calendar'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { Customer } from '../customers/entities/customer.entity'
import { AccountReceivable } from '../finance/entities/account-receivable.entity'
import { Service } from '../services/entities/service.entity'
import { BillingCycle, Contract, ContractStatus } from './entities/contract.entity'
import type {
  ChangeContractStatusDto,
  ContractBillingDto,
  ContractQueryDto,
  ContractResponseDto,
  CreateContractDto,
  UpdateContractDto,
} from './dto/contract.dto'

/**
 * Transições de situação do contrato.
 *
 * Encerrado não volta: reativar um contrato encerrado reabriria a geração de
 * cobrança de meses que já foram fechados no relatório. Quem retomou o
 * atendimento faz contrato novo, e o histórico dos dois fica separado.
 */
const TRANSICOES: Record<ContractStatus, ContractStatus[]> = {
  [ContractStatus.DRAFT]: [ContractStatus.ACTIVE, ContractStatus.ENDED],
  [ContractStatus.ACTIVE]: [ContractStatus.SUSPENDED, ContractStatus.ENDED],
  [ContractStatus.SUSPENDED]: [ContractStatus.ACTIVE, ContractStatus.ENDED],
  [ContractStatus.ENDED]: [],
}

const EXIGEM_MOTIVO = new Set([ContractStatus.SUSPENDED, ContractStatus.ENDED])

export const ROTULOS_STATUS: Record<ContractStatus, string> = {
  [ContractStatus.DRAFT]: 'Rascunho',
  [ContractStatus.ACTIVE]: 'Ativo',
  [ContractStatus.SUSPENDED]: 'Suspenso',
  [ContractStatus.ENDED]: 'Encerrado',
}

@Injectable()
export class ContractsService {
  constructor(
    @InjectTenantRepository(Contract)
    private readonly contracts: TenantScopedRepository<Contract>,
    @InjectTenantRepository(Customer)
    private readonly customers: TenantScopedRepository<Customer>,
    @InjectTenantRepository(Caregiver)
    private readonly caregivers: TenantScopedRepository<Caregiver>,
    @InjectTenantRepository(Service)
    private readonly services: TenantScopedRepository<Service>,
    @InjectTenantRepository(AccountReceivable)
    private readonly receivables: TenantScopedRepository<AccountReceivable>,
  ) {}

  async list(query: ContractQueryDto): Promise<PageDto<ContractResponseDto>> {
    const qb = this.contracts
      .qb('c')
      .leftJoinAndSelect('c.customer', 'cliente')
      .leftJoinAndSelect('c.service', 'servico')
      .leftJoinAndSelect('c.caregiver', 'cuidador')

    if (query.customerId) qb.andWhere('c.customerId = :cli', { cli: query.customerId })
    if (query.status) qb.andWhere('c.status = :st', { st: query.status })
    if (query.q) {
      qb.andWhere('(c.name LIKE :busca OR c.code LIKE :busca OR cliente.name LIKE :busca)', {
        busca: `%${query.q}%`,
      })
    }

    const [dados, total] = await qb
      .orderBy('c.status', 'ASC')
      .addOrderBy('cliente.name', 'ASC')
      .skip(query.skip)
      .take(query.perPage)
      .getManyAndCount()

    const hoje = dataLocal()
    return new PageDto(
      dados.map((c) => paraResposta(c, hoje)),
      total,
      query,
    )
  }

  async findOne(id: string): Promise<ContractResponseDto> {
    const contrato = await this.contracts.findByIdOrFail(
      id,
      { relations: { customer: true, service: true, caregiver: true } },
      'Contrato não encontrado.',
    )
    return paraResposta(contrato, dataLocal())
  }

  /** Cobranças já emitidas por este contrato. */
  async cobrancas(id: string): Promise<ContractBillingDto[]> {
    await this.contracts.findByIdOrFail(id, {}, 'Contrato não encontrado.')

    const lista = await this.receivables
      .qb('r')
      .andWhere('r.contractId = :c', { c: id })
      .orderBy('r.dueDate', 'DESC')
      .take(120)
      .getMany()

    return lista.map((r) => ({
      id: r.id,
      competence: r.competence,
      description: r.description,
      amount: r.amount,
      dueDate: r.dueDate,
      paidAt: r.paidAt ?? null,
      paidAmount: r.paidAmount ?? null,
      status: r.status,
    }))
  }

  async create(dto: CreateContractDto): Promise<ContractResponseDto> {
    await this.assertVinculos(dto)
    this.assertPeriodo(dto.startDate, dto.endDate)
    await this.assertCodigoLivre(dto.code)

    const contrato = await this.contracts.createAndSave({
      customerId: dto.customerId,
      serviceId: dto.serviceId ?? null,
      caregiverId: dto.caregiverId ?? null,
      name: dto.name.trim(),
      code: dto.code ?? null,
      // Nasce como rascunho: contrato que já entra ativo começa a gerar
      // cobrança antes de alguém conferir o valor.
      status: ContractStatus.DRAFT,
      startDate: dto.startDate.slice(0, 10),
      endDate: dto.endDate?.slice(0, 10) ?? null,
      billingCycle: dto.billingCycle ?? BillingCycle.MONTHLY,
      amount: dto.amount,
      estimatedCost: dto.estimatedCost ?? null,
      billingDay: dto.billingDay ?? 10,
      billInArrears: dto.billInArrears ?? false,
      notes: dto.notes ?? null,
    })

    return this.findOne(contrato.id)
  }

  async update(id: string, dto: UpdateContractDto): Promise<ContractResponseDto> {
    const atual = await this.contracts.findByIdOrFail(id, {}, 'Contrato não encontrado.')

    if (atual.status === ContractStatus.ENDED) {
      throw new ConflictException({
        code: 'CONTRACT_ENDED',
        message: 'Contrato encerrado não pode ser alterado.',
      })
    }

    await this.assertVinculos(dto)
    this.assertPeriodo(dto.startDate ?? atual.startDate, dto.endDate ?? atual.endDate ?? undefined)

    if (dto.code !== undefined && dto.code !== atual.code) {
      await this.assertCodigoLivre(dto.code, id)
    }

    // Mudar o valor NÃO reescreve cobrança já emitida — cada conta a receber
    // guarda o próprio valor. O novo preço vale da próxima competência em
    // diante, que é como reajuste funciona na vida real.
    await this.contracts.updateById(id, {
      ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
      ...(dto.serviceId !== undefined ? { serviceId: dto.serviceId ?? null } : {}),
      ...(dto.caregiverId !== undefined ? { caregiverId: dto.caregiverId ?? null } : {}),
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.code !== undefined ? { code: dto.code ?? null } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate.slice(0, 10) } : {}),
      ...(dto.endDate !== undefined ? { endDate: dto.endDate?.slice(0, 10) ?? null } : {}),
      ...(dto.billingCycle !== undefined ? { billingCycle: dto.billingCycle } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.estimatedCost !== undefined ? { estimatedCost: dto.estimatedCost ?? null } : {}),
      ...(dto.billingDay !== undefined ? { billingDay: dto.billingDay } : {}),
      ...(dto.billInArrears !== undefined ? { billInArrears: dto.billInArrears } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes ?? null } : {}),
    })

    return this.findOne(id)
  }

  async changeStatus(id: string, dto: ChangeContractStatusDto): Promise<ContractResponseDto> {
    const contrato = await this.contracts.findByIdOrFail(id, {}, 'Contrato não encontrado.')

    if (contrato.status === dto.status) return this.findOne(id)

    if (!TRANSICOES[contrato.status].includes(dto.status)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `Não é possível mudar de "${ROTULOS_STATUS[contrato.status]}" para "${ROTULOS_STATUS[dto.status]}".`,
      })
    }

    if (EXIGEM_MOTIVO.has(dto.status) && !dto.reason?.trim()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Informe o motivo.',
        fields: { reason: 'Informe o motivo.' },
      })
    }

    await this.contracts.updateById(id, {
      status: dto.status,
      statusReason: EXIGEM_MOTIVO.has(dto.status) ? (dto.reason ?? null) : null,
    })

    return this.findOne(id)
  }

  async remove(id: string): Promise<void> {
    const contrato = await this.contracts.findByIdOrFail(id, {}, 'Contrato não encontrado.')

    const temCobranca = await this.receivables
      .qb('r')
      .andWhere('r.contractId = :c', { c: id })
      .getExists()

    // Contrato que já cobrou faz parte do histórico financeiro: encerrar, não
    // apagar. Apagá-lo deixaria a conta a receber apontando para o nada e
    // quebraria a rentabilidade por contrato dos meses fechados.
    if (temCobranca) {
      throw new ConflictException({
        code: 'CONTRACT_HAS_BILLING',
        message: 'Este contrato já gerou cobrança. Encerre-o em vez de excluir.',
      })
    }

    if (contrato.status === ContractStatus.ACTIVE) {
      throw new ConflictException({
        code: 'CONTRACT_ACTIVE',
        message: 'Suspenda ou encerre o contrato antes de excluir.',
      })
    }

    await this.contracts.softDeleteById(id)
  }

  // ─── Regras ─────────────────────────────────────────────────────────────────

  private async assertVinculos(dto: Partial<CreateContractDto>): Promise<void> {
    if (dto.customerId) {
      await this.customers.findByIdOrFail(dto.customerId, {}, 'Cliente não encontrado.')
    }
    if (dto.serviceId) {
      await this.services.findByIdOrFail(dto.serviceId, {}, 'Serviço não encontrado.')
    }
    if (dto.caregiverId) {
      await this.caregivers.findByIdOrFail(dto.caregiverId, {}, 'Cuidador não encontrado.')
    }
  }

  private assertPeriodo(startDate: string, endDate?: string | null): void {
    if (endDate && endDate.slice(0, 10) < startDate.slice(0, 10)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'O término precisa ser depois do início.',
        fields: { endDate: 'O término precisa ser depois do início.' },
      })
    }
  }

  private async assertCodigoLivre(code?: string | null, ignoreId?: string): Promise<void> {
    if (!code) return

    const qb = this.contracts.qb('c').andWhere('c.code = :code', { code })
    if (ignoreId) qb.andWhere('c.id != :ignoreId', { ignoreId })

    if (await qb.getExists()) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: 'Já existe um contrato com este número.',
        fields: { code: 'Já existe um contrato com este número.' },
      })
    }
  }
}

export function paraResposta(c: Contract, hoje: string): ContractResponseDto {
  const porCompetencia = c.billingCycle === BillingCycle.BIWEEKLY ? 2 : 1

  const mensal = toCents(c.amount) * BigInt(porCompetencia)
  const custoMensal = c.estimatedCost ? toCents(c.estimatedCost) * BigInt(porCompetencia) : null

  const dentroDaVigencia =
    c.startDate.slice(0, 10) <= hoje && (!c.endDate || c.endDate.slice(0, 10) >= hoje)

  return {
    id: c.id,
    customerId: c.customerId,
    customerName: c.customer?.name ?? '',
    serviceId: c.serviceId ?? null,
    serviceName: c.service?.name ?? null,
    caregiverId: c.caregiverId ?? null,
    caregiverName: c.caregiver?.name ?? null,
    name: c.name,
    code: c.code ?? null,
    status: c.status,
    startDate: c.startDate,
    endDate: c.endDate ?? null,
    billingCycle: c.billingCycle,
    amount: c.amount,
    estimatedCost: c.estimatedCost ?? null,
    billingDay: c.billingDay,
    billInArrears: c.billInArrears,
    lastBilledCompetence: c.lastBilledCompetence ?? null,
    statusReason: c.statusReason ?? null,
    notes: c.notes ?? null,
    billingsPerCompetence: porCompetencia,
    monthlyAmount: fromCents(mensal),
    monthlyMargin: custoMensal === null ? null : fromCents(mensal - custoMensal),
    inForce: c.status === ContractStatus.ACTIVE && dentroDaVigencia,
  }
}

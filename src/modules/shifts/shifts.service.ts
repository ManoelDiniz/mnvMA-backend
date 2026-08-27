import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import { Brackets } from 'typeorm'
import { fromCents, toCents } from '../../common/database/decimal.transformer'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { AvailabilityService } from '../caregivers/availability.service'
import { ShiftBillingService } from '../finance/shift-billing.service'
import { Customer } from '../customers/entities/customer.entity'
import { Service } from '../services/entities/service.entity'
import { Shift, ShiftStatus } from './entities/shift.entity'
import { ShiftSubstitution } from './entities/shift-substitution.entity'
import { User } from '../users/entities/user.entity'
import type { CandidatoDto } from '../caregivers/dto/availability.dto'
import type { AuthenticatedUser } from '../../common/types/authenticated-request'
import type {
  ChangeShiftStatusDto,
  CreateShiftBatchDto,
  CreateShiftDto,
  ShiftQueryDto,
  ShiftResponseDto,
  SubstituteShiftDto,
  SubstitutionResponseDto,
  UpdateShiftDto,
} from './dto/shift.dto'

/**
 * Transições válidas de status.
 *
 * Sem esta tabela, um plantão CONCLUÍDO poderia voltar para PLANEJADO e a conta
 * a receber gerada ficaria órfã. Estado de plantão é dinheiro: só anda para
 * frente, e o que sai de CONCLUÍDO/CANCELADO exige intervenção consciente.
 */
const TRANSICOES: Record<ShiftStatus, ShiftStatus[]> = {
  [ShiftStatus.PLANNED]: [ShiftStatus.CONFIRMED, ShiftStatus.CANCELED, ShiftStatus.NO_SHOW],
  [ShiftStatus.CONFIRMED]: [
    ShiftStatus.IN_PROGRESS,
    ShiftStatus.COMPLETED,
    ShiftStatus.CANCELED,
    ShiftStatus.NO_SHOW,
    ShiftStatus.PLANNED,
  ],
  [ShiftStatus.IN_PROGRESS]: [ShiftStatus.COMPLETED, ShiftStatus.NO_SHOW],
  [ShiftStatus.COMPLETED]: [],
  [ShiftStatus.CANCELED]: [ShiftStatus.PLANNED],
  [ShiftStatus.NO_SHOW]: [ShiftStatus.PLANNED],
}

const EXIGEM_MOTIVO = new Set([ShiftStatus.CANCELED, ShiftStatus.NO_SHOW])

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name)

  constructor(
    @InjectTenantRepository(Shift)
    private readonly shifts: TenantScopedRepository<Shift>,
    @InjectTenantRepository(Customer)
    private readonly customers: TenantScopedRepository<Customer>,
    @InjectTenantRepository(Caregiver)
    private readonly caregivers: TenantScopedRepository<Caregiver>,
    @InjectTenantRepository(Service)
    private readonly services: TenantScopedRepository<Service>,
    @InjectTenantRepository(ShiftSubstitution)
    private readonly substitutions: TenantScopedRepository<ShiftSubstitution>,
    @InjectTenantRepository(User)
    private readonly users: TenantScopedRepository<User>,
    private readonly billing: ShiftBillingService,
    private readonly availability: AvailabilityService,
  ) {}

  // ─── Leitura ────────────────────────────────────────────────────────────────

  async list(query: ShiftQueryDto): Promise<ShiftResponseDto[]> {
    const qb = this.shifts
      .qb('s')
      .leftJoinAndSelect('s.customer', 'cliente')
      .leftJoinAndSelect('s.caregiver', 'cuidador')
      .leftJoinAndSelect('s.service', 'servico')

    // Sobreposição, não contenção: um plantão que começa dia 31 e termina dia 1
    // precisa aparecer nos DOIS meses. Filtrar só por `startsAt` esconderia
    // metade do plantão noturno de quem abre a agenda pelo fim do mês.
    if (query.from) qb.andWhere('s.endsAt >= :inicio', { inicio: new Date(query.from) })
    if (query.to) qb.andWhere('s.startsAt <= :fim', { fim: new Date(query.to) })

    if (query.customerId) qb.andWhere('s.customerId = :cli', { cli: query.customerId })
    if (query.caregiverId) qb.andWhere('s.caregiverId = :cui', { cui: query.caregiverId })
    if (query.status) qb.andWhere('s.status = :st', { st: query.status })
    if (query.uncovered) qb.andWhere('s.caregiverId IS NULL')

    const plantoes = await qb.orderBy('s.startsAt', 'ASC').take(query.limit).getMany()
    return plantoes.map(paraResposta)
  }

  async findOne(id: string): Promise<ShiftResponseDto> {
    const plantao = await this.shifts.findByIdOrFail(
      id,
      { relations: { customer: true, caregiver: true, service: true } },
      'Plantão não encontrado.',
    )
    return paraResposta(plantao)
  }

  /**
   * Quem pode cobrir este plantão.
   *
   * Base da substituição (§5 do planejamento). Devolve TODOS os cuidadores
   * ativos, não só os livres — quem organiza a escala às vezes precisa saber
   * *por que* alguém não pode, e um cuidador indisponível some da lista sem
   * explicação é pior do que aparecer com o motivo ao lado.
   *
   * A carga do dia entra no retorno para não empurrar três plantões seguidos
   * para a mesma pessoa só porque a agenda dela estava tecnicamente livre.
   */
  async candidatos(shiftId: string): Promise<CandidatoDto[]> {
    const plantao = await this.shifts.findByIdOrFail(shiftId, {}, 'Plantão não encontrado.')
    const equipe = await this.caregivers.find({ where: { isActive: true } })

    const inicioDoDia = new Date(plantao.startsAt)
    inicioDoDia.setUTCHours(0, 0, 0, 0)
    const fimDoDia = new Date(inicioDoDia.getTime() + 86_400_000)

    const resultado: CandidatoDto[] = []

    for (const cuidador of equipe) {
      const conflito = await this.shifts
        .qb('s')
        .andWhere('s.caregiverId = :cui', { cui: cuidador.id })
        .andWhere('s.id != :atual', { atual: shiftId })
        .andWhere('s.status NOT IN (:...encerrados)', {
          encerrados: [ShiftStatus.CANCELED, ShiftStatus.NO_SHOW],
        })
        .andWhere('s.startsAt < :fim AND s.endsAt > :inicio', {
          inicio: plantao.startsAt,
          fim: plantao.endsAt,
        })
        .getExists()

      const disponibilidade = conflito
        ? { disponivel: false, motivo: 'Já tem plantão nesse horário' }
        : await this.availability.verificar(cuidador.id, plantao.startsAt, plantao.endsAt)

      const noDia = await this.shifts
        .qb('s')
        .andWhere('s.caregiverId = :cui', { cui: cuidador.id })
        .andWhere('s.id != :atual', { atual: shiftId })
        .andWhere('s.startsAt >= :de AND s.startsAt < :ate', { de: inicioDoDia, ate: fimDoDia })
        .andWhere('s.status NOT IN (:...encerrados)', {
          encerrados: [ShiftStatus.CANCELED, ShiftStatus.NO_SHOW],
        })
        .getCount()

      resultado.push({
        id: cuidador.id,
        name: cuidador.name,
        shiftRate: cuidador.shiftRate ?? null,
        available: disponibilidade.disponivel,
        reason: disponibilidade.motivo,
        shiftsSameDay: noDia,
      })
    }

    // Disponíveis primeiro; entre eles, quem está menos carregado no dia.
    return resultado.sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        a.shiftsSameDay - b.shiftsSameDay ||
        a.name.localeCompare(b.name),
    )
  }

  // ─── Escrita ────────────────────────────────────────────────────────────────

  async create(dto: CreateShiftDto): Promise<ShiftResponseDto> {
    const { inicio, fim } = this.validarPeriodo(dto.startsAt, dto.endsAt)
    await this.assertClienteExiste(dto.customerId)

    const valores = await this.resolverValores(dto)

    if (dto.caregiverId) {
      await this.assertCuidadorLivre(dto.caregiverId, inicio, fim)
    }

    const plantao = await this.shifts.createAndSave({
      customerId: dto.customerId,
      caregiverId: dto.caregiverId ?? null,
      serviceId: dto.serviceId ?? null,
      startsAt: inicio,
      endsAt: fim,
      ...valores,
      status: ShiftStatus.PLANNED,
      notes: dto.notes ?? null,
    })

    return this.findOne(plantao.id)
  }

  async update(id: string, dto: UpdateShiftDto): Promise<ShiftResponseDto> {
    const atual = await this.shifts.findByIdOrFail(id, {}, 'Plantão não encontrado.')

    if (atual.status === ShiftStatus.COMPLETED) {
      throw new ConflictException({
        code: 'SHIFT_LOCKED',
        message:
          'Este plantão já foi concluído e gerou lançamentos financeiros. Cancele-o para poder alterar.',
      })
    }

    const inicio = dto.startsAt ? new Date(dto.startsAt) : atual.startsAt
    const fim = dto.endsAt ? new Date(dto.endsAt) : atual.endsAt
    if (dto.startsAt || dto.endsAt) this.validarPeriodo(inicio.toISOString(), fim.toISOString())

    const cuidadorId = dto.caregiverId !== undefined ? dto.caregiverId : atual.caregiverId
    if (cuidadorId) await this.assertCuidadorLivre(cuidadorId, inicio, fim, id)

    await this.shifts.updateById(id, {
      ...(dto.customerId ? { customerId: dto.customerId } : {}),
      ...(dto.caregiverId !== undefined ? { caregiverId: dto.caregiverId ?? null } : {}),
      ...(dto.serviceId !== undefined ? { serviceId: dto.serviceId ?? null } : {}),
      startsAt: inicio,
      endsAt: fim,
      ...(dto.chargeAmount !== undefined ? { chargeAmount: dto.chargeAmount } : {}),
      ...(dto.caregiverCost !== undefined ? { caregiverCost: dto.caregiverCost } : {}),
      ...(dto.otherCosts !== undefined ? { otherCosts: dto.otherCosts } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes ?? null } : {}),
    })

    return this.findOne(id)
  }

  async changeStatus(id: string, dto: ChangeShiftStatusDto): Promise<ShiftResponseDto> {
    const plantao = await this.shifts.findByIdOrFail(id, {}, 'Plantão não encontrado.')

    if (plantao.status === dto.status) return this.findOne(id)

    if (!TRANSICOES[plantao.status].includes(dto.status)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `Não é possível mudar de "${ROTULOS[plantao.status]}" para "${ROTULOS[dto.status]}".`,
      })
    }

    if (EXIGEM_MOTIVO.has(dto.status) && !dto.reason?.trim()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Informe o motivo.',
        fields: { reason: 'Informe o motivo.' },
      })
    }

    await this.shifts.updateById(id, {
      status: dto.status,
      statusReason: EXIGEM_MOTIVO.has(dto.status) ? (dto.reason ?? null) : null,
      ...(dto.status === ShiftStatus.IN_PROGRESS && !plantao.checkInAt
        ? { checkInAt: new Date() }
        : {}),
      ...(dto.status === ShiftStatus.COMPLETED && !plantao.checkOutAt
        ? { checkOutAt: new Date() }
        : {}),
    })

    this.logger.log(
      { shiftId: id, de: plantao.status, para: dto.status },
      'status de plantão alterado',
    )

    // A regra central (§9): plantão concluído vira dinheiro dos dois lados.
    // Roda dentro da mesma transação do request — se a geração falhar, a
    // mudança de status volta atrás junto, e nunca fica plantão concluído sem a
    // cobrança correspondente.
    if (dto.status === ShiftStatus.COMPLETED) {
      const completo = await this.shifts.findByIdOrFail(id, { relations: { customer: true } })
      await this.billing.aoConcluirPlantao(completo, completo.customer?.name ?? '')
    } else if (plantao.status === ShiftStatus.COMPLETED) {
      await this.billing.aoDesfazerConclusao(id)
    }

    return this.findOne(id)
  }

  /**
   * Troca o cuidador do plantão, deixando rastro.
   *
   * Reatribuir por `PATCH /shifts/:id` também funciona, e é exatamente por isso
   * que esta rota existe: o PATCH sobrescreve e a troca desaparece. Aqui a
   * mudança fica registrada com motivo e autor, que é o que sustenta o
   * relatório de rotatividade e a conversa com o cliente que reclama de "toda
   * semana vem alguém diferente".
   *
   * O plantão CONCLUÍDO é recusado: ele já virou conta a receber e conta a
   * pagar no nome de quem trabalhou, e trocar o nome depois criaria pagamento
   * para quem não esteve lá.
   */
  async substituir(
    shiftId: string,
    dto: SubstituteShiftDto,
    autor: AuthenticatedUser,
  ): Promise<ShiftResponseDto> {
    const plantao = await this.shifts.findByIdOrFail(shiftId, {}, 'Plantão não encontrado.')

    if (plantao.status === ShiftStatus.COMPLETED) {
      throw new ConflictException({
        code: 'SHIFT_LOCKED',
        message:
          'Plantão concluído não troca de cuidador — os lançamentos financeiros já saíram no nome de quem trabalhou.',
      })
    }

    if (plantao.caregiverId === dto.caregiverId) {
      throw new ConflictException({
        code: 'SAME_CAREGIVER',
        message: 'Este cuidador já está neste plantão.',
      })
    }

    const novo = await this.caregivers.findByIdOrFail(
      dto.caregiverId,
      {},
      'Cuidador não encontrado.',
    )

    if (!novo.isActive) {
      throw new ConflictException({
        code: 'CAREGIVER_INACTIVE',
        message: `${novo.name} está inativo na equipe.`,
      })
    }

    // `force` cobre o caso real de emergência — plantão em 2h, ninguém livre,
    // alguém aceita cobrir mesmo bloqueado. O que não pode é isso acontecer
    // sem ninguém saber, então o motivo carrega a marca.
    if (dto.force !== true) {
      await this.assertCuidadorLivre(dto.caregiverId, plantao.startsAt, plantao.endsAt, shiftId)
    }

    const motivo = dto.force === true ? `${dto.reason.trim()} (escalado à força)` : dto.reason.trim()
    const autorNome = (await this.users.findById(autor.userId))?.name ?? null

    await this.substitutions.createAndSave({
      shiftId,
      previousCaregiverId: plantao.caregiverId ?? null,
      newCaregiverId: dto.caregiverId,
      reason: motivo,
      changedByUserId: autor.userId,
      changedByName: autorNome,
      previousCost: plantao.caregiverCost,
    })

    await this.shifts.updateById(shiftId, {
      caregiverId: dto.caregiverId,
      // Sem custo informado, o valor do plantão fica como está: o novo cuidador
      // pode custar diferente, mas adivinhar isso sozinho estragaria a margem.
      ...(dto.caregiverCost !== undefined ? { caregiverCost: dto.caregiverCost } : {}),
    })

    this.logger.log(
      { shiftId, de: plantao.caregiverId ?? null, para: dto.caregiverId, forcado: dto.force === true },
      'substituição de cuidador registrada',
    )

    return this.findOne(shiftId)
  }

  /** Histórico de trocas. Sem `shiftId`, devolve as do tenant inteiro. */
  async historicoSubstituicoes(shiftId?: string, limite = 100): Promise<SubstitutionResponseDto[]> {
    const qb = this.substitutions
      .qb('sub')
      .leftJoinAndSelect('sub.previousCaregiver', 'anterior')
      .leftJoinAndSelect('sub.newCaregiver', 'novo')
      .leftJoinAndSelect('sub.shift', 'plantao')
      .leftJoinAndSelect('plantao.customer', 'cliente')

    if (shiftId) qb.andWhere('sub.shiftId = :pl', { pl: shiftId })

    const lista = await qb.orderBy('sub.createdAt', 'DESC').take(limite).getMany()

    return lista.map((s) => ({
      id: s.id,
      shiftId: s.shiftId,
      shiftStartsAt: s.shift?.startsAt?.toISOString() ?? '',
      customerName: s.shift?.customer?.name ?? '',
      previousCaregiverId: s.previousCaregiverId ?? null,
      previousCaregiverName: s.previousCaregiver?.name ?? null,
      newCaregiverId: s.newCaregiverId,
      newCaregiverName: s.newCaregiver?.name ?? '',
      reason: s.reason,
      changedByName: s.changedByName ?? null,
      createdAt: s.createdAt.toISOString(),
      wasUncovered: !s.previousCaregiverId,
    }))
  }

  async remove(id: string): Promise<void> {
    const plantao = await this.shifts.findByIdOrFail(id, {}, 'Plantão não encontrado.')

    if (plantao.status === ShiftStatus.COMPLETED) {
      throw new ConflictException({
        code: 'SHIFT_LOCKED',
        message: 'Plantão concluído não pode ser excluído — ele faz parte do histórico financeiro.',
      })
    }

    await this.shifts.softDeleteById(id)
  }

  /**
   * Escala recorrente: "toda segunda, quarta e sexta de setembro, das 7h às 19h".
   *
   * Dias com plantão idêntico são pulados por padrão em vez de duplicar — quem
   * gera a escala duas vezes por engano não deveria criar 40 plantões repetidos.
   */
  async createBatch(dto: CreateShiftBatchDto): Promise<{ criados: number; pulados: number }> {
    await this.assertClienteExiste(dto.customerId)
    const valores = await this.resolverValores(dto)

    const de = new Date(`${dto.fromDate}T00:00:00.000Z`)
    const ate = new Date(`${dto.toDate}T00:00:00.000Z`)

    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || ate < de) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Período inválido.',
        fields: { toDate: 'A data final precisa ser igual ou posterior à inicial.' },
      })
    }

    const dias = Math.round((ate.getTime() - de.getTime()) / 86_400_000)
    if (dias > 366) {
      throw new BadRequestException({
        code: 'RANGE_TOO_LARGE',
        message: 'Gere no máximo um ano de escala por vez.',
      })
    }

    let criados = 0
    let pulados = 0

    for (let i = 0; i <= dias; i++) {
      const dia = new Date(de.getTime() + i * 86_400_000)
      if (!dto.weekdays.includes(dia.getUTCDay())) continue

      const iso = dia.toISOString().slice(0, 10)
      const inicio = new Date(`${iso}T${dto.startTime}:00.000Z`)
      let fim = new Date(`${iso}T${dto.endTime}:00.000Z`)
      // Fim menor que o início significa plantão noturno: termina no dia seguinte.
      if (fim <= inicio) fim = new Date(fim.getTime() + 86_400_000)

      const jaExiste = await this.shifts
        .qb('s')
        .andWhere('s.customerId = :cli', { cli: dto.customerId })
        .andWhere('s.startsAt = :inicio', { inicio })
        .andWhere('s.status != :cancelado', { cancelado: ShiftStatus.CANCELED })
        .getExists()

      if (jaExiste && dto.skipConflicts !== false) {
        pulados++
        continue
      }

      await this.shifts.createAndSave({
        customerId: dto.customerId,
        caregiverId: dto.caregiverId ?? null,
        serviceId: dto.serviceId ?? null,
        startsAt: inicio,
        endsAt: fim,
        ...valores,
        status: ShiftStatus.PLANNED,
      })
      criados++
    }

    this.logger.log({ criados, pulados }, 'escala gerada em lote')
    return { criados, pulados }
  }

  // ─── Regras ─────────────────────────────────────────────────────────────────

  private validarPeriodo(startsAt: string, endsAt: string) {
    const inicio = new Date(startsAt)
    const fim = new Date(endsAt)

    if (fim <= inicio) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'O término precisa ser depois do início.',
        fields: { endsAt: 'O término precisa ser depois do início.' },
      })
    }

    // 36h cobre o plantão de 24h com folga. Acima disso é quase sempre erro de
    // digitação na data — e um plantão de 300 horas destrói o relatório do mês.
    if (fim.getTime() - inicio.getTime() > 36 * 3_600_000) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Um plantão não pode passar de 36 horas. Confira as datas.',
        fields: { endsAt: 'Duração acima de 36 horas.' },
      })
    }

    return { inicio, fim }
  }

  private async assertClienteExiste(customerId: string): Promise<void> {
    // 404 e não 403: cliente de outro tenant não deve nem ser confirmado.
    await this.customers.findByIdOrFail(customerId, {}, 'Cliente não encontrado.')
  }

  /**
   * Ninguém está em dois lugares ao mesmo tempo.
   *
   * A checagem é de SOBREPOSIÇÃO de intervalos (`inicio < fimExistente AND fim >
   * inicioExistente`), não de igualdade de horário: 7h–19h e 13h–20h no mesmo
   * cuidador é conflito real, ainda que os horários não batam.
   */
  private async assertCuidadorLivre(
    caregiverId: string,
    inicio: Date,
    fim: Date,
    ignorarId?: string,
  ): Promise<void> {
    await this.caregivers.findByIdOrFail(caregiverId, {}, 'Cuidador não encontrado.')

    const qb = this.shifts
      .qb('s')
      .andWhere('s.caregiverId = :cui', { cui: caregiverId })
      .andWhere('s.status NOT IN (:...encerrados)', {
        encerrados: [ShiftStatus.CANCELED, ShiftStatus.NO_SHOW],
      })
      .andWhere(
        new Brackets((w) => {
          w.where('s.startsAt < :fim AND s.endsAt > :inicio', { inicio, fim })
        }),
      )

    if (ignorarId) qb.andWhere('s.id != :ignorar', { ignorar: ignorarId })

    const conflito = await qb.leftJoinAndSelect('s.customer', 'cliente').getOne()

    if (conflito) {
      throw new ConflictException({
        code: 'CAREGIVER_BUSY',
        message: `Este cuidador já tem plantão nesse horário (${conflito.customer?.name ?? 'outro cliente'}).`,
        conflitoId: conflito.id,
      })
    }

    // Bloqueio explícito é recusado; ficar fora da grade semanal, não.
    // A grade é preferência declarada e todo mundo cobre fora dela de vez em
    // quando; o bloqueio é a pessoa dizendo "não posso nestes dias", e escalar
    // alguém em cima disso vira falta na véspera.
    const disponibilidade = await this.availability.verificar(caregiverId, inicio, fim)
    if (!disponibilidade.disponivel && disponibilidade.motivo?.startsWith('Indisponível')) {
      throw new ConflictException({
        code: 'CAREGIVER_UNAVAILABLE',
        message: `Este cuidador marcou indisponibilidade neste período. ${disponibilidade.motivo}`,
      })
    }
  }

  /**
   * Valores vêm do serviço, mas ficam COPIADOS no plantão. Mudar o preço do
   * serviço em março não pode reescrever o que foi cobrado em janeiro.
   */
  private async resolverValores(dto: {
    serviceId?: string
    chargeAmount?: string
    caregiverCost?: string
    otherCosts?: string
  }): Promise<{ chargeAmount: string; caregiverCost: string; otherCosts: string }> {
    let doServico: Service | null = null

    if (dto.serviceId) {
      doServico = await this.services.findByIdOrFail(dto.serviceId, {}, 'Serviço não encontrado.')
    }

    const chargeAmount = dto.chargeAmount ?? doServico?.salePrice
    if (!chargeAmount) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Informe o valor cobrado ou escolha um serviço.',
        fields: { chargeAmount: 'Informe o valor cobrado.' },
      })
    }

    return {
      chargeAmount,
      caregiverCost: dto.caregiverCost ?? doServico?.caregiverCost ?? '0.00',
      otherCosts: dto.otherCosts ?? '0.00',
    }
  }
}

export const ROTULOS: Record<ShiftStatus, string> = {
  [ShiftStatus.PLANNED]: 'Planejado',
  [ShiftStatus.CONFIRMED]: 'Confirmado',
  [ShiftStatus.IN_PROGRESS]: 'Em andamento',
  [ShiftStatus.COMPLETED]: 'Concluído',
  [ShiftStatus.CANCELED]: 'Cancelado',
  [ShiftStatus.NO_SHOW]: 'Falta',
}

function paraResposta(s: Shift): ShiftResponseDto {
  const margem = toCents(s.chargeAmount) - toCents(s.caregiverCost) - toCents(s.otherCosts)

  return {
    id: s.id,
    customerId: s.customerId,
    customerName: s.customer?.name ?? '',
    caregiverId: s.caregiverId ?? null,
    caregiverName: s.caregiver?.name ?? null,
    serviceId: s.serviceId ?? null,
    serviceName: s.service?.name ?? null,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    chargeAmount: s.chargeAmount,
    caregiverCost: s.caregiverCost,
    otherCosts: s.otherCosts,
    status: s.status,
    statusReason: s.statusReason ?? null,
    checkInAt: s.checkInAt?.toISOString() ?? null,
    checkOutAt: s.checkOutAt?.toISOString() ?? null,
    notes: s.notes ?? null,
    hours: Math.round(((s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000) * 100) / 100,
    margin: fromCents(margem),
  }
}

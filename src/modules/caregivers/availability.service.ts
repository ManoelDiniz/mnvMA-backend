import { BadRequestException, Injectable } from '@nestjs/common'
import { RequestContext } from '../../common/context/request-context'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import {
  AvailabilityKind,
  CaregiverAvailability,
} from './entities/caregiver-availability.entity'
import { Caregiver } from './entities/caregiver.entity'
import type {
  AvailabilityResponseDto,
  CreateBlockDto,
  SetAvailabilityDto,
} from './dto/availability.dto'

const FUSO = 'America/Sao_Paulo'

/** Minutos desde a meia-noite local. "07:30" → 450 */
function minutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

/** Dia da semana e minuto local de um instante UTC. */
function localDe(data: Date): { weekday: number; minute: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(data)

  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekday = dias[partes.find((p) => p.type === 'weekday')?.value ?? 'Sun']
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? 0)
  const minuto = Number(partes.find((p) => p.type === 'minute')?.value ?? 0)

  return { weekday, minute: hora * 60 + minuto }
}

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectTenantRepository(CaregiverAvailability)
    private readonly availability: TenantScopedRepository<CaregiverAvailability>,
    @InjectTenantRepository(Caregiver)
    private readonly caregivers: TenantScopedRepository<Caregiver>,
  ) {}

  async get(caregiverId: string): Promise<AvailabilityResponseDto> {
    await this.caregivers.findByIdOrFail(caregiverId, {}, 'Cuidador não encontrado.')

    const registros = await this.availability.find({ where: { caregiverId } })

    return {
      slots: registros
        .filter((r) => r.kind === AvailabilityKind.RECURRING)
        .sort((a, b) => (a.weekday ?? 0) - (b.weekday ?? 0) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
        .map((r) => ({
          id: r.id,
          weekday: r.weekday ?? 0,
          startTime: (r.startTime ?? '').slice(0, 5),
          endTime: (r.endTime ?? '').slice(0, 5),
        })),
      blocks: registros
        .filter((r) => r.kind === AvailabilityKind.BLOCK)
        .sort((a, b) => (a.blockedFrom?.getTime() ?? 0) - (b.blockedFrom?.getTime() ?? 0))
        .map((r) => ({
          id: r.id,
          blockedFrom: r.blockedFrom!.toISOString(),
          blockedTo: r.blockedTo!.toISOString(),
          reason: r.reason ?? null,
        })),
    }
  }

  /** Substitui a grade recorrente inteira. Bloqueios não são tocados. */
  async setSlots(caregiverId: string, dto: SetAvailabilityDto): Promise<AvailabilityResponseDto> {
    await this.caregivers.findByIdOrFail(caregiverId, {}, 'Cuidador não encontrado.')

    for (const slot of dto.slots) {
      if (minutos(slot.startTime) === minutos(slot.endTime)) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Início e término não podem ser iguais.',
          fields: { endTime: 'Início e término não podem ser iguais.' },
        })
      }
    }

    const manager = RequestContext.manager()
    const atuais = await this.availability.find({
      where: { caregiverId, kind: AvailabilityKind.RECURRING },
    })

    if (atuais.length > 0) {
      await manager.getRepository(CaregiverAvailability).softDelete(atuais.map((a) => a.id))
    }

    for (const slot of dto.slots) {
      await this.availability.createAndSave({
        caregiverId,
        kind: AvailabilityKind.RECURRING,
        weekday: slot.weekday,
        startTime: slot.startTime,
        endTime: slot.endTime,
      })
    }

    return this.get(caregiverId)
  }

  async addBlock(caregiverId: string, dto: CreateBlockDto): Promise<AvailabilityResponseDto> {
    await this.caregivers.findByIdOrFail(caregiverId, {}, 'Cuidador não encontrado.')

    const de = new Date(dto.blockedFrom)
    const ate = new Date(dto.blockedTo)

    if (ate <= de) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A data final precisa ser depois da inicial.',
        fields: { blockedTo: 'A data final precisa ser depois da inicial.' },
      })
    }

    await this.availability.createAndSave({
      caregiverId,
      kind: AvailabilityKind.BLOCK,
      blockedFrom: de,
      blockedTo: ate,
      reason: dto.reason ?? null,
    })

    return this.get(caregiverId)
  }

  async removeBlock(caregiverId: string, blockId: string): Promise<AvailabilityResponseDto> {
    const bloco = await this.availability.findOneOrFail(
      { where: { id: blockId, caregiverId, kind: AvailabilityKind.BLOCK } },
      'Bloqueio não encontrado.',
    )
    await this.availability.softDeleteById(bloco.id)
    return this.get(caregiverId)
  }

  /**
   * O cuidador pode trabalhar neste intervalo?
   *
   * Duas regras, nesta ordem:
   *
   * 1. **Bloqueio sempre vence.** Quem avisou que viaja não aparece como
   *    disponível só porque a terça-feira dele é livre na grade.
   * 2. **Sem grade declarada = sempre disponível.** Exigir que todo mundo
   *    preencha a disponibilidade antes de receber o primeiro plantão travaria o
   *    uso do sistema no primeiro dia. A grade só restringe depois de existir.
   */
  async verificar(
    caregiverId: string,
    inicio: Date,
    fim: Date,
  ): Promise<{ disponivel: boolean; motivo: string | null }> {
    const registros = await this.availability.find({ where: { caregiverId } })

    const bloqueio = registros.find(
      (r) =>
        r.kind === AvailabilityKind.BLOCK &&
        r.blockedFrom &&
        r.blockedTo &&
        r.blockedFrom < fim &&
        r.blockedTo > inicio,
    )

    if (bloqueio) {
      return {
        disponivel: false,
        motivo: bloqueio.reason ? `Indisponível: ${bloqueio.reason}` : 'Indisponível neste período',
      }
    }

    const grade = registros.filter((r) => r.kind === AvailabilityKind.RECURRING)
    if (grade.length === 0) return { disponivel: true, motivo: null }

    const cabe = grade.some((faixa) => this.cobre(faixa, inicio, fim))
    return cabe
      ? { disponivel: true, motivo: null }
      : { disponivel: false, motivo: 'Fora da disponibilidade declarada' }
  }

  /**
   * A faixa recorrente cobre o intervalo inteiro?
   *
   * O plantão que vira o dia (19h→07h) é o caso que exige cuidado: a faixa
   * "sábado 19:00–07:00" cobre de sábado 19h até domingo 7h, e comparar minutos
   * sem tratar isso rejeitaria justamente o plantão noturno.
   */
  private cobre(faixa: CaregiverAvailability, inicio: Date, fim: Date): boolean {
    if (faixa.weekday === null || faixa.weekday === undefined) return false

    const de = localDe(inicio)
    if (de.weekday !== faixa.weekday) return false

    const faixaInicio = minutos((faixa.startTime ?? '00:00').slice(0, 5))
    const faixaFimBruto = minutos((faixa.endTime ?? '00:00').slice(0, 5))
    const faixaFim = faixaFimBruto <= faixaInicio ? faixaFimBruto + 1440 : faixaFimBruto

    const duracao = Math.round((fim.getTime() - inicio.getTime()) / 60_000)
    const plantaoInicio = de.minute
    const plantaoFim = plantaoInicio + duracao

    return plantaoInicio >= faixaInicio && plantaoFim <= faixaFim
  }
}

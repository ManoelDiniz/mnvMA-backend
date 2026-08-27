import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { sumMoney } from '../../common/database/decimal.transformer'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import {
  dataLocal,
  diasEntre,
  horaLocal,
  inicioDoDiaLocal,
  paraUtc,
  somarDias,
} from '../../common/utils/calendar'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { Shift, ShiftStatus } from '../shifts/entities/shift.entity'
import type {
  CopyWeekDto,
  CopyWeekResultDto,
  ScheduleCellDto,
  ScheduleDayDto,
  ScheduleQueryDto,
  ScheduleResponseDto,
  ScheduleRowDto,
  ScheduleShiftDto,
} from './dto/schedule.dto'

/** Duas semanas cabem na tela e no cérebro. Acima disso a grade vira sopa. */
const MAX_DIAS = 42

const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const ENCERRADOS = [ShiftStatus.CANCELED, ShiftStatus.NO_SHOW]

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name)

  constructor(
    @InjectTenantRepository(Shift)
    private readonly shifts: TenantScopedRepository<Shift>,
    @InjectTenantRepository(Caregiver)
    private readonly caregivers: TenantScopedRepository<Caregiver>,
  ) {}

  /**
   * Grade cuidador × dia.
   *
   * O plantão fica no dia em que COMEÇA, mesmo virando a noite. É assim que
   * quem monta escala lê: "quem entra na terça à noite" é uma linha da terça,
   * não meia célula da terça e meia da quarta.
   *
   * A linha dos descobertos vem sempre, mesmo vazia — uma tela que esconde a
   * linha quando não há buraco treina o olho a não procurar por ela, e o dia em
   * que houver um buraco ele passa despercebido.
   */
  async grade(query: ScheduleQueryDto): Promise<ScheduleResponseDto> {
    const dias = this.diasDoPeriodo(query.from, query.to)

    const inicio = inicioDoDiaLocal(query.from)
    const fim = inicioDoDiaLocal(somarDias(query.to, 1))

    const qb = this.shifts
      .qb('s')
      .leftJoinAndSelect('s.customer', 'cliente')
      .leftJoinAndSelect('s.service', 'servico')
      .andWhere('s.startsAt >= :inicio AND s.startsAt < :fim', { inicio, fim })
      .andWhere('s.status NOT IN (:...encerrados)', { encerrados: ENCERRADOS })

    if (query.customerId) qb.andWhere('s.customerId = :cli', { cli: query.customerId })

    const plantoes = await qb.orderBy('s.startsAt', 'ASC').getMany()

    const equipe = await this.caregivers.find({
      where: query.includeInactive ? {} : { isActive: true },
      order: { name: 'ASC' },
    })

    // Cuidador desativado que ainda tem plantão no período precisa aparecer:
    // sumir da grade não desfaz a escala dele, só esconde o problema.
    const comPlantao = new Set(plantoes.map((p) => p.caregiverId).filter(Boolean) as string[])
    const faltantes = comPlantao.size
      ? (await this.caregivers.find({})).filter(
          (c) => comPlantao.has(c.id) && !equipe.some((e) => e.id === c.id),
        )
      : []

    const linhas = [...equipe, ...faltantes].map((cuidador) =>
      this.montarLinha(
        cuidador.id,
        cuidador.name,
        cuidador.isActive,
        dias,
        plantoes.filter((p) => p.caregiverId === cuidador.id),
      ),
    )

    const descobertos = this.montarLinha(
      null,
      'Sem cuidador',
      true,
      dias,
      plantoes.filter((p) => !p.caregiverId),
    )

    return {
      from: query.from,
      to: query.to,
      days: dias,
      rows: linhas,
      uncovered: descobertos,
      totalShifts: plantoes.length,
      totalHours: arredondar(plantoes.reduce((soma, p) => soma + horasDe(p), 0)),
      uncoveredShifts: descobertos.totalShifts,
      chargeTotal: sumMoney(plantoes.map((p) => p.chargeAmount)),
      costTotal: sumMoney(plantoes.map((p) => p.caregiverCost)),
    }
  }

  /**
   * Repete a escala de uma semana nas seguintes.
   *
   * É o movimento mais comum da coordenação: a escala é estável e digitá-la de
   * novo toda segunda é o que faz a planilha ganhar do sistema. Três decisões:
   *
   * 1. **Só planejado e confirmado viram cópia.** Copiar uma falta reproduziria
   *    o problema da semana passada na semana que vem.
   * 2. **Conflito não interrompe a rodada.** Um cuidador ocupado num dia não
   *    pode impedir os outros trinta plantões de serem criados; o que falhou
   *    volta em `warnings`, para quem opera resolver caso a caso.
   * 3. **Plantão idêntico já existente é pulado.** Clicar duas vezes não
   *    duplica a semana inteira.
   */
  async copiarSemana(dto: CopyWeekDto): Promise<CopyWeekResultDto> {
    const deslocamento = diasEntre(dto.sourceWeekStart, dto.targetWeekStart)

    if (deslocamento <= 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A semana de destino precisa vir depois da semana modelo.',
        fields: { targetWeekStart: 'Escolha uma semana posterior.' },
      })
    }

    const repeticoes = dto.repeat ?? 1
    const inicio = inicioDoDiaLocal(dto.sourceWeekStart)
    const fim = inicioDoDiaLocal(somarDias(dto.sourceWeekStart, 7))

    const modelo = await this.shifts
      .qb('s')
      .leftJoinAndSelect('s.customer', 'cliente')
      .andWhere('s.startsAt >= :inicio AND s.startsAt < :fim', { inicio, fim })
      .andWhere('s.status IN (:...validos)', {
        validos: [ShiftStatus.PLANNED, ShiftStatus.CONFIRMED],
      })
      .orderBy('s.startsAt', 'ASC')
      .getMany()

    if (!modelo.length) {
      throw new BadRequestException({
        code: 'EMPTY_WEEK',
        message: 'A semana escolhida como modelo não tem plantões para copiar.',
      })
    }

    let criados = 0
    let pulados = 0
    let conflitos = 0
    const avisos: string[] = []

    for (let semana = 0; semana < repeticoes; semana++) {
      const dias = deslocamento + semana * 7

      for (const original of modelo) {
        const novoInicio = this.deslocarDias(original.startsAt, dias)
        const novoFim = this.deslocarDias(original.endsAt, dias)
        const cuidadorId = dto.keepCaregivers === false ? null : (original.caregiverId ?? null)

        const jaExiste = await this.shifts
          .qb('s')
          .andWhere('s.customerId = :cli', { cli: original.customerId })
          .andWhere('s.startsAt = :inicio', { inicio: novoInicio })
          .andWhere('s.status != :cancelado', { cancelado: ShiftStatus.CANCELED })
          .getExists()

        if (jaExiste) {
          pulados++
          continue
        }

        if (cuidadorId) {
          const ocupado = await this.shifts
            .qb('s')
            .andWhere('s.caregiverId = :cui', { cui: cuidadorId })
            .andWhere('s.status NOT IN (:...encerrados)', { encerrados: ENCERRADOS })
            .andWhere('s.startsAt < :fim AND s.endsAt > :inicio', {
              inicio: novoInicio,
              fim: novoFim,
            })
            .getExists()

          if (ocupado) {
            conflitos++
            avisos.push(
              `${dataLocal(novoInicio)} ${horaLocal(novoInicio)} — ${original.customer?.name ?? 'cliente'}: o cuidador já tem plantão nesse horário.`,
            )
            continue
          }
        }

        await this.shifts.createAndSave({
          customerId: original.customerId,
          caregiverId: cuidadorId,
          serviceId: original.serviceId ?? null,
          startsAt: novoInicio,
          endsAt: novoFim,
          chargeAmount: original.chargeAmount,
          caregiverCost: original.caregiverCost,
          otherCosts: original.otherCosts,
          status: ShiftStatus.PLANNED,
          notes: original.notes ?? null,
        })
        criados++
      }
    }

    this.logger.log({ criados, pulados, conflitos, repeticoes }, 'semana de escala copiada')

    return { created: criados, skipped: pulados, conflicts: conflitos, warnings: avisos.slice(0, 50) }
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private diasDoPeriodo(from: string, to: string): ScheduleDayDto[] {
    const total = diasEntre(from, to)

    if (total < 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A data final precisa ser igual ou posterior à inicial.',
        fields: { to: 'A data final precisa ser igual ou posterior à inicial.' },
      })
    }

    if (total >= MAX_DIAS) {
      throw new BadRequestException({
        code: 'RANGE_TOO_LARGE',
        message: `A grade mostra no máximo ${MAX_DIAS} dias por vez.`,
      })
    }

    return Array.from({ length: total + 1 }, (_, i) => {
      const data = somarDias(from, i)
      // `getUTCDay` sobre meia-noite UTC da data de calendário: o dia da semana
      // de "2026-09-01" não depende de fuso nenhum.
      const diaSemana = new Date(`${data}T00:00:00.000Z`).getUTCDay()

      return {
        date: data,
        weekday: diaSemana,
        weekdayLabel: DIAS_DA_SEMANA[diaSemana],
        dayLabel: `${data.slice(8, 10)}/${data.slice(5, 7)}`,
        isWeekend: diaSemana === 0 || diaSemana === 6,
      }
    })
  }

  private montarLinha(
    caregiverId: string | null,
    caregiverName: string,
    isActive: boolean,
    dias: ScheduleDayDto[],
    plantoes: Shift[],
  ): ScheduleRowDto {
    const porDia = new Map<string, Shift[]>()
    for (const plantao of plantoes) {
      const dia = dataLocal(plantao.startsAt)
      const lista = porDia.get(dia)
      if (lista) lista.push(plantao)
      else porDia.set(dia, [plantao])
    }

    const cells: ScheduleCellDto[] = dias.map((dia) => {
      const doDia = porDia.get(dia.date) ?? []
      return {
        date: dia.date,
        shifts: doDia.map(paraGrade),
        hours: arredondar(doDia.reduce((soma, p) => soma + horasDe(p), 0)),
      }
    })

    return {
      caregiverId,
      caregiverName,
      isActive,
      cells,
      totalShifts: plantoes.length,
      totalHours: arredondar(plantoes.reduce((soma, p) => soma + horasDe(p), 0)),
      totalCost: sumMoney(plantoes.map((p) => p.caregiverCost)),
    }
  }

  /**
   * Desloca o instante mantendo a hora LOCAL.
   *
   * Somar `dias * 86.400.000` daria o mesmo resultado hoje — e erraria por uma
   * hora no dia em que o Brasil voltar a ter horário de verão, jogando o
   * plantão das 7h para as 6h em metade da escala copiada.
   */
  private deslocarDias(instante: Date, dias: number): Date {
    return paraUtc(somarDias(dataLocal(instante), dias), horaLocal(instante))
  }
}

function paraGrade(s: Shift): ScheduleShiftDto {
  const inicioLocal = dataLocal(s.startsAt)
  const fimLocal = dataLocal(s.endsAt)

  return {
    id: s.id,
    customerId: s.customerId,
    customerName: s.customer?.name ?? '',
    serviceName: s.service?.name ?? null,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    startTime: horaLocal(s.startsAt),
    endTime: horaLocal(s.endsAt),
    status: s.status,
    overnight: inicioLocal !== fimLocal,
    hours: arredondar(horasDe(s)),
    chargeAmount: s.chargeAmount,
    caregiverCost: s.caregiverCost,
  }
}

function horasDe(s: Shift): number {
  return (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100
}

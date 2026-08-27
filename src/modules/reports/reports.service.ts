import { Injectable } from '@nestjs/common'
import { fromCents, toCents } from '../../common/database/decimal.transformer'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { Shift, ShiftStatus } from '../shifts/entities/shift.entity'
import type {
  LinhaRentabilidadeDto,
  ReportQueryDto,
  ResumoOperacionalDto,
  RentabilidadeDto,
} from './dto/reports.dto'

/** De onde vem o nome de cada agrupamento. */
const AGRUPAMENTOS = {
  customer: { coluna: 's.customer_id', join: 'cliente', nome: 'cliente.name' },
  caregiver: { coluna: 's.caregiver_id', join: 'cuidador', nome: 'cuidador.name' },
  service: { coluna: 's.service_id', join: 'servico', nome: 'servico.name' },
} as const

export type Agrupamento = keyof typeof AGRUPAMENTOS

@Injectable()
export class ReportsService {
  constructor(
    @InjectTenantRepository(Shift)
    private readonly shifts: TenantScopedRepository<Shift>,
  ) {}

  /**
   * Rentabilidade (§10 do planejamento).
   *
   * Só conta plantão **CONCLUÍDO**. Incluir planejado responderia "quanto eu
   * espero faturar", que é outra pergunta — e a mais perigosa das duas, porque
   * enche o relatório de dinheiro que talvez nunca aconteça.
   *
   * O cálculo sai do plantão, não do financeiro: é ali que estão o valor cobrado
   * e o custo do cuidador daquele atendimento específico. Uma conta a receber
   * paga com desconto muda o caixa, não a rentabilidade do serviço prestado.
   */
  async rentabilidade(query: ReportQueryDto): Promise<RentabilidadeDto> {
    const grupo = AGRUPAMENTOS[query.by]

    const qb = this.shifts
      .qb('s')
      .select(grupo.coluna, 'id')
      .addSelect(`MAX(${grupo.nome})`, 'nome')
      .addSelect('COUNT(*)', 'plantoes')
      .addSelect('SUM(TIMESTAMPDIFF(MINUTE, s.starts_at, s.ends_at)) / 60', 'horas')
      .addSelect('SUM(s.charge_amount)', 'receita')
      .addSelect('SUM(s.caregiver_cost + s.other_costs)', 'custo')
      .andWhere('s.status = :concluido', { concluido: ShiftStatus.COMPLETED })
      .groupBy(grupo.coluna)

    if (query.by === 'customer') qb.leftJoin('s.customer', 'cliente')
    if (query.by === 'caregiver') qb.leftJoin('s.caregiver', 'cuidador')
    if (query.by === 'service') qb.leftJoin('s.service', 'servico')

    if (query.from) qb.andWhere('s.starts_at >= :de', { de: new Date(`${query.from}T00:00:00-03:00`) })
    if (query.to) qb.andWhere('s.starts_at <= :ate', { ate: new Date(`${query.to}T23:59:59-03:00`) })

    const linhas = await qb.getRawMany<{
      id: string | null
      nome: string | null
      plantoes: string
      horas: string
      receita: string
      custo: string
    }>()

    const resultado: LinhaRentabilidadeDto[] = linhas.map((linha) => {
      const receita = toCents(linha.receita)
      const custo = toCents(linha.custo)
      const margem = receita - custo

      return {
        id: linha.id,
        // Plantão sem cuidador ou sem serviço ainda conta para a receita — some
        // do agrupamento se cair fora, e aí o total do relatório não fecha.
        name: linha.nome ?? rotuloVazio(query.by),
        shifts: Number(linha.plantoes),
        hours: Math.round(Number(linha.horas ?? 0) * 100) / 100,
        revenue: fromCents(receita),
        cost: fromCents(custo),
        result: fromCents(margem),
        marginPercent: receita > 0n ? Math.round(Number((margem * 1000n) / receita)) / 10 : null,
      }
    })

    resultado.sort((a, b) => Number(b.result) - Number(a.result))

    const totalReceita = resultado.reduce((soma, l) => soma + toCents(l.revenue), 0n)
    const totalCusto = resultado.reduce((soma, l) => soma + toCents(l.cost), 0n)
    const totalMargem = totalReceita - totalCusto

    return {
      by: query.by,
      rows: resultado,
      total: {
        shifts: resultado.reduce((soma, l) => soma + l.shifts, 0),
        hours: Math.round(resultado.reduce((soma, l) => soma + l.hours, 0) * 100) / 100,
        revenue: fromCents(totalReceita),
        cost: fromCents(totalCusto),
        result: fromCents(totalMargem),
        marginPercent:
          totalReceita > 0n ? Math.round(Number((totalMargem * 1000n) / totalReceita)) / 10 : null,
      },
    }
  }

  /**
   * Panorama operacional do período: quantos plantões, quantas horas, quantas
   * faltas. É o que responde "como foi o mês" antes de olhar dinheiro.
   */
  async operacional(query: ReportQueryDto): Promise<ResumoOperacionalDto> {
    const qb = this.shifts
      .qb('s')
      .select('s.status', 'status')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(TIMESTAMPDIFF(MINUTE, s.starts_at, s.ends_at)) / 60', 'horas')
      .groupBy('s.status')

    if (query.from) qb.andWhere('s.starts_at >= :de', { de: new Date(`${query.from}T00:00:00-03:00`) })
    if (query.to) qb.andWhere('s.starts_at <= :ate', { ate: new Date(`${query.to}T23:59:59-03:00`) })

    const linhas = await qb.getRawMany<{ status: ShiftStatus; total: string; horas: string }>()

    const porStatus = Object.fromEntries(
      linhas.map((l) => [l.status, { total: Number(l.total), horas: Number(l.horas ?? 0) }]),
    ) as Record<ShiftStatus, { total: number; horas: number } | undefined>

    const descobertos = await this.shifts
      .qb('s')
      .andWhere('s.caregiverId IS NULL')
      .andWhere('s.status NOT IN (:...encerrados)', {
        encerrados: [ShiftStatus.CANCELED, ShiftStatus.NO_SHOW],
      })
      .andWhere(
        query.from ? 's.starts_at >= :de' : '1=1',
        query.from ? { de: new Date(`${query.from}T00:00:00-03:00`) } : {},
      )
      .andWhere(
        query.to ? 's.starts_at <= :ate' : '1=1',
        query.to ? { ate: new Date(`${query.to}T23:59:59-03:00`) } : {},
      )
      .getCount()

    const contar = (status: ShiftStatus) => porStatus[status]?.total ?? 0
    const realizados = contar(ShiftStatus.COMPLETED)
    const faltas = contar(ShiftStatus.NO_SHOW)
    const cancelados = contar(ShiftStatus.CANCELED)

    return {
      completed: realizados,
      planned: contar(ShiftStatus.PLANNED),
      confirmed: contar(ShiftStatus.CONFIRMED),
      inProgress: contar(ShiftStatus.IN_PROGRESS),
      canceled: cancelados,
      noShow: faltas,
      uncovered: descobertos,
      hoursWorked: Math.round((porStatus[ShiftStatus.COMPLETED]?.horas ?? 0) * 100) / 100,
      // Taxa sobre o que era para acontecer: cancelamento combinado com
      // antecedência não é falta, mas cancelado entra no denominador porque o
      // plantão existiu na escala e alguém contava com ele.
      noShowRate:
        realizados + faltas > 0 ? Math.round((faltas / (realizados + faltas)) * 1000) / 10 : 0,
    }
  }
}

function rotuloVazio(by: Agrupamento): string {
  if (by === 'caregiver') return 'Sem cuidador definido'
  if (by === 'service') return 'Sem serviço definido'
  return 'Sem cliente'
}

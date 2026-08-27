import { ConflictException, Injectable } from '@nestjs/common'
import { fromCents, toCents } from '../../common/database/decimal.transformer'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { Customer } from '../customers/entities/customer.entity'
import {
  AccountPayable,
  PayableCategory,
  PayableStatus,
} from './entities/account-payable.entity'
import { AccountReceivable, ReceivableStatus } from './entities/account-receivable.entity'
import type {
  CashflowPointDto,
  CashflowQueryDto,
  CreatePayableDto,
  CreateReceivableDto,
  FinanceQueryDto,
  FinanceSummaryDto,
  PayableResponseDto,
  ReceivableResponseDto,
  SettleDto,
  UpdatePayableDto,
  UpdateReceivableDto,
} from './dto/finance.dto'

const HOJE = () => new Date().toISOString().slice(0, 10)

@Injectable()
export class FinanceService {
  constructor(
    @InjectTenantRepository(AccountReceivable)
    private readonly receivables: TenantScopedRepository<AccountReceivable>,
    @InjectTenantRepository(AccountPayable)
    private readonly payables: TenantScopedRepository<AccountPayable>,
    @InjectTenantRepository(Customer)
    private readonly customers: TenantScopedRepository<Customer>,
  ) {}

  // ─── Contas a receber ─────────────────────────────────────────────────────

  async listReceivables(query: FinanceQueryDto): Promise<ReceivableResponseDto[]> {
    const qb = this.receivables.qb('r').leftJoinAndSelect('r.customer', 'cliente')

    if (query.from) qb.andWhere('r.dueDate >= :de', { de: query.from })
    if (query.to) qb.andWhere('r.dueDate <= :ate', { ate: query.to })
    if (query.competence) qb.andWhere('r.competence = :comp', { comp: query.competence })
    if (query.customerId) qb.andWhere('r.customerId = :cli', { cli: query.customerId })

    const status = this.parseStatus(query.status)
    if (status) qb.andWhere('r.status IN (:...st)', { st: status })

    const itens = await qb.orderBy('r.dueDate', 'ASC').take(query.limit).getMany()
    return itens.map(recebimentoParaResposta)
  }

  async createReceivable(dto: CreateReceivableDto): Promise<ReceivableResponseDto> {
    await this.customers.findByIdOrFail(dto.customerId, {}, 'Cliente não encontrado.')

    const criado = await this.receivables.createAndSave({
      customerId: dto.customerId,
      description: dto.description,
      amount: dto.amount,
      dueDate: dto.dueDate,
      competence: dto.competence ?? dto.dueDate.slice(0, 7),
      status: ReceivableStatus.PENDING,
      notes: dto.notes ?? null,
    })

    return this.findReceivable(criado.id)
  }

  async updateReceivable(id: string, dto: UpdateReceivableDto): Promise<ReceivableResponseDto> {
    const atual = await this.receivables.findByIdOrFail(id, {}, 'Lançamento não encontrado.')
    this.assertEditavel(atual.status === ReceivableStatus.PAID, atual.shiftId)

    await this.receivables.updateById(id, dto)
    return this.findReceivable(id)
  }

  /** Baixa: registra que o dinheiro entrou de verdade. */
  async settleReceivable(id: string, dto: SettleDto): Promise<ReceivableResponseDto> {
    const atual = await this.receivables.findByIdOrFail(id, {}, 'Lançamento não encontrado.')

    if (atual.status === ReceivableStatus.PAID) {
      throw new ConflictException({
        code: 'ALREADY_SETTLED',
        message: 'Este recebimento já foi baixado.',
      })
    }

    await this.receivables.updateById(id, {
      status: ReceivableStatus.PAID,
      paidAt: dto.paidAt ?? HOJE(),
      // Sem valor informado, assume o previsto. Com valor, respeita o que
      // realmente entrou: desconto e juros são rotina neste setor.
      paidAmount: dto.paidAmount ?? atual.amount,
    })

    return this.findReceivable(id)
  }

  async unsettleReceivable(id: string): Promise<ReceivableResponseDto> {
    const atual = await this.receivables.findByIdOrFail(id, {}, 'Lançamento não encontrado.')
    await this.receivables.updateById(id, {
      status: this.statusPorVencimento(atual.dueDate, ReceivableStatus.PENDING, ReceivableStatus.OVERDUE),
      paidAt: null,
      paidAmount: null,
    })
    return this.findReceivable(id)
  }

  async removeReceivable(id: string): Promise<void> {
    const atual = await this.receivables.findByIdOrFail(id, {}, 'Lançamento não encontrado.')
    this.assertEditavel(atual.status === ReceivableStatus.PAID, atual.shiftId)
    await this.receivables.softDeleteById(id)
  }

  async findReceivable(id: string): Promise<ReceivableResponseDto> {
    const item = await this.receivables.findByIdOrFail(
      id,
      { relations: { customer: true } },
      'Lançamento não encontrado.',
    )
    return recebimentoParaResposta(item)
  }

  // ─── Contas a pagar ───────────────────────────────────────────────────────

  async listPayables(query: FinanceQueryDto): Promise<PayableResponseDto[]> {
    const qb = this.payables.qb('p').leftJoinAndSelect('p.caregiver', 'cuidador')

    if (query.from) qb.andWhere('p.dueDate >= :de', { de: query.from })
    if (query.to) qb.andWhere('p.dueDate <= :ate', { ate: query.to })
    if (query.competence) qb.andWhere('p.competence = :comp', { comp: query.competence })
    if (query.caregiverId) qb.andWhere('p.caregiverId = :cui', { cui: query.caregiverId })
    if (query.category) qb.andWhere('p.category = :cat', { cat: query.category })

    const status = this.parseStatus(query.status)
    if (status) qb.andWhere('p.status IN (:...st)', { st: status })

    const itens = await qb.orderBy('p.dueDate', 'ASC').take(query.limit).getMany()
    return itens.map(pagamentoParaResposta)
  }

  async createPayable(dto: CreatePayableDto): Promise<PayableResponseDto> {
    const criado = await this.payables.createAndSave({
      caregiverId: dto.caregiverId ?? null,
      supplier: dto.supplier ?? null,
      category: dto.category,
      description: dto.description,
      amount: dto.amount,
      dueDate: dto.dueDate,
      competence: dto.competence ?? dto.dueDate.slice(0, 7),
      status: PayableStatus.PENDING,
      notes: dto.notes ?? null,
    })

    return this.findPayable(criado.id)
  }

  async updatePayable(id: string, dto: UpdatePayableDto): Promise<PayableResponseDto> {
    const atual = await this.payables.findByIdOrFail(id, {}, 'Lançamento não encontrado.')
    this.assertEditavel(atual.status === PayableStatus.PAID, atual.shiftId)

    await this.payables.updateById(id, dto)
    return this.findPayable(id)
  }

  async settlePayable(id: string, dto: SettleDto): Promise<PayableResponseDto> {
    const atual = await this.payables.findByIdOrFail(id, {}, 'Lançamento não encontrado.')

    if (atual.status === PayableStatus.PAID) {
      throw new ConflictException({
        code: 'ALREADY_SETTLED',
        message: 'Esta despesa já foi baixada.',
      })
    }

    await this.payables.updateById(id, {
      status: PayableStatus.PAID,
      paidAt: dto.paidAt ?? HOJE(),
      paidAmount: dto.paidAmount ?? atual.amount,
    })

    return this.findPayable(id)
  }

  async unsettlePayable(id: string): Promise<PayableResponseDto> {
    const atual = await this.payables.findByIdOrFail(id, {}, 'Lançamento não encontrado.')
    await this.payables.updateById(id, {
      status: this.statusPorVencimento(atual.dueDate, PayableStatus.PENDING, PayableStatus.OVERDUE),
      paidAt: null,
      paidAmount: null,
    })
    return this.findPayable(id)
  }

  async removePayable(id: string): Promise<void> {
    const atual = await this.payables.findByIdOrFail(id, {}, 'Lançamento não encontrado.')
    this.assertEditavel(atual.status === PayableStatus.PAID, atual.shiftId)
    await this.payables.softDeleteById(id)
  }

  async findPayable(id: string): Promise<PayableResponseDto> {
    const item = await this.payables.findByIdOrFail(
      id,
      { relations: { caregiver: true } },
      'Lançamento não encontrado.',
    )
    return pagamentoParaResposta(item)
  }

  // ─── Visão consolidada ────────────────────────────────────────────────────

  /**
   * Resumo do período.
   *
   * Separa PREVISTO de REALIZADO de propósito: "R$ 8.000 a receber" e "R$ 5.200
   * na conta" são perguntas diferentes, e misturar as duas é o jeito mais rápido
   * de alguém achar que tem dinheiro que ainda não entrou.
   *
   * As somas são feitas em SQL, não em JavaScript — `SUM(decimal)` no MySQL não
   * perde centavo, `reduce` com Number perde.
   */
  async summary(from: string, to: string): Promise<FinanceSummaryDto> {
    const hoje = HOJE()

    const receber = await this.receivables
      .qb('r')
      .select('r.status', 'status')
      .addSelect('SUM(r.amount)', 'previsto')
      .addSelect('SUM(COALESCE(r.paid_amount, r.amount))', 'realizado')
      .addSelect('SUM(CASE WHEN r.due_date < :hoje THEN r.amount ELSE 0 END)', 'vencido')
      .andWhere('r.dueDate BETWEEN :de AND :ate', { de: from, ate: to })
      .andWhere('r.status != :cancelado', { cancelado: ReceivableStatus.CANCELED })
      .setParameter('hoje', hoje)
      .groupBy('r.status')
      .getRawMany<{ status: string; previsto: string; realizado: string; vencido: string }>()

    const pagar = await this.payables
      .qb('p')
      .select('p.status', 'status')
      .addSelect('SUM(p.amount)', 'previsto')
      .addSelect('SUM(COALESCE(p.paid_amount, p.amount))', 'realizado')
      .addSelect('SUM(CASE WHEN p.due_date < :hoje THEN p.amount ELSE 0 END)', 'vencido')
      .andWhere('p.dueDate BETWEEN :de AND :ate', { de: from, ate: to })
      .andWhere('p.status != :cancelado', { cancelado: PayableStatus.CANCELED })
      .setParameter('hoje', hoje)
      .groupBy('p.status')
      .getRawMany<{ status: string; previsto: string; realizado: string; vencido: string }>()

    const somar = (
      linhas: Array<{ status: string; previsto: string; realizado: string; vencido: string }>,
      pagos: string,
    ) => {
      let previsto = 0n
      let recebido = 0n
      let vencido = 0n

      for (const linha of linhas) {
        previsto += toCents(linha.previsto)
        if (linha.status === pagos) recebido += toCents(linha.realizado)
        else vencido += toCents(linha.vencido)
      }

      return { previsto, recebido, vencido }
    }

    const r = somar(receber, ReceivableStatus.PAID)
    const p = somar(pagar, PayableStatus.PAID)

    return {
      toReceive: fromCents(r.previsto - r.recebido),
      received: fromCents(r.recebido),
      overdueReceivable: fromCents(r.vencido),
      toPay: fromCents(p.previsto - p.recebido),
      paid: fromCents(p.recebido),
      overduePayable: fromCents(p.vencido),
      cashResult: fromCents(r.recebido - p.recebido),
      expectedResult: fromCents(r.previsto - p.previsto),
    }
  }

  /**
   * Fluxo de caixa pelo dinheiro que REALMENTE circulou — agrupado pela data de
   * pagamento, não pela de vencimento. Uma conta de agosto paga em setembro
   * pertence ao caixa de setembro, e é essa a pergunta de quem olha esta tela.
   */
  async cashflow(query: CashflowQueryDto): Promise<CashflowPointDto[]> {
    const formato = query.groupBy === 'day' ? '%Y-%m-%d' : '%Y-%m'

    const entradas = await this.receivables
      .qb('r')
      .select(`DATE_FORMAT(r.paid_at, '${formato}')`, 'periodo')
      .addSelect('SUM(COALESCE(r.paid_amount, r.amount))', 'total')
      .andWhere('r.status = :pago', { pago: ReceivableStatus.PAID })
      .andWhere('r.paidAt BETWEEN :de AND :ate', { de: query.from, ate: query.to })
      .groupBy('periodo')
      .getRawMany<{ periodo: string; total: string }>()

    const saidas = await this.payables
      .qb('p')
      .select(`DATE_FORMAT(p.paid_at, '${formato}')`, 'periodo')
      .addSelect('SUM(COALESCE(p.paid_amount, p.amount))', 'total')
      .andWhere('p.status = :pago', { pago: PayableStatus.PAID })
      .andWhere('p.paidAt BETWEEN :de AND :ate', { de: query.from, ate: query.to })
      .groupBy('periodo')
      .getRawMany<{ periodo: string; total: string }>()

    const periodos = new Set([
      ...entradas.map((e) => e.periodo),
      ...saidas.map((s) => s.periodo),
    ])

    const porEntrada = new Map(entradas.map((e) => [e.periodo, toCents(e.total)]))
    const porSaida = new Map(saidas.map((s) => [s.periodo, toCents(s.total)]))

    return [...periodos]
      .filter(Boolean)
      .sort()
      .map((periodo) => {
        const income = porEntrada.get(periodo) ?? 0n
        const expense = porSaida.get(periodo) ?? 0n
        return {
          period: periodo,
          income: fromCents(income),
          expense: fromCents(expense),
          balance: fromCents(income - expense),
        }
      })
  }

  /**
   * Marca como vencido o que passou da data. Roda sob demanda por enquanto;
   * no Sprint 7 vira job diário (`finance:mark-overdue`).
   */
  async markOverdue(): Promise<{ receivables: number; payables: number }> {
    const hoje = HOJE()

    const r = await this.receivables
      .qb('r')
      .update()
      .set({ status: ReceivableStatus.OVERDUE })
      .andWhere('r.due_date < :hoje', { hoje })
      .andWhere('r.status = :pendente', { pendente: ReceivableStatus.PENDING })
      .execute()

    const p = await this.payables
      .qb('p')
      .update()
      .set({ status: PayableStatus.OVERDUE })
      .andWhere('p.due_date < :hoje', { hoje })
      .andWhere('p.status = :pendente', { pendente: PayableStatus.PENDING })
      .execute()

    return { receivables: r.affected ?? 0, payables: p.affected ?? 0 }
  }

  // ─── Interno ──────────────────────────────────────────────────────────────

  private parseStatus(bruto?: string): string[] | null {
    if (!bruto || bruto === 'all') return null
    return bruto
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  }

  private statusPorVencimento<T>(dueDate: string, emDia: T, vencido: T): T {
    return dueDate < HOJE() ? vencido : emDia
  }

  /**
   * Lançamento vindo de plantão não é editado solto: mudar o valor aqui deixaria
   * o plantão e o financeiro contando histórias diferentes. Corrige-se no
   * plantão, e o valor desce.
   */
  private assertEditavel(pago: boolean, shiftId?: string | null): void {
    if (pago) {
      throw new ConflictException({
        code: 'ALREADY_SETTLED',
        message: 'Lançamento já baixado. Desfaça a baixa antes de alterar.',
      })
    }
    if (shiftId) {
      throw new ConflictException({
        code: 'LINKED_TO_SHIFT',
        message: 'Este lançamento veio de um plantão. Altere o plantão para corrigir os valores.',
      })
    }
  }
}

// ─── Serialização ─────────────────────────────────────────────────────────────

function diasDeAtraso(dueDate: string, quitado: boolean): number {
  if (quitado) return 0
  const hoje = HOJE()
  if (dueDate >= hoje) return 0
  return Math.floor(
    (new Date(`${hoje}T00:00:00Z`).getTime() - new Date(`${dueDate}T00:00:00Z`).getTime()) /
      86_400_000,
  )
}

function recebimentoParaResposta(r: AccountReceivable): ReceivableResponseDto {
  return {
    id: r.id,
    customerId: r.customerId,
    customerName: r.customer?.name ?? '',
    shiftId: r.shiftId ?? null,
    contractId: r.contractId ?? null,
    competence: r.competence,
    description: r.description,
    amount: r.amount,
    dueDate: typeof r.dueDate === 'string' ? r.dueDate : String(r.dueDate),
    paidAt: r.paidAt ?? null,
    paidAmount: r.paidAmount ?? null,
    status: r.status,
    daysOverdue: diasDeAtraso(
      String(r.dueDate),
      r.status === ReceivableStatus.PAID || r.status === ReceivableStatus.CANCELED,
    ),
    notes: r.notes ?? null,
  }
}

function pagamentoParaResposta(p: AccountPayable): PayableResponseDto {
  return {
    id: p.id,
    caregiverId: p.caregiverId ?? null,
    caregiverName: p.caregiver?.name ?? null,
    supplier: p.supplier ?? null,
    category: p.category,
    shiftId: p.shiftId ?? null,
    competence: p.competence,
    description: p.description,
    amount: p.amount,
    dueDate: typeof p.dueDate === 'string' ? p.dueDate : String(p.dueDate),
    paidAt: p.paidAt ?? null,
    paidAmount: p.paidAmount ?? null,
    status: p.status,
    daysOverdue: diasDeAtraso(
      String(p.dueDate),
      p.status === PayableStatus.PAID || p.status === PayableStatus.CANCELED,
    ),
    notes: p.notes ?? null,
  }
}

export const CATEGORIAS_DESPESA = Object.values(PayableCategory)

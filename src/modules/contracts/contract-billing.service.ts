import { Injectable, Logger } from '@nestjs/common'
import { fromCents, sumMoney, toCents } from '../../common/database/decimal.transformer'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import {
  competenciaLocal,
  competenciaMenorOuIgual,
  diaDaCompetencia,
  diasNoMes,
  proximaCompetencia,
} from '../../common/utils/calendar'
import { AccountReceivable, ReceivableStatus } from '../finance/entities/account-receivable.entity'
import { BillingCycle, Contract, ContractStatus } from './entities/contract.entity'
import type { BillingRunItemDto, BillingRunResultDto } from './dto/contract.dto'

/**
 * Geração de cobrança dos contratos recorrentes.
 *
 * A regra que sustenta tudo: **rodar duas vezes não cobra duas vezes**. Isso
 * vale para o job diário reprocessado, para o clique dobrado no botão e para o
 * retry de rede. Três travas em camadas:
 *
 * 1. `lastBilledCompetence` no contrato — a marca d'água do que já saiu.
 * 2. Consulta pelo par (`contractId`, `dueDate`) antes de inserir.
 * 3. Chave única `(tenant_id, contract_id, due_date)` em `account_receivables`
 *    — a única que continua valendo se duas instâncias rodarem o job ao mesmo
 *    tempo.
 *
 * As duas primeiras dão a mensagem boa ("já foi cobrado"); a terceira é a que
 * de fato protege o cliente.
 */
@Injectable()
export class ContractBillingService {
  private readonly logger = new Logger(ContractBillingService.name)

  constructor(
    @InjectTenantRepository(Contract)
    private readonly contracts: TenantScopedRepository<Contract>,
    @InjectTenantRepository(AccountReceivable)
    private readonly receivables: TenantScopedRepository<AccountReceivable>,
  ) {}

  /**
   * Gera a competência para todos os contratos ativos do tenant.
   *
   * `dryRun` existe porque disparar cobrança errada para 40 famílias é um
   * telefonema por família. Quem opera confere a prévia antes.
   */
  async gerarCompetencia(
    competencia = competenciaLocal(),
    opcoes: { dryRun?: boolean; contractId?: string } = {},
  ): Promise<BillingRunResultDto> {
    const qb = this.contracts
      .qb('c')
      .leftJoinAndSelect('c.customer', 'cliente')
      .andWhere('c.status = :ativo', { ativo: ContractStatus.ACTIVE })

    if (opcoes.contractId) qb.andWhere('c.id = :id', { id: opcoes.contractId })

    const contratos = await qb.orderBy('cliente.name', 'ASC').getMany()

    const items: BillingRunItemDto[] = []
    const valores: string[] = []

    for (const contrato of contratos) {
      const item = await this.gerarDoContrato(contrato, competencia, opcoes.dryRun === true)
      items.push(item)
      if (item.result === 'created') valores.push(item.amount)
    }

    const resultado: BillingRunResultDto = {
      competence: competencia,
      dryRun: opcoes.dryRun === true,
      created: items.filter((i) => i.result === 'created').length,
      skipped: items.filter((i) => i.result === 'skipped').length,
      total: sumMoney(valores),
      items,
    }

    this.logger.log(
      {
        competencia,
        gerados: resultado.created,
        pulados: resultado.skipped,
        dryRun: resultado.dryRun,
      },
      'rodada de cobrança de contratos',
    )

    return resultado
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private async gerarDoContrato(
    contrato: Contract,
    competencia: string,
    dryRun: boolean,
  ): Promise<BillingRunItemDto> {
    const base: Omit<BillingRunItemDto, 'result' | 'reason'> = {
      contractId: contrato.id,
      contractName: contrato.name,
      customerName: contrato.customer?.name ?? '',
      competence: competencia,
      dueDates: [],
      amount: '0.00',
    }

    const impedimento = this.motivoParaPular(contrato, competencia)
    if (impedimento) return { ...base, result: 'skipped', reason: impedimento }

    const vencimentos = this.vencimentosDe(contrato, competencia)

    // Já existe cobrança para algum desses vencimentos: a competência já saiu.
    // Conferimos ANTES de gravar qualquer uma para não deixar meia rodada de pé
    // num contrato quinzenal.
    for (const dueDate of vencimentos) {
      const existe = await this.receivables
        .qb('r')
        .andWhere('r.contractId = :c', { c: contrato.id })
        .andWhere('r.dueDate = :d', { d: dueDate })
        .getExists()

      if (existe) {
        return { ...base, result: 'skipped', reason: 'Competência já cobrada' }
      }
    }

    const total = fromCents(toCents(contrato.amount) * BigInt(vencimentos.length))

    if (dryRun) {
      return { ...base, dueDates: vencimentos, amount: total, result: 'created' }
    }

    for (const [indice, dueDate] of vencimentos.entries()) {
      await this.receivables.createAndSave({
        customerId: contrato.customerId,
        contractId: contrato.id,
        competence: competencia,
        description: this.descricao(contrato, competencia, indice, vencimentos.length),
        amount: contrato.amount,
        dueDate,
        // PENDING, não FORECAST: o contrato é obrigação assumida, não previsão.
        // Deixá-lo em FORECAST tiraria a mensalidade do "a receber do mês", que
        // é onde a empresa olha para saber se fecha a folha.
        status: ReceivableStatus.PENDING,
      })
    }

    await this.contracts.updateById(contrato.id, { lastBilledCompetence: competencia })

    return { ...base, dueDates: vencimentos, amount: total, result: 'created' }
  }

  private motivoParaPular(contrato: Contract, competencia: string): string | null {
    if (contrato.lastBilledCompetence && contrato.lastBilledCompetence >= competencia) {
      return 'Competência já cobrada'
    }

    // Contrato que começa no meio da competência ainda é cobrado por ela: a
    // mensalidade é do mês, e proporcionalizar sem o combinado com o cliente
    // gera mais discussão do que resolve.
    const inicioDoContrato = contrato.startDate.slice(0, 7)
    if (!competenciaMenorOuIgual(inicioDoContrato, competencia)) {
      return 'Contrato ainda não começou'
    }

    if (contrato.endDate && !competenciaMenorOuIgual(competencia, contrato.endDate.slice(0, 7))) {
      return 'Contrato já terminou'
    }

    return null
  }

  /**
   * Vencimentos da competência.
   *
   * `billInArrears` empurra o vencimento para o mês seguinte — o modelo de quem
   * cobra o serviço depois de prestado. A competência continua sendo o mês
   * atendido, senão o relatório de agosto perderia a receita de agosto.
   */
  private vencimentosDe(contrato: Contract, competencia: string): string[] {
    const mesDoVencimento = contrato.billInArrears ? proximaCompetencia(competencia) : competencia

    const primeiro = diaDaCompetencia(mesDoVencimento, contrato.billingDay)
    if (contrato.billingCycle !== BillingCycle.BIWEEKLY) return [primeiro]

    const segundoDia = contrato.billingDay + 15
    const limite = diasNoMes(mesDoVencimento)

    // Dia 20 + 15 = 35, que não existe. A segunda cobrança cai no último dia do
    // mês em vez de vazar para o mês seguinte e bagunçar a competência.
    const segundo = diaDaCompetencia(mesDoVencimento, Math.min(segundoDia, limite))

    return segundo === primeiro ? [primeiro] : [primeiro, segundo]
  }

  private descricao(
    contrato: Contract,
    competencia: string,
    indice: number,
    total: number,
  ): string {
    const [ano, mes] = competencia.split('-')
    const referencia = `${mes}/${ano}`
    const parcela = total > 1 ? ` (${indice + 1}ª quinzena)` : ''
    return `${contrato.name} — ${referencia}${parcela}`.slice(0, 200)
  }
}

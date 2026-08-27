import { Injectable, Logger } from '@nestjs/common'
import { toCents } from '../../common/database/decimal.transformer'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import type { Shift } from '../shifts/entities/shift.entity'
import { AccountPayable, PayableCategory, PayableStatus } from './entities/account-payable.entity'
import { AccountReceivable, ReceivableStatus } from './entities/account-receivable.entity'

const FUSO = 'America/Sao_Paulo'

const DATA_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * A regra central do MNVMA (§9 do planejamento de produto).
 *
 *     PLANTÃO
 *        ├── valor cobrado    → CONTA A RECEBER
 *        └── custo do cuidador → CONTA A PAGAR
 *
 * É isso que faz a rentabilidade sair sozinha, sem ninguém digitar o mesmo
 * número duas vezes. Também é o ponto onde um erro custa caro: cobrança
 * duplicada some do radar até o cliente reclamar.
 *
 * Por isso duas travas:
 *
 * 1. **Idempotência** — o `shiftId` é único por conta nas duas tabelas. Concluir
 *    o mesmo plantão duas vezes atualiza o lançamento existente em vez de criar
 *    outro.
 * 2. **Nada de pagar a si mesmo** — na conta individual o cuidador é o próprio
 *    dono. Gerar uma "conta a pagar" para ele transformaria o lucro dele em
 *    despesa e zeraria o resultado do mês.
 */
@Injectable()
export class ShiftBillingService {
  private readonly logger = new Logger(ShiftBillingService.name)

  constructor(
    @InjectTenantRepository(AccountReceivable)
    private readonly receivables: TenantScopedRepository<AccountReceivable>,
    @InjectTenantRepository(AccountPayable)
    private readonly payables: TenantScopedRepository<AccountPayable>,
    @InjectTenantRepository(Caregiver)
    private readonly caregivers: TenantScopedRepository<Caregiver>,
  ) {}

  /** Chamado quando o plantão passa para CONCLUÍDO. */
  async aoConcluirPlantao(shift: Shift, nomeCliente: string): Promise<void> {
    const competencia = this.competenciaDe(shift.endsAt)
    const vencimento = this.dataLocal(shift.endsAt)

    await this.gerarRecebimento(shift, nomeCliente, competencia, vencimento)
    await this.gerarPagamento(shift, competencia, vencimento)
  }

  /**
   * Plantão que sai de CONCLUÍDO (estorno, correção) precisa cancelar os
   * lançamentos — deixá-los de pé faria o faturamento contar serviço que não
   * aconteceu. Cancelamos em vez de apagar: o histórico continua auditável.
   */
  async aoDesfazerConclusao(shiftId: string): Promise<void> {
    const recebimento = await this.receivables.findOne({ where: { shiftId } })
    if (recebimento && recebimento.status !== ReceivableStatus.PAID) {
      await this.receivables.updateById(recebimento.id, { status: ReceivableStatus.CANCELED })
    }

    const pagamento = await this.payables.findOne({ where: { shiftId } })
    if (pagamento && pagamento.status !== PayableStatus.PAID) {
      await this.payables.updateById(pagamento.id, { status: PayableStatus.CANCELED })
    }

    // Lançamento já pago NÃO é mexido automaticamente: dinheiro que entrou ou
    // saiu de verdade só se resolve com estorno consciente de quem opera.
    if (recebimento?.status === ReceivableStatus.PAID || pagamento?.status === PayableStatus.PAID) {
      this.logger.warn(
        { shiftId },
        'plantão saiu de concluído mas tem lançamento já pago — exige acerto manual',
      )
    }
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private async gerarRecebimento(
    shift: Shift,
    nomeCliente: string,
    competence: string,
    dueDate: string,
  ): Promise<void> {
    if (toCents(shift.chargeAmount) <= 0n) return

    const existente = await this.receivables.findOne({ where: { shiftId: shift.id } })

    if (existente) {
      // Reprocessamento: atualiza o previsto, nunca duplica. Um lançamento já
      // pago fica intocado.
      if (existente.status === ReceivableStatus.PAID) return
      await this.receivables.updateById(existente.id, {
        amount: shift.chargeAmount,
        status: ReceivableStatus.PENDING,
        dueDate,
        competence,
      })
      return
    }

    await this.receivables.createAndSave({
      customerId: shift.customerId,
      shiftId: shift.id,
      competence,
      description: `Plantão ${this.periodoLegivel(shift)} — ${nomeCliente}`,
      amount: shift.chargeAmount,
      dueDate,
      status: ReceivableStatus.PENDING,
    })
  }

  private async gerarPagamento(
    shift: Shift,
    competence: string,
    dueDate: string,
  ): Promise<void> {
    if (!shift.caregiverId || toCents(shift.caregiverCost) <= 0n) return

    const cuidador = await this.caregivers.findById(shift.caregiverId)

    // Conta individual: o cuidador é o dono. Pagar a si mesmo viraria despesa
    // fictícia e zeraria o resultado do mês.
    if (!cuidador || cuidador.isOwner) return

    const existente = await this.payables.findOne({ where: { shiftId: shift.id } })

    if (existente) {
      if (existente.status === PayableStatus.PAID) return
      await this.payables.updateById(existente.id, {
        amount: shift.caregiverCost,
        status: PayableStatus.PENDING,
        dueDate,
        competence,
      })
      return
    }

    await this.payables.createAndSave({
      caregiverId: shift.caregiverId,
      category: PayableCategory.CAREGIVER,
      shiftId: shift.id,
      competence,
      description: `Plantão ${this.periodoLegivel(shift)} — ${cuidador.name}`,
      amount: shift.caregiverCost,
      dueDate,
      status: PayableStatus.PENDING,
    })
  }

  /** Competência é o mês do TÉRMINO: plantão 30/09→01/10 fecha em outubro. */
  private competenciaDe(data: Date): string {
    return this.dataLocal(data).slice(0, 7)
  }

  private dataLocal(data: Date): string {
    return DATA_LOCAL.format(data)
  }

  private periodoLegivel(shift: Shift): string {
    const hora = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO,
      hour: '2-digit',
      minute: '2-digit',
    })
    const dia = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO,
      day: '2-digit',
      month: '2-digit',
    })
    return `${dia.format(shift.startsAt)} ${hora.format(shift.startsAt)}–${hora.format(shift.endsAt)}`
  }
}

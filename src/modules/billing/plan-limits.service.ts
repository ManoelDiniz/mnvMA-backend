import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, type EntityManager } from 'typeorm'
import { Plan } from './entities/plan.entity'

/** O que o plano limita. A chave é o mesmo nome usado no `Plan`. */
export type RecursoLimitado = 'customers' | 'caregivers' | 'users' | 'shiftsPerMonth'

export interface UsoAtual {
  customers: number
  caregivers: number
  users: number
  shiftsPerMonth: number
}

export interface LimiteExcedido {
  recurso: RecursoLimitado
  usado: number
  limite: number
}

const ROTULOS: Record<RecursoLimitado, string> = {
  customers: 'clientes',
  caregivers: 'cuidadores',
  users: 'usuários',
  shiftsPerMonth: 'plantões neste mês',
}

/**
 * Conta o que a conta já usa e compara com o que o plano permite.
 *
 * Existe separado do BillingService porque três lugares muito diferentes fazem
 * a mesma pergunta: a tela de planos (para desabilitar o downgrade que não
 * cabe), o PlanLimitGuard (para devolver 402 antes de gravar) e o MNVMA Core.
 *
 * A contagem é SQL cru e agregado: são quatro `COUNT` numa consulta só, contra
 * índices que já existem por `tenant_id`. Carregar as entidades para contar em
 * memória seria caro justamente na conta grande, que é onde o limite importa.
 */
@Injectable()
export class PlanLimitsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async uso(tenantId: string, manager?: EntityManager): Promise<UsoAtual> {
    const executor = manager ?? this.dataSource
    const inicioDoMes = primeiroDiaDoMesUtc()

    const [linha] = await executor.query<
      Array<{ customers: string; caregivers: string; users: string; shifts: string }>
    >(
      `SELECT
         (SELECT COUNT(*) FROM customers  WHERE tenant_id = ? AND deleted_at IS NULL) AS customers,
         (SELECT COUNT(*) FROM caregivers WHERE tenant_id = ? AND deleted_at IS NULL) AS caregivers,
         (SELECT COUNT(*) FROM users      WHERE tenant_id = ? AND deleted_at IS NULL AND is_active = 1) AS users,
         (SELECT COUNT(*) FROM shifts     WHERE tenant_id = ? AND deleted_at IS NULL AND starts_at >= ?) AS shifts`,
      [tenantId, tenantId, tenantId, tenantId, inicioDoMes],
    )

    return {
      customers: Number(linha?.customers ?? 0),
      caregivers: Number(linha?.caregivers ?? 0),
      users: Number(linha?.users ?? 0),
      shiftsPerMonth: Number(linha?.shifts ?? 0),
    }
  }

  /**
   * O que impede este plano de ser usado agora. Lista vazia = cabe.
   *
   * Serve para o downgrade: uma empresa com 40 cuidadores não pode cair no
   * plano de 10, e descobrir isso depois de cobrar seria pior — o certo é a
   * tela já mostrar por que a opção está fechada.
   */
  naoCabe(plano: Plan, uso: UsoAtual): LimiteExcedido[] {
    const conferencias: Array<[RecursoLimitado, number | null | undefined, number]> = [
      ['customers', plano.maxCustomers, uso.customers],
      ['caregivers', plano.maxCaregivers, uso.caregivers],
      ['users', plano.maxUsers, uso.users],
      ['shiftsPerMonth', plano.maxShiftsPerMonth, uso.shiftsPerMonth],
    ]

    return conferencias
      .filter(([, limite, usado]) => limite !== null && limite !== undefined && usado > limite)
      .map(([recurso, limite, usado]) => ({ recurso, usado, limite: limite as number }))
  }

  /** Frase pronta para a tela: "40 cuidadores — o plano permite 10". */
  explicar(excedidos: LimiteExcedido[]): string | null {
    if (excedidos.length === 0) return null
    return excedidos
      .map((e) => `${e.usado} ${ROTULOS[e.recurso]} — o plano permite ${e.limite}`)
      .join('; ')
  }

  /**
   * Ainda cabe mais um deste recurso? É o que o PlanLimitGuard pergunta antes
   * de deixar criar.
   */
  cabeMaisUm(plano: Plan | null | undefined, recurso: RecursoLimitado, uso: UsoAtual): boolean {
    if (!plano) return true
    const limite = limiteDe(plano, recurso)
    if (limite === null) return true
    return uso[recurso] < limite
  }

  rotulo(recurso: RecursoLimitado): string {
    return ROTULOS[recurso]
  }
}

export function limiteDe(plano: Plan, recurso: RecursoLimitado): number | null {
  const mapa: Record<RecursoLimitado, number | null | undefined> = {
    customers: plano.maxCustomers,
    caregivers: plano.maxCaregivers,
    users: plano.maxUsers,
    shiftsPerMonth: plano.maxShiftsPerMonth,
  }
  return mapa[recurso] ?? null
}

/**
 * Começo do mês em UTC, no formato que o MySQL aceita como parâmetro.
 *
 * O limite é "plantões por mês" no calendário do cliente, mas a diferença de
 * três horas só desloca a virada da meia-noite — e cobrar o limite pelo mês de
 * Brasília exigiria converter fuso por tenant para ganhar quase nada. Se um dia
 * o produto tiver conta fora do Brasil, este é o ponto a revisitar.
 */
function primeiroDiaDoMesUtc(agora = new Date()): string {
  const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1))
  return inicio.toISOString().slice(0, 19).replace('T', ' ')
}

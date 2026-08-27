import { Injectable, Logger } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import { SubscriptionStatus, TenantStatus } from '../../common/enums/tenant.enum'
import { TenantStatusCache } from '../../common/services/tenant-status.cache'
import { Tenant } from '../tenants/entities/tenant.entity'
import { Subscription } from './entities/subscription.entity'
import type { MpPreapprovalStatus } from './mercadopago/mercadopago.types'

/**
 * Tradução dos estados do Mercado Pago para os do MNVMA.
 *
 * `pending` não aparece aqui de propósito: assinatura criada e ainda não
 * autorizada não muda nada: a conta segue no trial (ou no estado em que
 * estava) até o pagamento passar. Tratar `pending` como estado do produto
 * liberaria o painel para quem só abriu o checkout e desistiu.
 */
const MP_PARA_MNVMA: Partial<Record<MpPreapprovalStatus, SubscriptionStatus>> = {
  authorized: SubscriptionStatus.ACTIVE,
  paused: SubscriptionStatus.PAST_DUE,
  cancelled: SubscriptionStatus.CANCELED,
}

export function traduzirStatusDoProvedor(status: string | undefined): SubscriptionStatus | null {
  if (!status) return null
  return MP_PARA_MNVMA[status as MpPreapprovalStatus] ?? null
}

/**
 * Quem decide o que a conta pode fazer.
 *
 * A assinatura é o fato comercial; o `tenant.status` é o que o painel lê a cada
 * requisição. Manter os dois em sincronia é responsabilidade de um lugar só —
 * este — porque é fácil demais um caminho novo (webhook, job, Super Admin)
 * mudar a assinatura e esquecer da conta, e o sintoma disso é cliente pagando
 * sem conseguir escrever.
 */
@Injectable()
export class SubscriptionStatusService {
  private readonly logger = new Logger(SubscriptionStatusService.name)

  constructor(private readonly statusCache: TenantStatusCache) {}

  /**
   * Aplica na conta o estado que a assinatura descreve.
   *
   * Roda dentro de um SystemScope (webhook e job atravessam contas), por isso
   * recebe o `manager` de quem chamou em vez de abrir transação própria.
   */
  async sincronizarConta(manager: EntityManager, assinatura: Subscription): Promise<TenantStatus> {
    const conta = await manager
      .getRepository(Tenant)
      .findOneOrFail({ where: { id: assinatura.tenantId } })

    const novo = this.statusDaConta(assinatura, conta.status)

    if (novo !== conta.status) {
      await manager.getRepository(Tenant).update(conta.id, { status: novo })
      this.logger.log(
        { tenantId: conta.id, de: conta.status, para: novo, assinatura: assinatura.status },
        'status da conta atualizado pela assinatura',
      )
    }

    // Sempre invalida, mesmo sem mudança de status: quem acabou de pagar não
    // pode esperar os 30 s do cache para voltar a escrever.
    this.statusCache.invalidate(conta.id)
    return novo
  }

  /**
   * A regra em si, separada para poder ser testada sem banco.
   *
   * `atual` entra na conta porque dois estados diferentes do produto compartilham
   * a mesma assinatura suspensa: teste que acabou (`EXPIRED`) e pagamento que
   * falhou (`SUSPENDED`). Escrever "suspenso por falta de pagamento" para quem
   * nunca chegou a pagar é confuso e injusto.
   */
  statusDaConta(assinatura: Subscription, atual: TenantStatus): TenantStatus {
    switch (assinatura.status) {
      case SubscriptionStatus.ACTIVE:
        return TenantStatus.ACTIVE

      case SubscriptionStatus.TRIAL:
        // Trial que já venceu não volta a ser trial só porque a assinatura
        // ainda não saiu de TRIAL — quem manda aí é o job de fim de teste.
        return atual === TenantStatus.EXPIRED ? TenantStatus.EXPIRED : TenantStatus.TRIAL

      case SubscriptionStatus.PAST_DUE:
        return TenantStatus.PAST_DUE

      case SubscriptionStatus.SUSPENDED:
        return atual === TenantStatus.EXPIRED ? TenantStatus.EXPIRED : TenantStatus.SUSPENDED

      case SubscriptionStatus.CANCELED:
        // Cancelou no dia 3 tendo pago até o dia 30: usa até o dia 30. O
        // job de sincronização vira para CANCELED quando o período acabar.
        return periodoAindaVale(assinatura) ? TenantStatus.ACTIVE : TenantStatus.CANCELED

      default:
        return atual
    }
  }
}

export function periodoAindaVale(assinatura: Subscription, agora = new Date()): boolean {
  return Boolean(assinatura.currentPeriodEnd && assinatura.currentPeriodEnd > agora)
}

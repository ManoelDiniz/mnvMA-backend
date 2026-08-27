import { Column, Entity, Index } from 'typeorm'
import { BaseEntity } from '../../../common/entities/base.entity'

/**
 * Uma notificação recebida de um provedor de pagamento, gravada antes de ser
 * processada.
 *
 * Três razões para a tabela existir, e não simplesmente processar o POST:
 *
 *   1. **Idempotência.** O Mercado Pago reenvia a notificação quando o 200
 *      demora. A chave única `(provider, eventId, type)` faz o reenvio colidir
 *      em vez de duplicar período de assinatura.
 *   2. **Responder rápido.** O processamento acontece fora do request; o
 *      webhook grava, devolve 200 e sai. Timeout no provedor vira reenvio, e
 *      reenvio somado a processamento lento vira cobrança duplicada.
 *   3. **Reprocessar sem depender de ninguém.** Se o processamento falhar, o
 *      evento continua aqui — o job de reconciliação tenta de novo.
 *
 * Sem `tenant_id`: quando o evento chega, ainda não se sabe de quem ele é. O
 * tenant sai do `external_reference` durante o processamento e é copiado para
 * `tenantId` só para facilitar a conferência manual.
 */
@Entity('webhook_events')
@Index('uq_webhook_events_evento', ['provider', 'eventId', 'type'], { unique: true })
export class WebhookEvent extends BaseEntity {
  @Column({ length: 30, default: 'mercadopago' })
  provider: string

  /** Id do recurso no provedor (`data.id`) — não é id de notificação. */
  @Column({ length: 120 })
  eventId: string

  /** `subscription_preapproval`, `subscription_authorized_payment`, `payment`… */
  @Column({ length: 60 })
  type: string

  @Column({ type: 'varchar', length: 60, nullable: true })
  action?: string | null

  @Column({ type: 'json', nullable: true })
  payload?: Record<string, unknown> | null

  /**
   * Assinatura HMAC conferida. Evento com `false` é gravado (serve de rastro de
   * quem tentou) e nunca processado.
   */
  @Column({ default: false })
  signatureOk: boolean

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  receivedAt: Date

  @Column({ type: 'datetime', precision: 6, nullable: true })
  processedAt?: Date | null

  @Column({ type: 'int', default: 0 })
  attempts: number

  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError?: string | null

  @Column({ type: 'varchar', length: 36, nullable: true })
  tenantId?: string | null

  /**
   * Chegou um evento cuja assinatura não existe no MNVMA. Não pode ser
   * descartado em silêncio: ou é cobrança de alguém que não estamos creditando,
   * ou é sinal de que apagamos algo que não devíamos.
   */
  @Column({ default: false })
  orphan: boolean
}

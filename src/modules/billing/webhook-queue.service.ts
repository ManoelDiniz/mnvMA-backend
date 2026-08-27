import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common'

/**
 * Fila em processo para o que precisa acontecer DEPOIS de responder 200.
 *
 * O webhook do Mercado Pago tem que ser respondido em menos de meio segundo:
 * se o 200 demora, o provedor reenvia, e reenvio somado a processamento lento é
 * como se duplica período de assinatura. Então a rota grava o evento, empurra
 * o processamento para cá e devolve.
 *
 * Não é BullMQ de propósito. Uma fila com Redis dá retentativa com backoff,
 * paralelismo e visibilidade — e cobra por isso um serviço a mais para pagar,
 * monitorar e restaurar. O que o billing precisa hoje é mais modesto:
 * processar fora do request e não perder nada. O "não perder" já está resolvido
 * no banco: o evento fica em `webhook_events` com `processed_at` nulo, e o job
 * de reconciliação varre o que ficou para trás — inclusive o que morreu com o
 * processo. Redis entra quando houver trabalho que precise de paralelismo real.
 *
 * `ocioso()` existe para duas coisas: encerrar o processo sem cortar
 * processamento no meio, e permitir que o teste e2e espere o efeito sem
 * `sleep`.
 */
@Injectable()
export class WebhookQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(WebhookQueue.name)
  private pendentes = new Set<Promise<void>>()

  /** Enfileira sem bloquear quem chamou. Erro aqui nunca sobe para o request. */
  enfileirar(rotulo: string, tarefa: () => Promise<void>): void {
    const execucao = (async () => {
      try {
        await tarefa()
      } catch (error) {
        // Engolir é correto: o evento continua em `webhook_events` com
        // `processed_at` nulo, e o job de reconciliação tenta de novo.
        this.logger.error({ rotulo, err: error }, 'falha ao processar evento em segundo plano')
      }
    })()

    this.pendentes.add(execucao)
    void execucao.finally(() => this.pendentes.delete(execucao))
  }

  /** Resolve quando não há mais nada em andamento. */
  async ocioso(): Promise<void> {
    while (this.pendentes.size > 0) {
      await Promise.all([...this.pendentes])
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.pendentes.size === 0) return
    this.logger.log({ pendentes: this.pendentes.size }, 'aguardando eventos em andamento')
    await this.ocioso()
  }
}

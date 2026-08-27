import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import { ApiExcludeEndpoint } from '@nestjs/swagger'
import type { Request } from 'express'
import { Public } from '../../common/decorators'
import type { Env } from '../../config/env'
import { EXPLICACAO, verificarAssinatura } from './mercadopago/mercadopago.signature'
import type { MpNotification } from './mercadopago/mercadopago.types'
import { WebhookProcessorService } from './webhook-processor.service'
import { WebhookQueue } from './webhook-queue.service'

/**
 * A porta de entrada do provedor de pagamento.
 *
 * É a única rota pública que muda dinheiro de lugar, e por isso ela faz quatro
 * coisas nesta ordem, sem exceção:
 *
 *   1. **Confere a assinatura HMAC.** Sem isso, quem descobrir a URL faz um
 *      POST dizendo "assinatura autorizada" e usa o produto de graça. Payload
 *      não verificado é gravado como rastro e nunca processado.
 *   2. **Grava antes de processar.** O evento vira linha em `webhook_events`,
 *      e a chave única `(provider, event_id, type)` transforma o reenvio do
 *      provedor em duplicata reconhecida em vez de período duplicado.
 *   3. **Responde 200 imediatamente.** Demorar faz o provedor reenviar.
 *   4. **Processa fora do request.** Na fila em processo, com o job de
 *      reconciliação como rede embaixo.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name)

  constructor(
    private readonly processor: WebhookProcessorService,
    private readonly fila: WebhookQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('mercadopago')
  @HttpCode(HttpStatus.OK)
  // O limite padrão é por usuário e cai no IP nas rotas públicas. O Mercado
  // Pago vem todo do mesmo punhado de IPs e pode encavalar reenvios; recusar
  // uma notificação por excesso de tráfego custaria uma ativação atrasada.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiExcludeEndpoint()
  async mercadopago(
    @Req() req: Request,
    @Body() body: MpNotification,
    @Query() query: Record<string, string>,
  ): Promise<{ received: boolean }> {
    const tipo = body.type ?? body.topic ?? query.type ?? query.topic
    const recurso = String(body.data?.id ?? query['data.id'] ?? query.id ?? body.id ?? '')

    if (!tipo || !recurso) {
      // Ping de configuração do painel do provedor cai aqui. 200 para não
      // deixar a URL marcada como quebrada na conta do Mercado Pago.
      this.logger.warn({ query }, 'notificação sem tipo ou sem recurso — ignorada')
      return { received: true }
    }

    const assinatura = verificarAssinatura({
      signature: cabecalho(req, 'x-signature'),
      requestId: cabecalho(req, 'x-request-id'),
      // O manifesto usa o `data.id` da querystring; o corpo entra só como
      // reserva para as notificações antigas, que não trazem query.
      dataId: query['data.id'] ?? query.id ?? recurso,
      secret: this.config.get('MP_WEBHOOK_SECRET', { infer: true }),
    })

    const valido = assinatura.ok || this.liberadoSemSegredo(assinatura.motivo)

    const { evento, duplicado } = await this.processor.registrar({
      provider: 'mercadopago',
      eventId: recurso,
      type: tipo,
      action: body.action ?? null,
      payload: body as unknown as Record<string, unknown>,
      signatureOk: valido,
    })

    if (!valido) {
      this.logger.error(
        { tipo, recurso, motivo: EXPLICACAO[assinatura.motivo] },
        'webhook com assinatura inválida — registrado e recusado',
      )
      throw new UnauthorizedException({
        code: 'ASSINATURA_INVALIDA',
        message: 'Assinatura da notificação não confere.',
      })
    }

    if (duplicado && evento.processedAt) return { received: true }

    this.fila.enfileirar(`mp:${tipo}:${recurso}`, () => this.processor.processar(evento.id))

    return { received: true }
  }

  /**
   * Sem `MP_WEBHOOK_SECRET` não há o que conferir. Em produção isso é recusa —
   * e a validação de ambiente nem deixa a API subir assim quando a cobrança
   * está ligada. Fora de produção, liberar é o que permite testar o fluxo
   * inteiro com `ngrok` e rodar a suíte e2e sem conta em provedor nenhum.
   */
  private liberadoSemSegredo(motivo: string): boolean {
    if (motivo !== 'sem-segredo') return false

    const ambiente = this.config.get('NODE_ENV', { infer: true })
    if (ambiente === 'production' || ambiente === 'staging') return false

    this.logger.warn(
      'MP_WEBHOOK_SECRET não configurado: notificação aceita sem conferir assinatura. ' +
        'Isto só vale fora de produção.',
    )
    return true
  }
}

function cabecalho(req: Request, nome: string): string | undefined {
  const valor = req.headers[nome]
  return Array.isArray(valor) ? valor[0] : valor
}

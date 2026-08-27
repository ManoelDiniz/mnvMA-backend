import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../../../config/env'
import type {
  MpAuthorizedPayment,
  MpPayment,
  MpPreapproval,
  MpPreapprovalPlan,
} from './mercadopago.types'

const BASE_URL = 'https://api.mercadopago.com'
const TIMEOUT_MS = 10_000
const TENTATIVAS = 3

/** Erro do provedor com o status HTTP preservado, para quem chama decidir. */
export class MercadoPagoError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(`Mercado Pago respondeu ${status} em ${path}: ${body.slice(0, 300)}`)
    this.name = 'MercadoPagoError'
  }
}

/**
 * Cliente fino da API do Mercado Pago.
 *
 * `fetch` direto em vez do SDK oficial, de propósito: o SDK muda de assinatura
 * entre versões maiores e esconde o que foi enviado justamente quando o
 * pagamento falha e é preciso saber. Aqui cabe numa tela e faz quatro coisas
 * que o SDK não garante do jeito que este projeto precisa — timeout,
 * `Idempotency-Key` em todo POST, retentativa só no que é seguro repetir, e log
 * de tudo sem nunca imprimir o token.
 *
 * Sem `MP_ACCESS_TOKEN` o cliente fica desligado: em desenvolvimento ninguém
 * precisa de conta no provedor para subir a API, e qualquer rota que dependa
 * dele responde 503 com uma mensagem que diz o que configurar.
 */
@Injectable()
export class MercadoPagoClient {
  private readonly logger = new Logger(MercadoPagoClient.name)
  private readonly token: string | undefined

  constructor(private readonly config: ConfigService<Env, true>) {
    this.token = config.get('MP_ACCESS_TOKEN', { infer: true })
  }

  get enabled(): boolean {
    return Boolean(this.token)
  }

  /** URL para onde o pagador volta depois do checkout. */
  get backUrl(): string {
    const configurada = this.config.get('MP_BACK_URL', { infer: true })
    if (configurada) return configurada
    const app = this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '')
    return `${app}/assinatura/retorno`
  }

  /** URL que o provedor chama quando algo muda. */
  get notificationUrl(): string | undefined {
    const configurada = this.config.get('MP_NOTIFICATION_URL', { infer: true })
    if (configurada) return configurada
    const api = this.config.get('API_URL', { infer: true }).replace(/\/+$/, '')
    return `${api}/v1/webhooks/mercadopago`
  }

  // ─── Recursos ───────────────────────────────────────────────────────────────

  criarPreapproval(body: Record<string, unknown>, idempotencyKey: string): Promise<MpPreapproval> {
    return this.request<MpPreapproval>('POST', '/preapproval', { body, idempotencyKey })
  }

  buscarPreapproval(id: string): Promise<MpPreapproval> {
    return this.request<MpPreapproval>('GET', `/preapproval/${encodeURIComponent(id)}`)
  }

  atualizarPreapproval(id: string, body: Record<string, unknown>): Promise<MpPreapproval> {
    return this.request<MpPreapproval>('PUT', `/preapproval/${encodeURIComponent(id)}`, { body })
  }

  criarPreapprovalPlan(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<MpPreapprovalPlan> {
    return this.request<MpPreapprovalPlan>('POST', '/preapproval_plan', { body, idempotencyKey })
  }

  buscarPreapprovalPlan(id: string): Promise<MpPreapprovalPlan> {
    return this.request<MpPreapprovalPlan>('GET', `/preapproval_plan/${encodeURIComponent(id)}`)
  }

  buscarAuthorizedPayment(id: string): Promise<MpAuthorizedPayment> {
    return this.request<MpAuthorizedPayment>(
      'GET',
      `/authorized_payments/${encodeURIComponent(id)}`,
    )
  }

  buscarPayment(id: string): Promise<MpPayment> {
    return this.request<MpPayment>('GET', `/v1/payments/${encodeURIComponent(id)}`)
  }

  // ─── Transporte ─────────────────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options: { body?: Record<string, unknown>; idempotencyKey?: string } = {},
  ): Promise<T> {
    if (!this.token) {
      throw new ServiceUnavailableException({
        code: 'BILLING_NAO_CONFIGURADO',
        message:
          'A cobrança não está configurada neste ambiente. Defina MP_ACCESS_TOKEN para habilitar a assinatura.',
      })
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    }
    // Só faz sentido em POST: é o único verbo aqui que cria recurso, e é o que
    // não pode ser repetido às cegas depois de um timeout.
    if (options.idempotencyKey) headers['X-Idempotency-Key'] = options.idempotencyKey

    let ultimoErro: unknown

    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
      const inicio = Date.now()

      try {
        const resposta = await fetch(`${BASE_URL}${path}`, {
          method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })

        const texto = await resposta.text()
        const ms = Date.now() - inicio

        if (resposta.ok) {
          this.logger.log({ method, path, status: resposta.status, ms }, 'mercado pago ok')
          return (texto ? JSON.parse(texto) : {}) as T
        }

        const erro = new MercadoPagoError(resposta.status, texto, path)

        // 4xx é problema do pedido: repetir devolve o mesmo erro. 429 e 5xx
        // são do outro lado e costumam passar na segunda tentativa.
        if (!repetivel(resposta.status) || tentativa === TENTATIVAS) {
          this.logger.warn({ method, path, status: resposta.status, ms }, 'mercado pago recusou')
          throw erro
        }

        ultimoErro = erro
        this.logger.warn(
          { method, path, status: resposta.status, tentativa },
          'mercado pago instável — tentando de novo',
        )
      } catch (error) {
        if (error instanceof MercadoPagoError) throw error

        // Timeout ou rede. Em POST isto é exatamente o caso em que o
        // `Idempotency-Key` salva: a requisição pode ter chegado.
        ultimoErro = error
        if (tentativa === TENTATIVAS) break
        this.logger.warn({ method, path, tentativa, err: mensagem(error) }, 'falha de rede no MP')
      }

      await espera(250 * 2 ** (tentativa - 1))
    }

    throw new ServiceUnavailableException({
      code: 'BILLING_PROVEDOR_INDISPONIVEL',
      message:
        'Não conseguimos falar com o Mercado Pago agora. Tente de novo em alguns minutos — nada foi cobrado.',
      detail: mensagem(ultimoErro),
    })
  }
}

function repetivel(status: number): boolean {
  return status === 429 || status >= 500
}

function espera(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function mensagem(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

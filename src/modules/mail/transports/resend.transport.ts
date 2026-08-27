import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../../../config/env'
import type { MailMessage, MailTransport } from '../mail.types'

const ENDPOINT = 'https://api.resend.com/emails'

/**
 * Envio pela API HTTP do Resend.
 *
 * Sem SDK de propósito: é um POST com JSON, e o `fetch` do Node 20 dá conta.
 * Uma dependência a menos é uma superfície a menos para atualizar e auditar.
 */
@Injectable()
export class ResendMailTransport implements MailTransport {
  readonly name = 'resend'

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(message: MailMessage): Promise<void> {
    const apiKey = this.config.get('RESEND_API_KEY', { infer: true })
    if (!apiKey) throw new Error('RESEND_API_KEY ausente')

    const replyTo = this.config.get('MAIL_REPLY_TO', { infer: true })

    // Provedor fora do ar não pode segurar o request do usuário indefinidamente.
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.get('MAIL_FROM', { infer: true }),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(message.tag ? { tags: [{ name: 'tipo', value: message.tag }] } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const corpo = await response.text().catch(() => '')
      throw new Error(`Resend respondeu ${response.status}: ${corpo.slice(0, 300)}`)
    }
  }
}

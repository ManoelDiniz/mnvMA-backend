import { Inject, Injectable, Logger } from '@nestjs/common'
import { MAIL_TRANSPORT, type MailMessage, type MailResult, type MailTransport } from './mail.types'
import type { Conteudo } from './templates'

/**
 * Porta única de saída de e-mail.
 *
 * Duas garantias que o resto da aplicação depende:
 *
 *   1. **Não lança.** E-mail é efeito colateral. Um convite gravado com
 *      sucesso não pode virar erro 500 porque o provedor piscou — quem chama
 *      recebe `delivered: false` e decide (o convite, por exemplo, devolve o
 *      link para mandar pelo WhatsApp).
 *   2. **Não bloqueia para sempre.** O transporte tem timeout próprio; aqui
 *      só se registra o que aconteceu.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)

  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport) {}

  async send(to: string, conteudo: Conteudo): Promise<MailResult> {
    const message: MailMessage = { to, ...conteudo }

    try {
      await this.transport.send(message)
      this.logger.log({ to, tag: message.tag, transport: this.transport.name }, 'e-mail enviado')
      return { delivered: true, transport: this.transport.name }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error)
      // `warn`, não `error`: falha de entrega é operacional e esperada. O que
      // seria erro é a aplicação parar por causa dela.
      this.logger.warn(
        { to, tag: message.tag, transport: this.transport.name, err: motivo },
        'falha ao enviar e-mail',
      )
      return { delivered: false, transport: this.transport.name, error: motivo }
    }
  }

  /**
   * Envia para vários destinatários, um a um. Um endereço que falha não impede
   * os outros — o digest de documentos vencendo vai para toda a administração
   * da conta, e um e-mail antigo na lista não pode calar os demais.
   */
  async sendMany(destinatarios: string[], conteudo: Conteudo): Promise<MailResult[]> {
    const resultados: MailResult[] = []
    for (const to of destinatarios) {
      resultados.push(await this.send(to, conteudo))
    }
    return resultados
  }
}

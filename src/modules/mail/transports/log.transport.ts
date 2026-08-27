import { Injectable, Logger } from '@nestjs/common'
import type { MailMessage, MailTransport } from '../mail.types'

/** Quantas mensagens a caixa de saída em memória guarda. */
const LIMITE_DA_CAIXA = 50

/**
 * Transporte de desenvolvimento e de teste: nada sai da máquina.
 *
 * Imprime destinatário, assunto e — o que importa de verdade — os links da
 * mensagem, para que dê para aceitar um convite ou redefinir uma senha em
 * desenvolvimento sem nenhuma conta em provedor de e-mail.
 *
 * Guarda também as últimas mensagens em memória. É o que permite o teste e2e
 * exercer o fluxo de senha inteiro: o token só existe em texto claro dentro do
 * e-mail — o banco tem apenas o hash —, então sem esta caixa de saída o teste
 * teria de furar a abstração para conseguir o link.
 */
@Injectable()
export class LogMailTransport implements MailTransport {
  readonly name = 'log'

  private readonly logger = new Logger('Mail')
  private readonly caixa: MailMessage[] = []

  send(message: MailMessage): Promise<void> {
    this.logger.log(
      {
        to: message.to,
        subject: message.subject,
        tag: message.tag,
        links: extrairLinks(message.text),
      },
      `e-mail (não enviado — transporte "log"): ${message.subject}`,
    )

    this.caixa.push(message)
    if (this.caixa.length > LIMITE_DA_CAIXA) this.caixa.shift()

    return Promise.resolve()
  }

  /** Últimas mensagens, da mais antiga para a mais recente. */
  get enviados(): readonly MailMessage[] {
    return this.caixa
  }

  /** Última mensagem para um destinatário, opcionalmente filtrando pela tag. */
  ultimoPara(email: string, tag?: string): MailMessage | undefined {
    return [...this.caixa]
      .reverse()
      .find((m) => m.to === email && (tag === undefined || m.tag === tag))
  }

  /** Links de uma mensagem, na ordem em que aparecem. */
  static linksDe(message: MailMessage): string[] {
    return extrairLinks(message.text)
  }

  limpar(): void {
    this.caixa.length = 0
  }
}

function extrairLinks(texto: string): string[] {
  return [...texto.matchAll(/https?:\/\/\S+/g)].map((m) => m[0])
}

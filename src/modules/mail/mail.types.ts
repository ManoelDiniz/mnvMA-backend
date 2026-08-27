/**
 * Contrato de envio de e-mail.
 *
 * Toda mensagem carrega `text` além do `html`: cliente de e-mail antigo, leitor
 * de tela e filtro de spam leem a versão em texto, e um convite que chega em
 * branco é um usuário que nunca entra na conta.
 */
export interface MailMessage {
  to: string
  subject: string
  html: string
  text: string
  /** Marcador para agrupar métricas de entrega por tipo de mensagem. */
  tag?: string
}

export interface MailTransport {
  readonly name: string
  send(message: MailMessage): Promise<void>
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT')

/**
 * Resultado do envio. Nunca é exceção: e-mail é efeito colateral, e derrubar o
 * cadastro de um cuidador porque o provedor de e-mail piscou seria trocar um
 * problema pequeno por um grande. Quem chama decide o que fazer com
 * `delivered: false` — o convite, por exemplo, ainda devolve o link para copiar
 * e mandar pelo WhatsApp.
 */
export interface MailResult {
  delivered: boolean
  transport: string
  error?: string
}

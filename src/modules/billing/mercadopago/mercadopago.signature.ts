import { createHmac, timingSafeEqual } from 'node:crypto'

/** Tolerância de relógio entre o provedor e a nossa máquina. */
const JANELA_SEGUNDOS = 300

export type MotivoAssinatura =
  | 'ok'
  | 'sem-segredo'
  | 'sem-cabecalho'
  | 'formato-invalido'
  | 'expirada'
  | 'nao-confere'

export interface ResultadoAssinatura {
  ok: boolean
  motivo: MotivoAssinatura
}

export interface EntradaAssinatura {
  /** Conteúdo do header `x-signature`: `ts=1699...,v1=abc...`. */
  signature?: string
  /** Header `x-request-id`, que entra no manifesto. */
  requestId?: string
  /** `data.id` da querystring — ou `id`, dependendo do tipo de notificação. */
  dataId?: string
  secret?: string
  agora?: Date
}

/**
 * Confere a assinatura HMAC-SHA256 que o Mercado Pago manda em `x-signature`.
 *
 * Esta função é a fechadura da porta. O webhook é uma rota pública sem JWT: sem
 * a conferência, qualquer pessoa que descubra a URL faz um POST dizendo "a
 * assinatura tal foi autorizada" e usa o produto de graça para sempre.
 *
 * O manifesto é montado exatamente como o provedor documenta —
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — e comparado em tempo
 * constante. A janela de 5 minutos existe contra replay: capturar uma
 * notificação válida e reenviá-la amanhã não deve valer nada.
 */
export function verificarAssinatura(entrada: EntradaAssinatura): ResultadoAssinatura {
  const { signature, requestId = '', dataId = '', secret } = entrada

  if (!secret) return { ok: false, motivo: 'sem-segredo' }
  if (!signature) return { ok: false, motivo: 'sem-cabecalho' }

  const partes = new Map<string, string>()
  for (const pedaco of signature.split(',')) {
    const [chave, ...resto] = pedaco.split('=')
    if (chave && resto.length > 0) partes.set(chave.trim(), resto.join('=').trim())
  }

  const ts = partes.get('ts')
  const v1 = partes.get('v1')
  if (!ts || !v1) return { ok: false, motivo: 'formato-invalido' }

  const enviadoEm = Number(ts)
  if (!Number.isFinite(enviadoEm)) return { ok: false, motivo: 'formato-invalido' }

  const agora = (entrada.agora ?? new Date()).getTime() / 1000
  // `ts` vem em segundos, mas já apareceu em milissegundos em ambiente de
  // teste do provedor. Normalizar evita rejeitar notificação legítima.
  const segundos = enviadoEm > 1e11 ? enviadoEm / 1000 : enviadoEm
  if (Math.abs(agora - segundos) > JANELA_SEGUNDOS) return { ok: false, motivo: 'expirada' }

  const manifesto = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`
  const esperado = createHmac('sha256', secret).update(manifesto).digest('hex')

  const confere = comparar(esperado, v1)
  return { ok: confere, motivo: confere ? 'ok' : 'nao-confere' }
}

/**
 * Comparação em tempo constante. `timingSafeEqual` exige buffers do mesmo
 * tamanho e lança quando não são — daí a conferência de comprimento antes,
 * que não vaza nada além do que já é público (o hash tem tamanho fixo).
 */
function comparar(esperado: string, recebido: string): boolean {
  const a = Buffer.from(esperado, 'utf8')
  const b = Buffer.from(recebido, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Descrição curta para log e para a coluna `last_error`. */
export const EXPLICACAO: Record<MotivoAssinatura, string> = {
  ok: 'assinatura conferida',
  'sem-segredo': 'MP_WEBHOOK_SECRET não configurado',
  'sem-cabecalho': 'requisição sem x-signature',
  'formato-invalido': 'x-signature fora do formato ts=…,v1=…',
  expirada: 'assinatura fora da janela de 5 minutos',
  'nao-confere': 'HMAC não confere com o manifesto',
}

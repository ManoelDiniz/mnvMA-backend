import { createHmac } from 'node:crypto'
import { verificarAssinatura } from './mercadopago.signature'

const SEGREDO = 'segredo-de-teste'

function assinar(dataId: string, requestId: string, ts: string, secret = SEGREDO): string {
  const manifesto = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`
  const v1 = createHmac('sha256', secret).update(manifesto).digest('hex')
  return `ts=${ts},v1=${v1}`
}

/**
 * O webhook é a única rota pública que mexe em dinheiro. Se esta suíte passar a
 * aceitar o que deveria recusar, qualquer pessoa com a URL ativa a própria
 * assinatura de graça — por isso os casos negativos aqui importam mais que o
 * positivo.
 */
describe('verificarAssinatura (Mercado Pago)', () => {
  const agora = new Date('2026-08-26T12:00:00Z')
  const ts = String(Math.floor(agora.getTime() / 1000))

  it('aceita a assinatura correta', () => {
    const resultado = verificarAssinatura({
      signature: assinar('123456', 'req-1', ts),
      requestId: 'req-1',
      dataId: '123456',
      secret: SEGREDO,
      agora,
    })

    expect(resultado).toEqual({ ok: true, motivo: 'ok' })
  })

  it('recusa quando o segredo é outro — é o caso do impostor', () => {
    const resultado = verificarAssinatura({
      signature: assinar('123456', 'req-1', ts, 'segredo-do-atacante'),
      requestId: 'req-1',
      dataId: '123456',
      secret: SEGREDO,
      agora,
    })

    expect(resultado).toEqual({ ok: false, motivo: 'nao-confere' })
  })

  it('recusa quando o recurso é trocado depois de assinado', () => {
    const resultado = verificarAssinatura({
      signature: assinar('123456', 'req-1', ts),
      requestId: 'req-1',
      // Assinatura legítima de outro evento, reaproveitada para este.
      dataId: '999999',
      secret: SEGREDO,
      agora,
    })

    expect(resultado.ok).toBe(false)
  })

  it('recusa notificação antiga — replay não vale', () => {
    const velho = String(Math.floor(agora.getTime() / 1000) - 3600)

    const resultado = verificarAssinatura({
      signature: assinar('123456', 'req-1', velho),
      requestId: 'req-1',
      dataId: '123456',
      secret: SEGREDO,
      agora,
    })

    expect(resultado).toEqual({ ok: false, motivo: 'expirada' })
  })

  it('aceita ts em milissegundos, que o ambiente de teste do provedor manda', () => {
    const emMs = String(agora.getTime())

    const resultado = verificarAssinatura({
      signature: assinar('123456', 'req-1', emMs),
      requestId: 'req-1',
      dataId: '123456',
      secret: SEGREDO,
      agora,
    })

    expect(resultado.ok).toBe(true)
  })

  it('trata o id sem diferenciar maiúsculas, como o provedor documenta', () => {
    const resultado = verificarAssinatura({
      signature: assinar('abcdef', 'req-1', ts),
      requestId: 'req-1',
      dataId: 'ABCDEF',
      secret: SEGREDO,
      agora,
    })

    expect(resultado.ok).toBe(true)
  })

  it('recusa sem cabeçalho e sem segredo, com motivos distintos', () => {
    expect(verificarAssinatura({ secret: SEGREDO, agora })).toEqual({
      ok: false,
      motivo: 'sem-cabecalho',
    })

    expect(verificarAssinatura({ signature: `ts=${ts},v1=abc`, agora })).toEqual({
      ok: false,
      motivo: 'sem-segredo',
    })
  })

  it('recusa cabeçalho fora do formato em vez de estourar', () => {
    for (const signature of ['', 'lixo', 'ts=', 'v1=abc', 'ts=abc,v1=def']) {
      expect(verificarAssinatura({ signature, secret: SEGREDO, agora }).ok).toBe(false)
    }
  })

  it('recusa v1 de tamanho diferente sem quebrar a comparação', () => {
    // `timingSafeEqual` lança quando os buffers têm tamanhos diferentes; a
    // conferência de comprimento antes é o que impede um 500 aqui.
    const resultado = verificarAssinatura({
      signature: `ts=${ts},v1=abc`,
      requestId: 'req-1',
      dataId: '123456',
      secret: SEGREDO,
      agora,
    })

    expect(resultado).toEqual({ ok: false, motivo: 'nao-confere' })
  })
})

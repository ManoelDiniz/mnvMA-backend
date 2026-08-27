import { passoDaCortesia } from '../jobs/billing-sync.job'
import { motivoDeBloqueio } from './coupons-admin.service'
import { CORTESIA, adicionarMeses, normalizarCodigo, precoComDesconto } from './coupons.service'
import type { Coupon } from './entities/coupon.entity'

const cupom = (dados: Partial<Coupon>): Coupon => ({ isActive: true, ...dados }) as Coupon

describe('código do cupom', () => {
  it('é o mesmo em qualquer caixa, com ou sem espaço', () => {
    // O cliente digita o que está no WhatsApp dele, do jeito que estiver.
    expect(normalizarCodigo('  bemvindo50 ')).toBe('BEMVINDO50')
    expect(normalizarCodigo('BemVindo50')).toBe('BEMVINDO50')
  })
})

describe('preço com desconto', () => {
  it('aplica o percentual em centavos inteiros', () => {
    expect(precoComDesconto(14900, 50)).toBe(7450)
    expect(precoComDesconto(4990, 10)).toBe(4491)
  })

  it('arredonda o centavo em vez de deixá-lo virar dízima', () => {
    // 33% de R$ 49,90 em ponto flutuante daria 3343.2999999999997, e o centavo
    // perdido reaparece na conciliação com o extrato do provedor.
    expect(precoComDesconto(4990, 33)).toBe(3343)
    expect(Number.isInteger(precoComDesconto(4990, 33))).toBe(true)
  })

  it('100% zera — é cortesia, não "quase de graça"', () => {
    expect(precoComDesconto(14900, CORTESIA)).toBe(0)
  })

  it('1% quase não muda nada, e continua inteiro', () => {
    expect(precoComDesconto(14900, 1)).toBe(14751)
  })
})

describe('duração da cortesia', () => {
  it('conta ciclos preservando o dia', () => {
    expect(adicionarMeses(new Date('2026-08-10T12:00:00Z'), 2).toISOString()).toBe(
      '2026-10-10T12:00:00.000Z',
    )
  })

  it('dia 31 em mês curto cai no último dia, não no mês seguinte', () => {
    expect(adicionarMeses(new Date('2026-01-31T12:00:00Z'), 1).toISOString().slice(0, 10)).toBe(
      '2026-02-28',
    )
  })
})

describe('por que o cupom não pode ser resgatado', () => {
  const agora = new Date('2026-08-26T12:00:00Z')

  it('nada bloqueia um cupom aberto e dentro da validade', () => {
    expect(motivoDeBloqueio(cupom({}), 0, agora)).toBeNull()
  })

  it('desligado, fora da janela e esgotado têm motivos distintos', () => {
    expect(motivoDeBloqueio(cupom({ isActive: false }), 0, agora)).toBe('Desligado')

    expect(
      motivoDeBloqueio(cupom({ startsAt: new Date('2026-09-01T00:00:00Z') }), 0, agora),
    ).toBe('Ainda não começou')

    expect(
      motivoDeBloqueio(cupom({ expiresAt: new Date('2026-08-01T00:00:00Z') }), 0, agora),
    ).toBe('Expirado')

    expect(motivoDeBloqueio(cupom({ maxRedemptions: 10 }), 10, agora)).toBe('Esgotado')
  })

  it('teto ainda com vaga não bloqueia', () => {
    expect(motivoDeBloqueio(cupom({ maxRedemptions: 10 }), 9, agora)).toBeNull()
  })

  it('sem teto, resgate nenhum esgota', () => {
    expect(motivoDeBloqueio(cupom({ maxRedemptions: null }), 5000, agora)).toBeNull()
  })
})

describe('régua da cortesia', () => {
  it('não avisa enquanto falta tempo', () => {
    expect(passoDaCortesia(10, 0)).toBeNull()
    expect(passoDaCortesia(4, 0)).toBeNull()
  })

  it('avisa em D-3 e de novo na véspera', () => {
    expect(passoDaCortesia(3, 0)).toEqual({ estagio: 1, acao: 'avisar' })
    expect(passoDaCortesia(1, 1)).toEqual({ estagio: 2, acao: 'avisar' })
  })

  it('não repete o aviso já dado — o job roda de hora em hora', () => {
    expect(passoDaCortesia(3, 1)).toBeNull()
    expect(passoDaCortesia(2, 1)).toBeNull()
    expect(passoDaCortesia(1, 2)).toBeNull()
  })

  it('encerra quando o prazo acaba, mesmo sem os avisos terem saído', () => {
    // Cortesia de um mês concedida hoje, job parado a semana toda: o que
    // importa é encerrar na data, não a fila de avisos atrasados.
    expect(passoDaCortesia(0, 0)).toEqual({ estagio: 3, acao: 'encerrar' })
    expect(passoDaCortesia(-5, 2)).toEqual({ estagio: 3, acao: 'encerrar' })
  })
})

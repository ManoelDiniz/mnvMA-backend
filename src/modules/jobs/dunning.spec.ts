import { chaveDaHora } from './billing-sync.job'
import { diasDesde, proximoPasso } from './dunning.job'

/**
 * A régua do dunning é a parte do produto em que errar custa cliente: avisar
 * demais ensina a ignorar, avisar de menos suspende quem nem soube. Estes
 * testes travam o desenho de `03-mercado-pago.md` §6.
 */
describe('régua do dunning', () => {
  it('não faz nada no primeiro dia — o aviso D+0 já saiu com a recusa', () => {
    expect(proximoPasso(0, 1)).toBeNull()
    expect(proximoPasso(2, 1)).toBeNull()
  })

  it('avisa no dia 3 e de novo no dia 5', () => {
    expect(proximoPasso(3, 1)).toMatchObject({ estagio: 2, acao: 'aviso' })
    expect(proximoPasso(5, 2)).toMatchObject({ estagio: 3, acao: 'aviso' })
  })

  it('suspende no dia 7 e cancela no dia 37', () => {
    expect(proximoPasso(7, 3)).toMatchObject({ estagio: 4, acao: 'suspender' })
    expect(proximoPasso(37, 4)).toMatchObject({ estagio: 5, acao: 'cancelar' })
  })

  it('não repete estágio já dado', () => {
    expect(proximoPasso(3, 2)).toBeNull()
    expect(proximoPasso(7, 4)).toBeNull()
    expect(proximoPasso(40, 5)).toBeNull()
  })

  it('conta parada por dias pula direto para o passo devido, sem enfileirar avisos', () => {
    // O job ficou uma semana sem rodar (deploy, instância parada). Ao voltar,
    // a conta recebe a suspensão devida — e não três e-mails atrasados juntos.
    expect(proximoPasso(9, 1)).toMatchObject({ estagio: 4, acao: 'suspender' })
  })

  it('conta os dias desde a primeira recusa', () => {
    const inicio = new Date('2026-08-01T10:00:00Z')
    expect(diasDesde(inicio, new Date('2026-08-01T23:00:00Z'))).toBe(0)
    expect(diasDesde(inicio, new Date('2026-08-08T10:00:00Z'))).toBe(7)
  })
})

describe('janela horária do job de reconciliação', () => {
  it('usa o fuso do produto, para bater com o histórico em job_runs', () => {
    // 02:00 UTC é 23h do dia anterior em São Paulo.
    expect(chaveDaHora(new Date('2026-08-26T02:00:00Z'))).toBe('2026-08-25T23')
    expect(chaveDaHora(new Date('2026-08-26T15:30:00Z'))).toBe('2026-08-26T12')
  })

  it('duas execuções na mesma hora colidem na mesma chave', () => {
    expect(chaveDaHora(new Date('2026-08-26T15:01:00Z'))).toBe(
      chaveDaHora(new Date('2026-08-26T15:59:00Z')),
    )
  })
})

import {
  conviteDeEquipe,
  documentosVencendo,
  redefinicaoDeSenha,
  trialTerminando,
} from './index'
import { UserRole } from '../../../common/enums/user-role.enum'

describe('templates de e-mail', () => {
  const url = 'https://app.mnvma.com.br/convite/abc123'

  it('escapa o que veio do banco: nome com HTML não vira marcação', () => {
    const { html } = conviteDeEquipe({
      nome: '<script>alert(1)</script>',
      conta: 'Cuidar & Bem',
      papel: UserRole.COORDINATOR,
      convidadoPor: 'Sirlene "Chefa"',
      url,
      expiraEm: new Date('2026-09-02T12:00:00Z'),
    })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Cuidar &amp; Bem')
    expect(html).toContain('Sirlene &quot;Chefa&quot;')
  })

  it('a versão em texto carrega o link — é ela que o cliente antigo mostra', () => {
    const { text, html } = redefinicaoDeSenha({
      nome: 'Marcos',
      url,
      expiraEm: new Date('2026-08-26T15:00:00Z'),
    })

    expect(text).toContain(url)
    expect(html).toContain(url)
    // Texto puro não pode sair com marcação nem com entidade HTML dentro.
    expect(text).not.toMatch(/<[a-z/]/i)
    expect(text).not.toContain('&amp;')
  })

  it('o papel aparece no rótulo em português, não no valor do enum', () => {
    const { html } = conviteDeEquipe({
      nome: 'Paula',
      conta: 'Cuidar Bem ME',
      papel: UserRole.COORDINATOR,
      convidadoPor: null,
      url,
      expiraEm: new Date('2026-09-02T12:00:00Z'),
    })

    expect(html).toContain('Coordenador')
    expect(html).not.toContain('COORDINATOR')
  })

  it('datas saem no fuso do Brasil, e não em UTC', () => {
    // 03/09 às 00h30 UTC ainda é dia 02/09 em São Paulo. Errar isto faria o
    // e-mail avisar de um vencimento um dia depois do que a tela mostra.
    const { html } = documentosVencendo({
      itens: [
        {
          cuidador: 'Ana',
          documento: 'COREN',
          validade: new Date('2026-09-03T00:30:00Z'),
          diasRestantes: 8,
        },
      ],
      url,
    })

    expect(html).toContain('02/09/2026')
  })

  it('o assunto do aviso de trial fala em dias, não em data', () => {
    const base = {
      nome: 'Marcos',
      conta: 'Marcos Cuidador',
      termina: new Date('2026-09-01T12:00:00Z'),
      url,
    }

    expect(trialTerminando({ ...base, dias: 3 }).subject).toContain('em 3 dias')
    expect(trialTerminando({ ...base, dias: 1 }).subject).toContain('amanhã')
    expect(trialTerminando({ ...base, dias: 0 }).subject).toContain('hoje')
  })

  it('separa vencidos de vencendo — a lista misturada esconde o que já é risco', () => {
    const { html } = documentosVencendo({
      itens: [
        {
          cuidador: 'Ana',
          documento: 'COREN',
          validade: new Date('2026-08-01T12:00:00Z'),
          diasRestantes: -25,
        },
        {
          cuidador: 'Bia',
          documento: 'Atestado de saúde',
          validade: new Date('2026-09-10T12:00:00Z'),
          diasRestantes: 15,
        },
      ],
      url,
    })

    expect(html).toContain('Já vencidos')
    expect(html).toContain('vencido desde 01/08/2026')
    expect(html).toContain('Vencendo em breve')
    expect(html).toContain('vence em 15 dias')
  })
})

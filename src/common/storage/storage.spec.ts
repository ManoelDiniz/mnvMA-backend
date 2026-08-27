import { assinar } from './local.driver'
import { nomeSeguro } from './storage.service'
import { TAMANHO_MAXIMO_BYTES, conferirAssinatura } from './storage.types'

const pdf = (extra = 'conteudo') => Buffer.from(`%PDF-1.7\n${extra}`, 'binary')
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])

describe('conferência do tipo de arquivo pelos bytes', () => {
  it('reconhece o que o produto aceita', () => {
    expect(conferirAssinatura('application/pdf', pdf())).toBe(true)
    expect(conferirAssinatura('image/png', png())).toBe(true)
    expect(conferirAssinatura('image/jpeg', jpeg())).toBe(true)
    expect(conferirAssinatura('image/webp', webp())).toBe(true)
  })

  it('recusa arquivo com o tipo trocado — é o ataque simples e comum', () => {
    // Um executável renomeado para `.pdf`, anunciado como `application/pdf`.
    const executavel = Buffer.from([0x4d, 0x5a, 0x90, 0x00])
    expect(conferirAssinatura('application/pdf', executavel)).toBe(false)

    // Um PDF de verdade, anunciado como imagem.
    expect(conferirAssinatura('image/png', pdf())).toBe(false)
  })

  it('recusa tipo fora da lista, mesmo com bytes coerentes', () => {
    expect(conferirAssinatura('image/svg+xml', Buffer.from('<svg />'))).toBe(false)
    expect(conferirAssinatura('text/html', Buffer.from('<html>'))).toBe(false)
  })

  it('não estoura com arquivo vazio ou curto demais', () => {
    expect(conferirAssinatura('application/pdf', Buffer.alloc(0))).toBe(false)
    expect(conferirAssinatura('image/webp', Buffer.from('RIFF'))).toBe(false)
  })

  it('o limite de tamanho é 10 MB', () => {
    expect(TAMANHO_MAXIMO_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('assinatura do link de download', () => {
  const segredo = 'segredo-de-teste-com-tamanho-suficiente'
  const key = 'tenants/t1/caregivers/c1/documents/d1/abc.pdf'

  it('muda quando a chave ou o prazo mudam', () => {
    const base = assinar(segredo, key, 1_800_000_000)

    expect(assinar(segredo, key, 1_800_000_000)).toBe(base)
    expect(assinar(segredo, key, 1_800_000_001)).not.toBe(base)
    expect(assinar(segredo, `${key}x`, 1_800_000_000)).not.toBe(base)
  })

  it('muda com o segredo — link de um ambiente não vale no outro', () => {
    expect(assinar('outro-segredo-qualquer-bem-comprido', key, 1_800_000_000)).not.toBe(
      assinar(segredo, key, 1_800_000_000),
    )
  })
})

describe('nome do arquivo para exibir', () => {
  it('descarta o caminho que o navegador manda junto', () => {
    // O Windows manda o caminho completo em alguns navegadores antigos.
    expect(nomeSeguro('C:\\Users\\maria\\Documentos\\coren.pdf', 'pdf')).toBe('coren.pdf')
    expect(nomeSeguro('/home/maria/coren.pdf', 'pdf')).toBe('coren.pdf')
  })

  it('não deixa passar aspa nem quebra de linha — vão para um cabeçalho HTTP', () => {
    const perigoso = nomeSeguro('co"ren\r\n.pdf', 'pdf')
    expect(perigoso).not.toContain('"')
    expect(perigoso).not.toContain('\n')
  })

  it('acrescenta a extensão certa quando falta, sem duplicar', () => {
    expect(nomeSeguro('atestado', 'pdf')).toBe('atestado.pdf')
    expect(nomeSeguro('atestado.pdf', 'pdf')).toBe('atestado.pdf')

    // O nome é da pessoa: preserva-se a caixa que ela usou. A conferência da
    // extensão é que ignora maiúsculas, para não virar `ATESTADO.PDF.pdf`.
    expect(nomeSeguro('ATESTADO.PDF', 'pdf')).toBe('ATESTADO.PDF')
  })

  it('nome vazio vira algo utilizável em vez de string vazia', () => {
    expect(nomeSeguro('', 'pdf')).toBe('documento.pdf')
    expect(nomeSeguro('   ', 'pdf')).toBe('documento.pdf')
  })

  it('corta nome absurdamente longo', () => {
    expect(nomeSeguro(`${'a'.repeat(500)}.pdf`, 'pdf').length).toBeLessThanOrEqual(124)
  })
})

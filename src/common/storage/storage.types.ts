/**
 * Contrato de armazenamento de arquivo.
 *
 * Mesmo desenho do `MailService`: uma porta, dois transportes. Em
 * desenvolvimento os arquivos ficam em disco e ninguém precisa de conta em
 * provedor de nuvem para anexar um PDF; em produção vão para o bucket. O código
 * de negócio não sabe a diferença — e é isso que impede o clássico "funciona na
 * minha máquina" virar "não funciona em produção".
 */
export interface ArquivoParaGuardar {
  /** Caminho completo dentro do bucket. Quem monta é o serviço, nunca o cliente. */
  key: string
  body: Buffer
  contentType: string
}

export interface StorageDriver {
  readonly name: string

  guardar(arquivo: ArquivoParaGuardar): Promise<void>

  /**
   * URL temporária para baixar.
   *
   * Sempre assinada e sempre curta. Bucket público seria mais simples e
   * transformaria o COREN de um cuidador — documento com CPF e foto — em página
   * aberta na internet para quem descobrisse a URL.
   */
  urlAssinada(key: string, opcoes?: { nomeParaBaixar?: string }): Promise<string>

  remover(key: string): Promise<void>
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER')

/**
 * O que o produto aceita receber.
 *
 * Lista fechada, e conferida também pelos primeiros bytes do arquivo: o
 * `Content-Type` que o navegador manda é palpite do cliente, e um `.exe`
 * anunciado como `application/pdf` passaria por qualquer validação que confie
 * só nele.
 */
export const TIPOS_ACEITOS: Record<string, { extensao: string; assinatura?: number[][] }> = {
  'application/pdf': { extensao: 'pdf', assinatura: [[0x25, 0x50, 0x44, 0x46]] },
  'image/jpeg': { extensao: 'jpg', assinatura: [[0xff, 0xd8, 0xff]] },
  'image/png': {
    extensao: 'png',
    assinatura: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  // WEBP é RIFF: os bytes 8..11 dizem "WEBP", e por isso a conferência dele é
  // feita à parte, em `conferirAssinatura`.
  'image/webp': { extensao: 'webp' },
}

/** 10 MB: foto de documento pelo celular passa; vídeo, não. */
export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024

/**
 * Os primeiros bytes batem com o tipo declarado?
 *
 * Não é antivírus e não pretende ser. O que ela evita é o caso simples e comum:
 * subir um arquivo qualquer com o nome trocado e ele ficar guardado como se
 * fosse documento válido.
 */
export function conferirAssinatura(tipo: string, conteudo: Buffer): boolean {
  if (tipo === 'image/webp') {
    return (
      conteudo.length >= 12 &&
      conteudo.toString('ascii', 0, 4) === 'RIFF' &&
      conteudo.toString('ascii', 8, 12) === 'WEBP'
    )
  }

  const esperado = TIPOS_ACEITOS[tipo]?.assinatura
  if (!esperado) return false

  return esperado.some((bytes) =>
    bytes.every((byte, indice) => conteudo[indice] === byte),
  )
}

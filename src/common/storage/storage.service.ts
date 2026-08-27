import { randomUUID } from 'node:crypto'
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import {
  STORAGE_DRIVER,
  TAMANHO_MAXIMO_BYTES,
  TIPOS_ACEITOS,
  conferirAssinatura,
  type StorageDriver,
} from './storage.types'

export interface ArquivoRecebido {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

export interface ArquivoGuardado {
  key: string
  fileName: string
  mimeType: string
  size: number
}

/**
 * Porta única de entrada e saída de arquivo.
 *
 * Três coisas acontecem aqui, e nenhuma delas pode ficar a cargo de quem chama:
 *
 *   1. **A chave é montada pelo servidor**, sempre começando pelo tenant. Nome
 *      de arquivo vindo do cliente nunca vira caminho — é assim que se sobe um
 *      `../../.env` para dentro do bucket.
 *   2. **O tipo é conferido pelos bytes**, não pelo que o navegador declarou.
 *   3. **O nome original é preservado só para exibir e baixar**, separado da
 *      chave, e sanitizado.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name)

  constructor(@Inject(STORAGE_DRIVER) private readonly driver: StorageDriver) {}

  get driverName(): string {
    return this.driver.name
  }

  /**
   * Guarda o arquivo sob um prefixo do tenant.
   *
   * `prefixo` descreve o dono (`caregivers/<id>/documents/<id>`); o nome do
   * arquivo em si é um UUID. Chave adivinhável somada a URL assinada com prazo
   * longo seria o suficiente para alguém raspar documentos de terceiros.
   */
  async guardar(
    tenantId: string,
    prefixo: string,
    arquivo: ArquivoRecebido,
  ): Promise<ArquivoGuardado> {
    const tipo = TIPOS_ACEITOS[arquivo.mimetype]

    if (!tipo) {
      throw new BadRequestException({
        code: 'TIPO_DE_ARQUIVO_NAO_ACEITO',
        message: 'Envie um PDF ou uma imagem (JPG, PNG ou WEBP).',
      })
    }

    if (arquivo.size > TAMANHO_MAXIMO_BYTES) {
      throw new BadRequestException({
        code: 'ARQUIVO_GRANDE_DEMAIS',
        message: `O arquivo passa de ${Math.round(TAMANHO_MAXIMO_BYTES / 1024 / 1024)} MB. Tire uma foto com menos resolução ou comprima o PDF.`,
      })
    }

    if (!conferirAssinatura(arquivo.mimetype, arquivo.buffer)) {
      // O `Content-Type` é palpite do cliente. Sem esta conferência, um
      // executável renomeado para `.pdf` ficaria guardado como documento.
      throw new BadRequestException({
        code: 'ARQUIVO_CORROMPIDO',
        message: 'O conteúdo do arquivo não corresponde ao tipo dele. Tente enviar de novo.',
      })
    }

    const key = `tenants/${tenantId}/${prefixo}/${randomUUID()}.${tipo.extensao}`

    await this.driver.guardar({
      key,
      body: arquivo.buffer,
      contentType: arquivo.mimetype,
    })

    return {
      key,
      fileName: nomeSeguro(arquivo.originalname, tipo.extensao),
      mimeType: arquivo.mimetype,
      size: arquivo.size,
    }
  }

  urlAssinada(key: string, nomeParaBaixar?: string): Promise<string> {
    return this.driver.urlAssinada(key, { nomeParaBaixar })
  }

  /**
   * Remove o arquivo sem deixar o erro subir.
   *
   * Falhar aqui não pode derrubar a operação de negócio: se o registro do
   * documento foi apagado e o objeto ficou órfão no bucket, o custo é alguns
   * bytes; o contrário — registro vivo apontando para arquivo apagado — é o que
   * o cliente enxerga.
   */
  async remover(key: string | null | undefined): Promise<void> {
    if (!key) return

    try {
      await this.driver.remover(key)
    } catch (error) {
      this.logger.warn({ key, err: error }, 'falha ao remover arquivo do armazenamento')
    }
  }
}

/**
 * Nome de exibição: sem caminho, sem caractere de controle, com a extensão
 * certa. Não é usado como caminho em lugar nenhum — mas vai para dentro de um
 * cabeçalho HTTP no download, e por isso não pode carregar aspa nem quebra.
 */
export function nomeSeguro(original: string, extensao: string): string {
  const base = (original.split(/[\\/]/).pop() ?? 'documento')
    // O caractere de controle é justamente o que precisa sair daqui: ele
    // quebraria o cabeçalho HTTP do download.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f"\\]/g, '')
    .trim()
    .slice(0, 120)

  const limpo = base || 'documento'
  return limpo.toLowerCase().endsWith(`.${extensao}`) ? limpo : `${limpo}.${extensao}`
}

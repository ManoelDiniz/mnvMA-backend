import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../../config/env'
import type { ArquivoParaGuardar, StorageDriver } from './storage.types'

/**
 * Arquivos em disco — em desenvolvimento e **também em produção**, por ora.
 *
 * Existe para que anexar o PDF do COREN não dependa de conta em provedor de
 * nuvem, que é o mesmo motivo pelo qual o e-mail tem transporte `log`. A
 * plataforma decidiu ficar nele: o volume do servidor guarda o documento até o
 * dia em que o volume apertar, e aí `STORAGE_DRIVER=s3` troca o destino sem
 * tocar em nenhum módulo.
 *
 * Duas condições vêm junto com essa escolha, e as duas são de operação, não de
 * código: `STORAGE_LOCAL_DIR` precisa apontar para um **volume persistente**
 * (a validação de ambiente exige caminho absoluto fora de desenvolvimento), e
 * o **backup precisa cobrir esse diretório** — o banco guarda a chave, não o
 * arquivo, e um dump restaurado sozinho devolve links que apontam para o nada.
 *
 * A URL de download é **assinada aqui também**, e não servida direto do disco.
 * Se em desenvolvimento o link fosse aberto e em produção assinado, o caminho
 * assinado só seria exercitado depois do deploy — que é exatamente quando não
 * dá para descobrir que ele está errado.
 */
@Injectable()
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local'
  private readonly logger = new Logger(LocalStorageDriver.name)
  private readonly raiz: string
  private readonly segredo: string
  private readonly ttlSegundos: number
  private readonly apiUrl: string

  constructor(config: ConfigService<Env, true>) {
    this.raiz = resolve(config.get('STORAGE_LOCAL_DIR', { infer: true }))
    // O mesmo segredo que assina sessão. Vazá-lo já seria catástrofe maior que
    // um link de download — não vale um segredo a mais para administrar.
    this.segredo = config.get('JWT_ACCESS_SECRET', { infer: true })
    this.ttlSegundos = config.get('STORAGE_URL_TTL', { infer: true })
    this.apiUrl = config.get('API_URL', { infer: true }).replace(/\/+$/, '')
  }

  async guardar(arquivo: ArquivoParaGuardar): Promise<void> {
    const caminho = this.caminhoDe(arquivo.key)
    await mkdir(dirname(caminho), { recursive: true })
    await writeFile(caminho, arquivo.body)
    this.logger.debug(`arquivo guardado em ${caminho}`)
  }

  urlAssinada(key: string, opcoes?: { nomeParaBaixar?: string }): Promise<string> {
    const expiraEm = Math.floor(Date.now() / 1000) + this.ttlSegundos
    const assinatura = assinar(this.segredo, key, expiraEm)

    const busca = new URLSearchParams({ exp: String(expiraEm), sig: assinatura })
    if (opcoes?.nomeParaBaixar) busca.set('nome', opcoes.nomeParaBaixar)

    return Promise.resolve(`${this.apiUrl}/v1/files/${encodeURI(key)}?${busca.toString()}`)
  }

  async remover(key: string): Promise<void> {
    // `force`: remover arquivo que já não existe não é erro. O registro no
    // banco é a fonte da verdade, e ele pode ter sobrevivido a uma limpeza.
    await rm(this.caminhoDe(key), { force: true })
  }

  // ─── Leitura, usada pelo controller de download ─────────────────────────────

  /** Confere a assinatura do link e devolve o caminho em disco, ou `null`. */
  resolver(key: string, exp: string, sig: string): string | null {
    const expiraEm = Number(exp)
    if (!Number.isFinite(expiraEm)) return null
    if (expiraEm < Math.floor(Date.now() / 1000)) return null

    const esperado = assinar(this.segredo, key, expiraEm)
    if (!compararSeguro(esperado, sig)) return null

    return this.caminhoDe(key)
  }

  /**
   * Caminho em disco, com a garantia de não escapar da raiz.
   *
   * A chave é montada pelo servidor e nunca vem do cliente — mas ela chega de
   * volta pela URL de download, e `../../` numa URL é o ataque mais antigo que
   * existe contra servidor de arquivo.
   */
  private caminhoDe(key: string): string {
    const limpo = normalize(key).replace(/^([/\\]|\.\.[/\\])+/, '')
    const caminho = resolve(join(this.raiz, limpo))

    if (caminho !== this.raiz && !caminho.startsWith(this.raiz + sep)) {
      throw new Error('Caminho de arquivo fora do diretório permitido.')
    }

    return caminho
  }
}

export function assinar(segredo: string, key: string, expiraEm: number): string {
  return createHmac('sha256', segredo).update(`${key}:${expiraEm}`).digest('hex')
}

function compararSeguro(esperado: string, recebido: string): boolean {
  const a = Buffer.from(esperado, 'utf8')
  const b = Buffer.from(recebido, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

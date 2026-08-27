import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Controller, Get, NotFoundException, Query, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiExcludeController } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { Public } from '../decorators'
import type { Env } from '../../config/env'
import { LocalStorageDriver } from './local.driver'

/**
 * Entrega os arquivos guardados em disco — só no modo `local`.
 *
 * A rota é pública porque a autorização está **na assinatura da URL**, não na
 * sessão: é o mesmo modelo do link presigned do bucket, e é o que permite o
 * navegador baixar o arquivo direto, sem o painel intermediar cada byte.
 *
 * Com `STORAGE_DRIVER=s3` esta rota deixa de servir e responde 404: o link
 * passa a apontar para o bucket. Ela é, hoje, o caminho de produção — e foi
 * escrita assinada desde o primeiro dia justamente para não ser um atalho de
 * desenvolvimento promovido às pressas.
 */
@Controller('files')
@ApiExcludeController()
export class FilesController {
  constructor(
    private readonly local: LocalStorageDriver,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Get('*key')
  async baixar(
    @Req() req: Request,
    @Res() res: Response,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Query('nome') nome?: string,
  ): Promise<void> {
    if (this.config.get('STORAGE_DRIVER', { infer: true }) !== 'local') {
      throw new NotFoundException()
    }

    // O caminho vem cru da URL para bater com a chave exatamente como foi
    // assinada; a defesa contra `../` mora no driver, que resolve o caminho.
    //
    // O recorte tolera o prefixo global da API (`/v1/files/...`) e a rota sem
    // ele — foi justamente essa diferença que fez o download responder 404 com
    // assinatura válida na primeira versão.
    const key = decodeURIComponent(req.path.replace(/^.*?\/files\//, ''))
    if (!key || !exp || !sig) throw new NotFoundException()

    const caminho = seguro(() => this.local.resolver(key, exp, sig))

    // Link expirado, adulterado ou inexistente respondem igual: 404. Distinguir
    // "assinatura inválida" de "arquivo não existe" contaria a quem está
    // tentando se a chave que ele adivinhou está certa.
    if (!caminho) throw new NotFoundException()

    const informacoes = await stat(caminho).catch(() => null)
    if (!informacoes?.isFile()) throw new NotFoundException()

    // O tipo sai da extensão da chave, que foi o servidor que montou a partir
    // do tipo conferido no upload. Sem `Content-Type`, o navegador adivinha — e
    // adivinhar tipo de arquivo de terceiro é como um HTML disfarçado acaba
    // executando no nosso domínio. O `nosniff` abaixo fecha a mesma porta.
    res.setHeader('Content-Type', tipoPelaExtensao(key))
    res.setHeader('Content-Length', informacoes.size)
    res.setHeader('Cache-Control', 'private, max-age=60')
    // Sempre `attachment`: abrir arquivo de terceiro no mesmo domínio é caminho
    // conhecido de XSS, e um SVG ou HTML disfarçado rodaria com a nossa origem.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${(nome ?? 'documento').replace(/["\r\n\\]/g, '')}"`,
    )
    res.setHeader('X-Content-Type-Options', 'nosniff')

    createReadStream(caminho).pipe(res)
  }
}

/** Só o que o upload aceita entrar; o resto sai como binário genérico. */
function tipoPelaExtensao(key: string): string {
  const extensao = key.split('.').pop()?.toLowerCase() ?? ''

  const mapa: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }

  return mapa[extensao] ?? 'application/octet-stream'
}

function seguro<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch {
    return null
  }
}

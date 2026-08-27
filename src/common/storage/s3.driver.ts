import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../../config/env'
import type { ArquivoParaGuardar, StorageDriver } from './storage.types'

/**
 * Arquivos no bucket — Cloudflare R2, S3 ou qualquer coisa com a mesma API.
 *
 * Aqui o SDK oficial é usado, diferente do Mercado Pago, onde preferimos
 * `fetch` direto. O motivo é a assinatura: uma URL presigned é SigV4, e
 * escrever SigV4 à mão para economizar uma dependência seria trocar um pacote
 * por um erro difícil de enxergar em controle de acesso a documento com CPF e
 * foto de gente.
 *
 * `forcePathStyle` existe porque o R2 e o MinIO usam caminho
 * (`bucket/objeto`), enquanto a AWS usa subdomínio — errar isso dá "bucket não
 * encontrado" com credencial correta.
 */
@Injectable()
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3'
  private readonly logger = new Logger(S3StorageDriver.name)
  private readonly cliente: S3Client | null
  private readonly bucket: string
  private readonly ttlSegundos: number

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true }) ?? ''
    this.ttlSegundos = config.get('STORAGE_URL_TTL', { infer: true })

    const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true })
    const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true })

    this.cliente =
      accessKeyId && secretAccessKey && this.bucket
        ? new S3Client({
            region: config.get('S3_REGION', { infer: true }),
            endpoint: config.get('S3_ENDPOINT', { infer: true }),
            forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
            credentials: { accessKeyId, secretAccessKey },
          })
        : null
  }

  async guardar(arquivo: ArquivoParaGuardar): Promise<void> {
    const cliente = this.exigirCliente()

    await cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: arquivo.key,
        Body: arquivo.body,
        ContentType: arquivo.contentType,
      }),
    )

    this.logger.log({ key: arquivo.key, bytes: arquivo.body.length }, 'arquivo enviado ao bucket')
  }

  urlAssinada(key: string, opcoes?: { nomeParaBaixar?: string }): Promise<string> {
    const cliente = this.exigirCliente()

    return getSignedUrl(
      cliente,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // Faz o navegador baixar com o nome original em vez do UUID da chave.
        // `inline` seria melhor para PDF, mas abrir arquivo de terceiro no
        // mesmo domínio é caminho conhecido de XSS — aqui o download é forçado.
        ...(opcoes?.nomeParaBaixar
          ? {
              ResponseContentDisposition: `attachment; filename="${sanitizar(opcoes.nomeParaBaixar)}"`,
            }
          : {}),
      }),
      { expiresIn: this.ttlSegundos },
    )
  }

  async remover(key: string): Promise<void> {
    const cliente = this.exigirCliente()
    await cliente.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  private exigirCliente(): S3Client {
    if (!this.cliente) {
      throw new ServiceUnavailableException({
        code: 'ARMAZENAMENTO_NAO_CONFIGURADO',
        message:
          'O armazenamento de arquivos não está configurado neste ambiente. Defina S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY.',
      })
    }
    return this.cliente
  }
}

/** Aspas e quebras de linha no nome quebrariam o cabeçalho HTTP. */
function sanitizar(nome: string): string {
  return nome.replace(/["\r\n\\]/g, '').slice(0, 120)
}

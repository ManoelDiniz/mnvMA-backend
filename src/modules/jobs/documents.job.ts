import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { SystemScope } from '../../common/database/system-scope.service'
import { TenantStatus } from '../../common/enums/tenant.enum'
import type { Env } from '../../config/env'
import { ROTULOS_TIPO } from '../documents/documents.service'
import type { DocumentType } from '../documents/entities/caregiver-document.entity'
import { MailService } from '../mail/mail.service'
import { documentosVencendo, type DocumentoVencendo } from '../mail/templates'
import { destinatarios, PAPEIS_ADMINISTRATIVOS } from './destinatarios'
import { chaveDoDia, JobLockService } from './job-lock.service'

export const JOB_DOCUMENTOS = 'documentos.vencendo'

/** Contas que ainda operam. Conta cancelada não recebe cobrança operacional. */
const STATUS_ATIVOS = [TenantStatus.TRIAL, TenantStatus.ACTIVE, TenantStatus.PAST_DUE]

interface LinhaVencendo {
  tenant_id: string
  cuidador: string
  type: DocumentType
  label: string | null
  expires_at: string
}

/**
 * O aviso diário de COREN e atestado vencendo.
 *
 * A tela de documentos já mostra isso — mas só para quem abre a tela. Risco
 * trabalhista não espera alguém lembrar de conferir: o dia do incidente é o dia
 * em que se descobre que o atestado venceu há dois meses.
 */
@Injectable()
export class DocumentsJob {
  private readonly logger = new Logger(DocumentsJob.name)

  constructor(
    private readonly locks: JobLockService,
    private readonly systemScope: SystemScope,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Cron('0 8 * * *', { name: JOB_DOCUMENTOS, timeZone: 'America/Sao_Paulo' })
  async diariamente(): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) return
    await this.executar()
  }

  async executar(referencia = new Date()): Promise<void> {
    await this.locks.run(JOB_DOCUMENTOS, chaveDoDia(referencia), async () => {
      const porConta = await this.levantar(referencia)

      let avisos = 0
      for (const [tenantId, itens] of porConta) {
        avisos += await this.avisar(tenantId, itens)
      }

      return `${porConta.size} conta(s), ${avisos} aviso(s)`
    })
  }

  // ─── Levantamento ───────────────────────────────────────────────────────────

  /**
   * Uma consulta para todas as contas, e não uma por conta: com mil tenants a
   * segunda forma são mil idas ao banco toda manhã para, na maioria delas,
   * descobrir que não há nada a avisar.
   */
  private async levantar(referencia: Date): Promise<Map<string, DocumentoVencendo[]>> {
    const dias = this.config.get('DOCUMENT_ALERT_DAYS', { infer: true })
    const limite = diaCivil(new Date(referencia.getTime() + dias * 86_400_000))
    const hoje = diaCivil(referencia)

    const linhas = await this.systemScope.run('jobs.documentos.levantar', (manager) =>
      manager.query<LinhaVencendo[]>(
        `SELECT d.tenant_id, c.name AS cuidador, d.type, d.label, d.expires_at
           FROM caregiver_documents d
           JOIN caregivers c
             ON c.id = d.caregiver_id AND c.deleted_at IS NULL AND c.is_active = 1
           JOIN tenants t
             ON t.id = d.tenant_id AND t.deleted_at IS NULL AND t.status IN (?, ?, ?)
          WHERE d.deleted_at IS NULL
            AND d.expires_at IS NOT NULL
            AND d.expires_at <= ?
          ORDER BY d.tenant_id, d.expires_at ASC`,
        [...STATUS_ATIVOS, limite],
      ),
    )

    const porConta = new Map<string, DocumentoVencendo[]>()

    for (const linha of linhas) {
      const lista = porConta.get(linha.tenant_id) ?? []
      lista.push({
        cuidador: linha.cuidador,
        documento: linha.label?.trim() || ROTULOS_TIPO[linha.type],
        // `expires_at` vem como texto (`dateStrings: ['DATE']`): data de
        // calendário não tem hora nem fuso, e deixar o driver convertê-la para
        // Date faria "12/09" virar "11/09" no horário do Brasil.
        validade: new Date(`${linha.expires_at}T12:00:00Z`),
        diasRestantes: diferencaEmDias(hoje, linha.expires_at),
      })
      porConta.set(linha.tenant_id, lista)
    }

    return porConta
  }

  // ─── Envio ──────────────────────────────────────────────────────────────────

  private async avisar(tenantId: string, itens: DocumentoVencendo[]): Promise<number> {
    return this.systemScope.run('jobs.documentos.avisar', async (manager) => {
      const pessoas = await destinatarios(manager, tenantId, PAPEIS_ADMINISTRATIVOS)

      if (pessoas.length === 0) {
        this.logger.warn({ tenantId }, 'conta sem administrador ativo — ninguém para avisar')
        return 0
      }

      const conteudo = documentosVencendo({ itens, url: this.urlDeDocumentos() })
      await this.mail.sendMany(
        pessoas.map((p) => p.email),
        conteudo,
      )

      return pessoas.length
    })
  }

  private urlDeDocumentos(): string {
    return `${this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '')}/documentos`
  }
}

/** `2026-08-26` no fuso do produto — é o "hoje" de quem vai ler o e-mail. */
function diaCivil(data: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(data)
}

/** Diferença em dias de calendário entre duas datas `YYYY-MM-DD`. */
function diferencaEmDias(de: string, ate: string): number {
  const ms = Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { JobRunStatus } from './entities/job-run.entity'

/**
 * Execução que ficou `RUNNING` por mais que isto foi um processo que morreu no
 * meio, não um job lento. Passado esse prazo a janela volta a ser reivindicável.
 */
const CLAIM_MORTO_MS = 60 * 60 * 1000

export interface Execucao {
  /** Marca a execução como concluída, com um resumo do que foi feito. */
  ok(detalhe: string): Promise<void>
  falhou(erro: unknown): Promise<void>
}

/**
 * A trava que permite ter mais de uma instância da API rodando os mesmos jobs.
 *
 * Duas instâncias acordam às 9h e as duas tentam varrer os trials. Sem trava,
 * a segunda manda o mesmo e-mail de "seu teste termina amanhã" que a primeira
 * acabou de mandar. Com ela, quem consegue inserir a linha `(job, run_key)`
 * roda; a outra descobre a colisão e sai de lado.
 *
 * A trava é o banco de propósito. `setInterval` com um booleano em memória
 * resolve dentro de um processo e não resolve nada entre dois contêineres —
 * que é exatamente o cenário do primeiro deploy com réplica.
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name)
  private readonly runner = `${hostname()}#${process.pid}`

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Tenta reivindicar a janela `runKey` do job. Devolve `null` quando outra
   * instância já pegou — o chamador simplesmente não faz nada.
   */
  async claim(job: string, runKey: string): Promise<Execucao | null> {
    const id = randomUUID()

    // `INSERT IGNORE` + chave única: uma ida ao banco, sem SELECT antes, sem
    // janela entre conferir e inserir.
    const inserido = await this.dataSource.query<{ affectedRows?: number }>(
      `INSERT IGNORE INTO job_runs (id, job, run_key, status, started_at, runner)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), ?)`,
      [id, job, runKey, JobRunStatus.RUNNING, this.runner],
    )

    if (afetadas(inserido) > 0) return this.execucao(id, job, runKey)

    // Colidiu. Ou outra instância está rodando agora, ou um processo morreu
    // no meio e deixou a janela travada para sempre — este segundo caso
    // precisa poder ser retomado, senão um `kill -9` desliga o job até que
    // alguém apague a linha na mão.
    const retomado = await this.dataSource.query<{ affectedRows?: number }>(
      `UPDATE job_runs
          SET id = ?, started_at = UTC_TIMESTAMP(6), runner = ?
        WHERE job = ? AND run_key = ?
          AND status = ?
          AND started_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? SECOND)`,
      [id, this.runner, job, runKey, JobRunStatus.RUNNING, CLAIM_MORTO_MS / 1000],
    )

    if (afetadas(retomado) > 0) {
      this.logger.warn({ job, runKey }, 'execução anterior ficou pendurada — retomando')
      return this.execucao(id, job, runKey)
    }

    this.logger.debug(`job ${job}[${runKey}] já foi executado ou está em andamento`)
    return null
  }

  /**
   * Reivindica e roda em seguida, cuidando de fechar a execução nos dois
   * desfechos. É a forma que os jobs usam.
   */
  async run(job: string, runKey: string, fn: () => Promise<string>): Promise<void> {
    const execucao = await this.claim(job, runKey)
    if (!execucao) return

    const inicio = Date.now()
    try {
      const detalhe = await fn()
      await execucao.ok(detalhe)
      this.logger.log({ job, runKey, ms: Date.now() - inicio, detalhe }, 'job concluído')
    } catch (error) {
      await execucao.falhou(error)
      // `error`, e não `warn`: job que falha em silêncio é o risco listado no
      // roadmap — receita evaporando sem ninguém ver.
      this.logger.error({ job, runKey, err: error }, 'job falhou')
    }
  }

  private execucao(id: string, job: string, runKey: string): Execucao {
    const encerrar = async (status: JobRunStatus, detail: string): Promise<void> => {
      await this.dataSource.query(
        `UPDATE job_runs SET status = ?, finished_at = UTC_TIMESTAMP(6), detail = ? WHERE id = ?`,
        [status, detail.slice(0, 500), id],
      )
    }

    return {
      ok: (detalhe) => encerrar(JobRunStatus.OK, detalhe),
      falhou: async (erro) => {
        await encerrar(JobRunStatus.FAILED, erro instanceof Error ? erro.message : String(erro))
        this.logger.debug(`job ${job}[${runKey}] marcado como falho`)
      },
    }
  }
}

/**
 * O driver do MySQL devolve o resumo do comando, não linhas; `affectedRows` é o
 * que diz se o INSERT/UPDATE/DELETE pegou alguma coisa.
 */
export function afetadas(resultado: unknown): number {
  if (resultado && typeof resultado === 'object' && 'affectedRows' in resultado) {
    const { affectedRows } = resultado
    return typeof affectedRows === 'number' ? affectedRows : 0
  }
  return 0
}

/**
 * `2026-08-26` — a janela de um job diário.
 *
 * No fuso do produto, não em UTC: a varredura das 21h de um dia e a das 9h do
 * dia seguinte precisam cair em janelas diferentes, e em UTC elas cairiam na
 * mesma.
 */
export function chaveDoDia(data: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(data)
}

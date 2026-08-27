import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { SystemScope } from '../../common/database/system-scope.service'
import type { Env } from '../../config/env'
import { afetadas, chaveDoDia, JobLockService } from './job-lock.service'

export const JOB_LIMPEZA = 'seguranca.limpeza'

/** Quanto tempo um token morto ainda serve para investigar um incidente. */
const RETENCAO_TOKENS_DIAS = 30
/** Histórico de execução de job: útil por um trimestre, ruído depois disso. */
const RETENCAO_EXECUCOES_DIAS = 90

/**
 * Varre o que já não vale nada.
 *
 * Refresh token expirado e link de senha usado não têm mais função nenhuma — o
 * que têm é a capacidade de aparecer num vazamento de dump daqui a dois anos.
 * Ficam por um mês, que é o tempo de investigar um incidente, e depois somem.
 *
 * De madrugada porque é `DELETE` em tabela grande, e às 3h ninguém está
 * lançando plantão.
 */
@Injectable()
export class CleanupJob {
  constructor(
    private readonly locks: JobLockService,
    private readonly systemScope: SystemScope,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Cron('0 3 * * *', { name: JOB_LIMPEZA, timeZone: 'America/Sao_Paulo' })
  async diariamente(): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) return
    await this.executar()
  }

  async executar(referencia = new Date()): Promise<void> {
    await this.locks.run(JOB_LIMPEZA, chaveDoDia(referencia), () =>
      this.systemScope.run('jobs.limpeza', async (manager) => {
        const refresh = await apagar(
          manager.query.bind(manager),
          `DELETE FROM refresh_tokens
            WHERE expires_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)`,
          [RETENCAO_TOKENS_DIAS],
        )

        const senhas = await apagar(
          manager.query.bind(manager),
          `DELETE FROM password_reset_tokens
            WHERE (used_at IS NOT NULL OR expires_at < UTC_TIMESTAMP(6))
              AND created_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)`,
          [RETENCAO_TOKENS_DIAS],
        )

        const execucoes = await apagar(
          manager.query.bind(manager),
          `DELETE FROM job_runs
            WHERE started_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)`,
          [RETENCAO_EXECUCOES_DIAS],
        )

        return `${refresh} refresh, ${senhas} link(s) de senha, ${execucoes} execução(ões)`
      }),
    )
  }
}

type Query = (sql: string, params: unknown[]) => Promise<unknown>

async function apagar(query: Query, sql: string, params: unknown[]): Promise<number> {
  return afetadas(await query(sql, params))
}

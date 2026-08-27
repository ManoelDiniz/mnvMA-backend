import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export enum JobRunStatus {
  RUNNING = 'RUNNING',
  OK = 'OK',
  FAILED = 'FAILED',
}

/**
 * Uma execução de job agendado.
 *
 * Serve para duas coisas ao mesmo tempo, e é por isso que a tabela existe em
 * vez de um simples `setInterval`:
 *
 *   1. **Trava distribuída.** A chave única `(job, run_key)` é o que impede duas
 *      instâncias da API de rodarem a varredura de trial no mesmo dia — e, com
 *      ela, de mandarem o mesmo e-mail duas vezes. Quem consegue inserir a
 *      linha, roda; quem colide, sai de lado. A trava é o banco, não a memória
 *      do processo: memória não atravessa contêiner.
 *
 *   2. **Histórico.** Job que falha em silêncio é receita evaporando sem
 *      ninguém ver. `status` e `detail` respondem "rodou ontem?" sem precisar
 *      caçar linha de log em agregador.
 *
 * Sem `tenant_id`: é tabela de sistema. Os jobs atravessam contas por dentro do
 * SystemScope, que já exige motivo e vira log.
 */
@Entity('job_runs')
@Index('uq_job_runs_execucao', ['job', 'runKey'], { unique: true })
export class JobRun {
  @PrimaryGeneratedColumn('uuid')
  id: string

  /** Nome do job. Ex.: `trial.varredura`. */
  @Column({ length: 60 })
  job: string

  /**
   * Identifica a janela de execução. Para job diário é a data (`2026-08-26`);
   * para mensal, o competência (`2026-08`). É o que dá idempotência: rodar duas
   * vezes na mesma janela não repete o efeito.
   */
  @Column({ length: 60 })
  runKey: string

  @Column({ type: 'enum', enum: JobRunStatus, default: JobRunStatus.RUNNING })
  status: JobRunStatus

  @Column({ type: 'datetime', precision: 6 })
  startedAt: Date

  @Column({ type: 'datetime', precision: 6, nullable: true })
  finishedAt?: Date | null

  /** Resumo do que foi feito, ou a mensagem do erro. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  detail?: string | null

  /** Quem pegou a trava — ajuda a achar a instância que travou. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  runner?: string | null
}

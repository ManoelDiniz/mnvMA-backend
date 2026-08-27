import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BillingModule } from '../billing/billing.module'
import { BillingSyncJob } from './billing-sync.job'
import { CleanupJob } from './cleanup.job'
import { DocumentsJob } from './documents.job'
import { DunningJob } from './dunning.job'
import { JobRun } from './entities/job-run.entity'
import { JobLockService } from './job-lock.service'
import { TrialJob } from './trial.job'

/**
 * Os jobs agendados.
 *
 * Cron em processo, não fila com Redis — e a cobrança do Mercado Pago, que era
 * o caso reservado para a fila, acabou não precisando dela: o webhook responde
 * 200 na hora e processa em segundo plano (`WebhookQueue`), com o evento
 * gravado em `webhook_events` e o `BillingSyncJob` varrendo de hora em hora o
 * que ficou para trás. A durabilidade veio do banco, não do Redis. Fila com
 * broker entra no dia em que houver trabalho que precise de paralelismo real.
 *
 * `JOBS_ENABLED=false` desliga tudo: é o que permite subir um processo web sem
 * jobs quando eles passarem a ter um worker próprio.
 */
@Module({
  imports: [TypeOrmModule.forFeature([JobRun]), BillingModule],
  providers: [JobLockService, TrialJob, DocumentsJob, CleanupJob, DunningJob, BillingSyncJob],
  exports: [JobLockService, TrialJob, DocumentsJob, CleanupJob, DunningJob, BillingSyncJob],
})
export class JobsModule {}

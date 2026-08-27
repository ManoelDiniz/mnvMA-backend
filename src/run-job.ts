import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { BillingSyncJob } from './modules/jobs/billing-sync.job'
import { CleanupJob } from './modules/jobs/cleanup.job'
import { DocumentsJob } from './modules/jobs/documents.job'
import { DunningJob } from './modules/jobs/dunning.job'
import { TrialJob } from './modules/jobs/trial.job'

/**
 * Roda um job agendado na hora, fora do cron.
 *
 *   npm run job -- trial
 *   npm run job -- documentos
 *   npm run job -- limpeza
 *
 * Serve para três coisas: conferir o job depois de mexer nele, rodar de novo o
 * que falhou numa madrugada, e disparar pelo agendador da hospedagem quando o
 * dia chegar de a API rodar sem processo residente.
 *
 * A trava de `job_runs` continua valendo — rodar isto no mesmo dia em que o
 * cron já rodou não repete o efeito nem manda e-mail duas vezes. Para forçar a
 * repetição, apague a linha da janela em `job_runs`.
 */
const JOBS = {
  trial: [TrialJob, 'trial.varredura'],
  documentos: [DocumentsJob, 'documentos.vencendo'],
  limpeza: [CleanupJob, 'seguranca.limpeza'],
  cobranca: [DunningJob, 'billing.dunning'],
  'cobranca-sync': [BillingSyncJob, 'billing.sincronizacao'],
} as const

type Nome = keyof typeof JOBS

async function main(): Promise<void> {
  const logger = new Logger('run-job')
  const nome = process.argv[2] as Nome | undefined

  if (!nome || !(nome in JOBS)) {
    logger.error(`Uso: npm run job -- <${Object.keys(JOBS).join('|')}>`)
    process.exitCode = 1
    return
  }

  // Sem servidor HTTP: é um processo de linha de comando.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  })

  try {
    const [classe, rotulo] = JOBS[nome]
    logger.log(`rodando ${rotulo}…`)
    await app.get(classe).executar()
  } finally {
    await app.close()
  }
}

void main()

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { LessThanOrEqual, type EntityManager } from 'typeorm'
import { SystemScope } from '../../common/database/system-scope.service'
import { SubscriptionStatus, TenantStatus } from '../../common/enums/tenant.enum'
import { TenantStatusCache } from '../../common/services/tenant-status.cache'
import type { Env } from '../../config/env'
import { Subscription } from '../billing/entities/subscription.entity'
import { MailService } from '../mail/mail.service'
import { trialEncerrado, trialTerminando } from '../mail/templates'
import { Tenant } from '../tenants/entities/tenant.entity'
import { destinatarios, PAPEIS_DE_COBRANCA } from './destinatarios'
import { chaveDoDia, JobLockService } from './job-lock.service'

export const JOB_TRIAL = 'trial.varredura'

/**
 * Em quantos dias antes do fim do teste o aviso sai. Dois toques: um com folga
 * para decidir, outro na véspera. Avisar todo dia vira ruído e a pessoa para de
 * ler justamente antes do dia que importa.
 */
const AVISOS_EM_DIAS = [3, 1]

/**
 * O que faz o trial acabar sozinho.
 *
 * Até aqui, `trialEndsAt` era uma data que ninguém lia: a conta seguia
 * escrevendo depois do prazo até alguém mexer no banco. Este job é o que
 * transforma o campo em regra.
 */
@Injectable()
export class TrialJob {
  private readonly logger = new Logger(TrialJob.name)

  constructor(
    private readonly locks: JobLockService,
    private readonly systemScope: SystemScope,
    private readonly mail: MailService,
    private readonly statusCache: TenantStatusCache,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // 9h no fuso do produto: e-mail de cobrança que chega de madrugada é e-mail
  // que some no meio da caixa de entrada.
  @Cron('0 9 * * *', { name: JOB_TRIAL, timeZone: 'America/Sao_Paulo' })
  async diariamente(): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) return
    await this.executar()
  }

  /** Separado do gatilho para poder ser chamado por teste e por script. */
  async executar(referencia = new Date()): Promise<void> {
    await this.locks.run(JOB_TRIAL, chaveDoDia(referencia), async () => {
      const encerrados = await this.encerrarVencidos(referencia)
      const avisados = await this.avisarQuemEstaAcabando(referencia)
      return `${encerrados} encerrado(s), ${avisados} aviso(s)`
    })
  }

  // ─── Fim do teste ───────────────────────────────────────────────────────────

  private async encerrarVencidos(agora: Date): Promise<number> {
    const contas = await this.systemScope.run('jobs.trial.vencidos', (manager) =>
      manager.getRepository(Tenant).find({
        where: { status: TenantStatus.TRIAL, trialEndsAt: LessThanOrEqual(agora) },
      }),
    )

    for (const conta of contas) {
      await this.systemScope.run('jobs.trial.encerrar', async (manager) => {
        await manager.getRepository(Tenant).update(conta.id, { status: TenantStatus.EXPIRED })

        // A assinatura acompanha. Não existe SUSPENDED por "trial que acabou"
        // separado de "pagamento que falhou", e não faz falta: para o produto
        // os dois significam a mesma coisa — escrita bloqueada até assinar.
        await manager
          .getRepository(Subscription)
          .update({ tenantId: conta.id }, { status: SubscriptionStatus.SUSPENDED })

        await this.notificar(manager, conta, (nome) =>
          trialEncerrado({ nome, conta: conta.name, url: this.urlDePlanos() }),
        )
      })

      // Sem isto a conta continuaria escrevendo por até 30 segundos depois de
      // expirar, que é o TTL do cache do guard.
      this.statusCache.invalidate(conta.id)
      this.logger.log({ tenantId: conta.id }, 'teste encerrado — conta em somente leitura')
    }

    return contas.length
  }

  // ─── Avisos ─────────────────────────────────────────────────────────────────

  private async avisarQuemEstaAcabando(agora: Date): Promise<number> {
    let enviados = 0

    for (const dias of AVISOS_EM_DIAS) {
      const { inicio, fim } = janelaDoDia(agora, dias)

      const contas = await this.systemScope.run('jobs.trial.avisos', (manager) =>
        manager
          .getRepository(Tenant)
          .createQueryBuilder('t')
          .where('t.status = :status', { status: TenantStatus.TRIAL })
          .andWhere('t.trialEndsAt >= :inicio AND t.trialEndsAt < :fim', { inicio, fim })
          .andWhere('t.deletedAt IS NULL')
          .getMany(),
      )

      for (const conta of contas) {
        await this.systemScope.run('jobs.trial.avisar', (manager) =>
          this.notificar(manager, conta, (nome) =>
            trialTerminando({
              nome,
              conta: conta.name,
              dias,
              // `trialEndsAt` é nulo apenas fora do TRIAL, e a consulta já
              // filtrou por ele estar dentro da janela.
              termina: conta.trialEndsAt ?? agora,
              url: this.urlDePlanos(),
            }),
          ),
        )
        enviados += 1
      }
    }

    return enviados
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private async notificar(
    manager: EntityManager,
    conta: Tenant,
    conteudo: (nome: string) => Parameters<MailService['send']>[1],
  ): Promise<void> {
    const titulares = await destinatarios(manager, conta.id, PAPEIS_DE_COBRANCA)

    if (titulares.length === 0) {
      this.logger.warn({ tenantId: conta.id }, 'conta sem titular ativo — ninguém para avisar')
      return
    }

    for (const titular of titulares) {
      await this.mail.send(titular.email, conteudo(titular.name))
    }
  }

  private urlDePlanos(): string {
    return `${this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '')}/planos`
  }
}

/**
 * Janela de 24 h que começa daqui a `dias`.
 *
 * Comparar `trialEndsAt` com um instante exato não acerta ninguém: o trial de
 * cada conta termina na hora em que ela foi criada. O que se quer é "termina
 * daqui a 3 dias", não "termina neste segundo".
 */
function janelaDoDia(agora: Date, dias: number): { inicio: Date; fim: Date } {
  const inicio = new Date(agora.getTime() + dias * 86_400_000)
  return { inicio, fim: new Date(inicio.getTime() + 86_400_000) }
}

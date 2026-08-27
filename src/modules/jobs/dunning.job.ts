import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { In, type EntityManager } from 'typeorm'
import { SystemScope } from '../../common/database/system-scope.service'
import { SubscriptionStatus, TenantStatus } from '../../common/enums/tenant.enum'
import type { Env } from '../../config/env'
import { Subscription } from '../billing/entities/subscription.entity'
import { SubscriptionStatusService } from '../billing/subscription-status.service'
import { MailService } from '../mail/mail.service'
import { assinaturaCancelada, cobrancaEmAtraso, contaSuspensa } from '../mail/templates'
import { Tenant } from '../tenants/entities/tenant.entity'
import { destinatarios, PAPEIS_DE_COBRANCA } from './destinatarios'
import { chaveDoDia, JobLockService } from './job-lock.service'

export const JOB_DUNNING = 'billing.dunning'

/**
 * A régua da inadimplência, em dias desde a primeira recusa.
 *
 * O desenho vem de `03-mercado-pago.md` §6 e tem uma ordem deliberada: três
 * avisos antes de bloquear qualquer coisa, um mês inteiro de somente leitura
 * antes de cancelar. Cliente que atrasou não é cliente que foi embora — na
 * maioria das vezes é cartão vencido, e quem trata isso como fraude perde a
 * conta que ia voltar sozinha.
 */
const REGUA = [
  { dia: 3, estagio: 2, acao: 'aviso' },
  { dia: 5, estagio: 3, acao: 'aviso' },
  { dia: 7, estagio: 4, acao: 'suspender' },
  { dia: 37, estagio: 5, acao: 'cancelar' },
] as const

/** Dia em que a escrita é bloqueada — usado nas mensagens dos avisos. */
const DIA_DA_SUSPENSAO = 7

/**
 * O que acontece com quem não pagou.
 *
 * Roda todo dia de manhã, uma vez, com a trava de `job_runs` valendo: duas
 * instâncias não mandam o mesmo aviso duas vezes. Cada assinatura avança no
 * máximo um estágio por dia, e nunca volta — o `dunningStage` é o que impede o
 * cliente de receber cinco e-mails iguais numa semana e passar a filtrar o
 * remetente justamente antes da suspensão.
 */
@Injectable()
export class DunningJob {
  private readonly logger = new Logger(DunningJob.name)

  constructor(
    private readonly locks: JobLockService,
    private readonly systemScope: SystemScope,
    private readonly mail: MailService,
    private readonly statusService: SubscriptionStatusService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // 8h: uma hora antes do job de trial, para não disputar conexão com ele.
  @Cron('0 8 * * *', { name: JOB_DUNNING, timeZone: 'America/Sao_Paulo' })
  async diariamente(): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) return
    await this.executar()
  }

  async executar(referencia = new Date()): Promise<void> {
    await this.locks.run(JOB_DUNNING, chaveDoDia(referencia), async () => {
      const inadimplentes = await this.systemScope.run('jobs.dunning.listar', (manager) =>
        manager.getRepository(Subscription).find({
          where: {
            status: In([SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED]),
          },
        }),
      )

      let avisos = 0
      let suspensas = 0
      let canceladas = 0

      for (const assinatura of inadimplentes) {
        if (!assinatura.pastDueSince) continue

        const dias = diasDesde(assinatura.pastDueSince, referencia)
        const passo = proximoPasso(dias, assinatura.dunningStage)
        if (!passo) continue

        await this.systemScope.run('jobs.dunning.aplicar', async (manager) => {
          const conta = await manager
            .getRepository(Tenant)
            .findOneOrFail({ where: { id: assinatura.tenantId } })

          if (passo.acao === 'aviso') {
            await this.avisar(manager, conta, assinatura, dias)
            avisos += 1
          }

          if (passo.acao === 'suspender') {
            await this.suspender(manager, conta, assinatura)
            suspensas += 1
          }

          if (passo.acao === 'cancelar') {
            await this.cancelar(manager, conta, assinatura)
            canceladas += 1
          }

          await manager.getRepository(Subscription).update(assinatura.id, {
            dunningStage: passo.estagio,
            lastDunningAt: referencia,
          })
        })
      }

      return `${avisos} aviso(s), ${suspensas} suspensa(s), ${canceladas} cancelada(s)`
    })
  }

  // ─── Passos ─────────────────────────────────────────────────────────────────

  private async avisar(
    manager: EntityManager,
    conta: Tenant,
    assinatura: Subscription,
    dias: number,
  ): Promise<void> {
    await this.notificar(manager, conta, (nome) =>
      cobrancaEmAtraso({
        nome,
        conta: conta.name,
        diasEmAtraso: dias,
        suspendeEm: new Date(
          (assinatura.pastDueSince as Date).getTime() + DIA_DA_SUSPENSAO * 86_400_000,
        ),
        url: this.urlDaAssinatura(),
      }),
    )
  }

  private async suspender(
    manager: EntityManager,
    conta: Tenant,
    assinatura: Subscription,
  ): Promise<void> {
    await manager
      .getRepository(Subscription)
      .update(assinatura.id, { status: SubscriptionStatus.SUSPENDED })

    const atualizada = await manager
      .getRepository(Subscription)
      .findOneOrFail({ where: { id: assinatura.id } })

    await this.statusService.sincronizarConta(manager, atualizada)
    await this.notificar(manager, conta, (nome) =>
      contaSuspensa({ nome, conta: conta.name, url: this.urlDaAssinatura() }),
    )

    this.logger.warn(
      { tenantId: conta.id },
      'conta suspensa por inadimplência — escrita bloqueada, leitura preservada',
    )
  }

  private async cancelar(
    manager: EntityManager,
    conta: Tenant,
    assinatura: Subscription,
  ): Promise<void> {
    await manager.getRepository(Subscription).update(assinatura.id, {
      status: SubscriptionStatus.CANCELED,
      canceledAt: new Date(),
      // Sem período restante: quem chegou aqui não pagou nenhum. Sem isto, a
      // regra de "cancelado mas pago até o fim do mês" reabriria a conta.
      currentPeriodEnd: null,
    })

    const atualizada = await manager
      .getRepository(Subscription)
      .findOneOrFail({ where: { id: assinatura.id } })

    await this.statusService.sincronizarConta(manager, atualizada)
    await this.notificar(manager, conta, (nome) =>
      assinaturaCancelada({ nome, conta: conta.name, ate: null, url: this.urlDaAssinatura() }),
    )

    this.logger.warn({ tenantId: conta.id }, 'assinatura cancelada por inadimplência prolongada')
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private async notificar(
    manager: EntityManager,
    conta: Tenant,
    conteudo: (nome: string) => Parameters<MailService['send']>[1],
  ): Promise<void> {
    // Conta já expirada por fim de teste não recebe cobrança de dunning: ela
    // nunca teve assinatura para atrasar, e receber "sua conta será suspensa"
    // depois de já estar em somente leitura só confunde.
    if (conta.status === TenantStatus.EXPIRED) return

    const titulares = await destinatarios(manager, conta.id, PAPEIS_DE_COBRANCA)
    if (titulares.length === 0) {
      this.logger.warn({ tenantId: conta.id }, 'conta sem titular ativo — ninguém para avisar')
      return
    }

    for (const titular of titulares) {
      await this.mail.send(titular.email, conteudo(titular.name))
    }
  }

  private urlDaAssinatura(): string {
    return `${this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '')}/assinatura`
  }
}

// ─── Funções puras ────────────────────────────────────────────────────────────

export function diasDesde(inicio: Date, agora: Date): number {
  return Math.floor((agora.getTime() - inicio.getTime()) / 86_400_000)
}

/**
 * O passo devido hoje, ou `null` quando não há.
 *
 * Pega o passo mais avançado que a régua já permite e que ainda não foi dado —
 * assim uma conta que ficou dias sem o job rodando (deploy, instância parada)
 * não recebe três e-mails atrasados de uma vez, e sim o que faz sentido agora.
 */
export function proximoPasso(
  diasEmAtraso: number,
  estagioAtual: number,
): (typeof REGUA)[number] | null {
  const devidos = REGUA.filter((p) => diasEmAtraso >= p.dia && p.estagio > estagioAtual)
  return devidos.length > 0 ? devidos[devidos.length - 1] : null
}

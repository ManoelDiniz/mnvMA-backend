import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DataSource } from 'typeorm'
import { AppModule } from '../../app.module'
import { Plan } from '../../modules/billing/entities/plan.entity'
import { MercadoPagoClient } from '../../modules/billing/mercadopago/mercadopago.client'

/**
 * Espelha o catálogo de planos do MNVMA na conta do Mercado Pago.
 *
 *     npm run seed:mp            # cria o que falta
 *     npm run seed:mp -- --dry   # só mostra o que faria
 *
 * Roda uma vez por ambiente, com as credenciais daquele ambiente. O id devolvido
 * fica em `plans.mp_preapproval_plan_id` — é ele que o checkout usa.
 *
 * Duas regras que este script respeita e que valem para sempre:
 *
 *   • **Plano que já tem id não é tocado.** Alterar o valor de um
 *     `preapproval_plan` existente afeta quem já assinou. Mudança de preço é
 *     plano novo (ver `03-mercado-pago.md` §3), nunca edição do antigo.
 *   • **Plano gratuito não vai para o provedor.** Ele é só estado nosso.
 */
async function main(): Promise<void> {
  const logger = new Logger('seed:mp')
  const simulacao = process.argv.includes('--dry')

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  })

  try {
    const mp = app.get(MercadoPagoClient)
    const dataSource = app.get(DataSource)

    if (!mp.enabled) {
      logger.error('MP_ACCESS_TOKEN não configurado — nada a fazer.')
      process.exitCode = 1
      return
    }

    const repo = dataSource.getRepository(Plan)
    const planos = await repo.find({ where: { isActive: true }, order: { sortOrder: 'ASC' } })

    let criados = 0

    for (const plano of planos) {
      if (plano.priceCents === 0) {
        logger.log(`· ${plano.code}: gratuito, não vai para o Mercado Pago`)
        continue
      }

      if (plano.mpPreapprovalPlanId) {
        logger.log(`· ${plano.code}: já espelhado (${plano.mpPreapprovalPlanId})`)
        continue
      }

      const corpo: Record<string, unknown> = {
        reason: `MNVMA Care — ${plano.name}`,
        auto_recurring: {
          frequency: plano.intervalCount,
          frequency_type: plano.interval,
          transaction_amount: Number((plano.priceCents / 100).toFixed(2)),
          currency_id: 'BRL',
          // O trial de verdade é controlado pelo MNVMA (`tenant.trialEndsAt`).
          // Este aqui só evita cobrar duas vezes o mesmo mês de quem assina
          // ainda dentro do período de teste.
          ...(plano.trialDays > 0
            ? { free_trial: { frequency: plano.trialDays, frequency_type: 'days' } }
            : {}),
        },
        back_url: mp.backUrl,
        payment_methods_allowed: {
          // Recorrência automática exige cartão: Pix e boleto não sustentam
          // débito recorrente em assinatura.
          payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }],
        },
      }

      if (simulacao) {
        logger.log(`· ${plano.code}: criaria ${JSON.stringify(corpo)}`)
        continue
      }

      const criado = await mp.criarPreapprovalPlan(corpo, `plan-${plano.id}`)
      await repo.update(plano.id, { mpPreapprovalPlanId: criado.id })

      criados += 1
      logger.log(`✔ ${plano.code}: criado no Mercado Pago (${criado.id})`)
    }

    logger.log(simulacao ? 'simulação concluída' : `${criados} plano(s) espelhado(s)`)
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error('falha ao espelhar planos no Mercado Pago:', error)
  process.exit(1)
})

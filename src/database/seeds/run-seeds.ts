import 'reflect-metadata'
import dataSource from '../../data-source'
import { seedPlans } from './plans.seed'

/**
 * `npm run seed` — idempotente: pode rodar quantas vezes quiser.
 * Popula o catálogo de planos, que precisa existir antes do primeiro cadastro
 * (é dele que sai a assinatura em trial).
 */
async function main(): Promise<void> {
  await dataSource.initialize()

  try {
    await seedPlans(dataSource)
    console.warn('✔ planos populados')
  } finally {
    await dataSource.destroy()
  }
}

main().catch((error: unknown) => {
  console.error('falha ao rodar seeds:', error)
  process.exit(1)
})

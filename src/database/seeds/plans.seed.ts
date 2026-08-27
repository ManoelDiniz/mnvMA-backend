import type { DataSource } from 'typeorm'
import { TenantType } from '../../common/enums/tenant.enum'
import { Plan } from '../../modules/billing/entities/plan.entity'

/**
 * Catálogo inicial (§19 do planejamento de produto). Os limites ficam aqui só
 * como ponto de partida — o Super Admin edita pelo MNVMA Core sem deploy.
 *
 * `mpPreapprovalPlanId` fica nulo: é preenchido no Sprint 7, quando os planos
 * correspondentes forem criados na conta do Mercado Pago.
 */
export const PLAN_SEEDS: Array<Partial<Plan>> = [
  {
    code: 'individual_free',
    name: 'Individual Free',
    description: 'Para começar a organizar a agenda e os clientes.',
    tenantType: TenantType.INDIVIDUAL,
    priceCents: 0,
    trialDays: 0,
    maxCustomers: 5,
    maxShiftsPerMonth: 30,
    maxCaregivers: 1,
    maxUsers: 1,
    features: { reports: 'basic', documents: false, export: false },
    sortOrder: 1,
  },
  {
    code: 'individual_pro',
    name: 'Individual Pro',
    description: 'Clientes e plantões ilimitados, financeiro completo e relatórios.',
    tenantType: TenantType.INDIVIDUAL,
    priceCents: 4990,
    trialDays: 14,
    maxCustomers: null,
    maxShiftsPerMonth: null,
    maxCaregivers: 1,
    maxUsers: 1,
    features: { reports: 'full', documents: true, export: true, notifications: true },
    sortOrder: 2,
  },
  {
    code: 'company_start',
    name: 'Empresarial Start',
    description: 'Até 10 cuidadores, escalas, contratos e rentabilidade.',
    tenantType: TenantType.COMPANY,
    priceCents: 14900,
    trialDays: 14,
    maxCustomers: null,
    maxCaregivers: 10,
    maxShiftsPerMonth: null,
    maxUsers: 5,
    features: { reports: 'full', documents: true, export: true, profitability: true },
    sortOrder: 3,
  },
  {
    code: 'company_pro',
    name: 'Empresarial Pro',
    description: 'Até 30 cuidadores e usuários ilimitados.',
    tenantType: TenantType.COMPANY,
    priceCents: 34900,
    trialDays: 14,
    maxCaregivers: 30,
    maxUsers: null,
    features: { reports: 'full', documents: true, export: true, profitability: true },
    sortOrder: 4,
  },
  {
    code: 'company_business',
    name: 'Empresarial Business',
    description: 'Até 100 cuidadores, com suporte prioritário.',
    tenantType: TenantType.COMPANY,
    priceCents: 79900,
    trialDays: 14,
    maxCaregivers: 100,
    maxUsers: null,
    features: {
      reports: 'full',
      documents: true,
      export: true,
      profitability: true,
      prioritySupport: true,
    },
    sortOrder: 5,
  },
]

export async function seedPlans(dataSource: DataSource): Promise<void> {
  const repo = dataSource.getRepository(Plan)

  for (const seed of PLAN_SEEDS) {
    const existing = await repo.findOne({ where: { code: seed.code } })
    // Preço e limites de um plano já publicado não são sobrescritos: mexer neles
    // afeta quem já assinou. Alteração de preço = plano novo (ver 03, seção 3).
    if (existing) continue
    await repo.save(repo.create(seed))
  }
}

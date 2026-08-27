import type { DataSource } from 'typeorm'
import type { Plan } from './entities/plan.entity'
import { PlanLimitsService, limiteDe, type UsoAtual } from './plan-limits.service'

const service = new PlanLimitsService(null as unknown as DataSource)

const plano = (limites: Partial<Plan>): Plan =>
  ({ name: 'Empresarial Start', ...limites }) as Plan

const uso = (parcial: Partial<UsoAtual> = {}): UsoAtual => ({
  customers: 0,
  caregivers: 0,
  users: 0,
  shiftsPerMonth: 0,
  ...parcial,
})

describe('limites do plano', () => {
  it('null é ilimitado', () => {
    const ilimitado = plano({ maxCaregivers: null, maxCustomers: null })
    expect(limiteDe(ilimitado, 'caregivers')).toBeNull()
    expect(service.naoCabe(ilimitado, uso({ caregivers: 5000 }))).toEqual([])
  })

  it('acusa o que não cabe, com número usado e limite', () => {
    const start = plano({ maxCaregivers: 10, maxUsers: 5 })

    expect(service.naoCabe(start, uso({ caregivers: 40, users: 2 }))).toEqual([
      { recurso: 'caregivers', usado: 40, limite: 10 },
    ])
  })

  it('acusa mais de um estouro de uma vez', () => {
    const start = plano({ maxCaregivers: 10, maxUsers: 5 })
    const excedidos = service.naoCabe(start, uso({ caregivers: 40, users: 9 }))

    expect(excedidos).toHaveLength(2)
    expect(service.explicar(excedidos)).toBe(
      '40 cuidadores — o plano permite 10; 9 usuários — o plano permite 5',
    )
  })

  it('estar exatamente no limite ainda cabe — o downgrade é permitido', () => {
    expect(service.naoCabe(plano({ maxCaregivers: 10 }), uso({ caregivers: 10 }))).toEqual([])
  })

  it('mas não sobra vaga para mais um', () => {
    const start = plano({ maxCaregivers: 10 })
    expect(service.cabeMaisUm(start, 'caregivers', uso({ caregivers: 10 }))).toBe(false)
    expect(service.cabeMaisUm(start, 'caregivers', uso({ caregivers: 9 }))).toBe(true)
  })

  it('sem plano, não barra ninguém', () => {
    // Conta sem catálogo é problema de instalação; virar 402 esconderia isso
    // atrás de uma tela de upgrade.
    expect(service.cabeMaisUm(null, 'customers', uso({ customers: 999 }))).toBe(true)
  })

  it('sem estouro, não há o que explicar', () => {
    expect(service.explicar([])).toBeNull()
  })
})

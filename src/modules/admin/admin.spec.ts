import { TenantStatus } from '../../common/enums/tenant.enum'
import type { Tenant } from '../tenants/entities/tenant.entity'
import { estadoAoReativar } from './admin.service'

const agora = new Date('2026-08-26T12:00:00Z')
const daquiATresDias = new Date('2026-08-29T12:00:00Z')
const semanaPassada = new Date('2026-08-19T12:00:00Z')

const conta = (trialEndsAt: Date | null): Tenant => ({ trialEndsAt }) as Tenant

/**
 * A regra da reativação é curta e cara de errar: um `ACTIVE` devolvido por
 * engano é o produto liberado de graça, sem cobrança e sem prazo para acabar.
 */
describe('estado da conta ao reativar', () => {
  it('com período concedido, volta a valer', () => {
    expect(
      estadoAoReativar(conta(null), { periodoConcedido: true }, agora),
    ).toBe(TenantStatus.ACTIVE)
  })

  it('sem período concedido, cai no teste que ainda tem prazo', () => {
    expect(
      estadoAoReativar(conta(daquiATresDias), { periodoConcedido: false }, agora),
    ).toBe(TenantStatus.TRIAL)
  })

  it('sem período e com o teste vencido, volta a "precisa assinar"', () => {
    expect(
      estadoAoReativar(conta(semanaPassada), { periodoConcedido: false }, agora),
    ).toBe(TenantStatus.EXPIRED)
  })

  it('conta sem teste nenhum também vai para EXPIRED, nunca para ACTIVE', () => {
    // É o caminho de quem já foi cliente pagante e parou: reativar não pode
    // presentear um mês.
    expect(
      estadoAoReativar(conta(null), { periodoConcedido: false }, agora),
    ).toBe(TenantStatus.EXPIRED)
  })
})

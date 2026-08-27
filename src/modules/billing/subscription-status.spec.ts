import { SubscriptionStatus, TenantStatus } from '../../common/enums/tenant.enum'
import type { TenantStatusCache } from '../../common/services/tenant-status.cache'
import type { Subscription } from './entities/subscription.entity'
import {
  SubscriptionStatusService,
  periodoAindaVale,
  traduzirStatusDoProvedor,
} from './subscription-status.service'
import { proximoMes, traduzirStatusDaCobranca } from './webhook-processor.service'

const cacheFalso = { invalidate: () => undefined } as unknown as TenantStatusCache
const service = new SubscriptionStatusService(cacheFalso)

const assinatura = (dados: Partial<Subscription>): Subscription =>
  ({ status: SubscriptionStatus.TRIAL, ...dados }) as Subscription

describe('tradução dos estados do provedor', () => {
  it('mapeia os três estados que mudam a vida da conta', () => {
    expect(traduzirStatusDoProvedor('authorized')).toBe(SubscriptionStatus.ACTIVE)
    expect(traduzirStatusDoProvedor('paused')).toBe(SubscriptionStatus.PAST_DUE)
    expect(traduzirStatusDoProvedor('cancelled')).toBe(SubscriptionStatus.CANCELED)
  })

  it('ignora `pending`: checkout aberto e abandonado não libera nada', () => {
    expect(traduzirStatusDoProvedor('pending')).toBeNull()
    expect(traduzirStatusDoProvedor(undefined)).toBeNull()
    expect(traduzirStatusDoProvedor('inventado')).toBeNull()
  })
})

describe('estado da conta a partir da assinatura', () => {
  it('assinatura ativa libera a conta', () => {
    expect(
      service.statusDaConta(assinatura({ status: SubscriptionStatus.ACTIVE }), TenantStatus.TRIAL),
    ).toBe(TenantStatus.ACTIVE)
  })

  it('inadimplente continua escrevendo — o bloqueio vem só na suspensão', () => {
    expect(
      service.statusDaConta(
        assinatura({ status: SubscriptionStatus.PAST_DUE }),
        TenantStatus.ACTIVE,
      ),
    ).toBe(TenantStatus.PAST_DUE)
  })

  it('não transforma teste vencido em "suspenso por falta de pagamento"', () => {
    // Quem nunca chegou a assinar não pode receber a mensagem de inadimplência.
    expect(
      service.statusDaConta(
        assinatura({ status: SubscriptionStatus.SUSPENDED }),
        TenantStatus.EXPIRED,
      ),
    ).toBe(TenantStatus.EXPIRED)

    expect(
      service.statusDaConta(
        assinatura({ status: SubscriptionStatus.SUSPENDED }),
        TenantStatus.ACTIVE,
      ),
    ).toBe(TenantStatus.SUSPENDED)
  })

  it('cancelamento respeita o período já pago', () => {
    const amanha = new Date(Date.now() + 86_400_000)
    const ontem = new Date(Date.now() - 86_400_000)

    expect(
      service.statusDaConta(
        assinatura({ status: SubscriptionStatus.CANCELED, currentPeriodEnd: amanha }),
        TenantStatus.ACTIVE,
      ),
    ).toBe(TenantStatus.ACTIVE)

    expect(
      service.statusDaConta(
        assinatura({ status: SubscriptionStatus.CANCELED, currentPeriodEnd: ontem }),
        TenantStatus.ACTIVE,
      ),
    ).toBe(TenantStatus.CANCELED)
  })

  it('trial vencido não volta a ser trial pelo estado da assinatura', () => {
    expect(
      service.statusDaConta(assinatura({ status: SubscriptionStatus.TRIAL }), TenantStatus.EXPIRED),
    ).toBe(TenantStatus.EXPIRED)
  })
})

describe('período ainda vale', () => {
  it('é falso sem data e depois do vencimento', () => {
    expect(periodoAindaVale(assinatura({}))).toBe(false)
    expect(
      periodoAindaVale(assinatura({ currentPeriodEnd: new Date('2020-01-01T00:00:00Z') })),
    ).toBe(false)
    expect(
      periodoAindaVale(assinatura({ currentPeriodEnd: new Date(Date.now() + 1000) })),
    ).toBe(true)
  })
})

describe('estado da cobrança recorrente', () => {
  it('lê o status de dentro do pagamento, que é o que traz a recusa', () => {
    expect(
      traduzirStatusDaCobranca({ id: 1, status: 'processed', payment: { status: 'rejected' } }),
    ).toBe('REJECTED')

    expect(traduzirStatusDaCobranca({ id: 1, payment: { status: 'approved' } })).toBe('APPROVED')
  })

  it('o que não conhece vira pendente, nunca aprovado', () => {
    // Errar para "aprovado" liberaria conta sem dinheiro ter entrado.
    expect(traduzirStatusDaCobranca({ id: 1, status: 'coisa_nova' })).toBe('PENDING')
    expect(traduzirStatusDaCobranca({ id: 1 })).toBe('PENDING')
  })
})

describe('próximo mês', () => {
  it('preserva o dia', () => {
    expect(proximoMes(new Date('2026-08-10T12:00:00Z')).toISOString()).toBe(
      '2026-09-10T12:00:00.000Z',
    )
  })

  it('dia 31 em mês de 30 cai no último dia, não no mês seguinte', () => {
    expect(proximoMes(new Date('2026-08-31T12:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-09-30',
    )
  })

  it('atravessa a virada do ano', () => {
    expect(proximoMes(new Date('2026-12-15T12:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2027-01-15',
    )
  })
})

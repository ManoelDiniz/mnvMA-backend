import { createHmac } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { DataSource } from 'typeorm'

// O segredo precisa existir ANTES de o ConfigModule ler o ambiente: é ele que
// liga a conferência de assinatura do webhook, que é o que esta suíte testa.
const SEGREDO = 'segredo-e2e-do-webhook'
process.env.MP_WEBHOOK_SECRET = SEGREDO

import { AppModule } from '../src/app.module'
import { SubscriptionStatus, TenantStatus, TenantType } from '../src/common/enums/tenant.enum'
import { TenantStatusCache } from '../src/common/services/tenant-status.cache'
import { MercadoPagoClient } from '../src/modules/billing/mercadopago/mercadopago.client'
import type {
  MpAuthorizedPayment,
  MpPreapproval,
} from '../src/modules/billing/mercadopago/mercadopago.types'
import { WebhookQueue } from '../src/modules/billing/webhook-queue.service'

/**
 * O provedor, de mentira.
 *
 * A suíte inteira depende de poder dizer "agora o Mercado Pago responde
 * `authorized`" sem rede e sem conta em provedor nenhum. O que se testa aqui
 * não é o Mercado Pago: é o que o MNVMA faz com o que ele responde — e é aí
 * que mora o risco de liberar conta sem dinheiro ou cobrar duas vezes.
 */
class MercadoPagoFalso {
  enabled = true
  backUrl = 'http://localhost:5173/assinatura/retorno'
  notificationUrl = 'http://localhost:3000/v1/webhooks/mercadopago'

  /** Prefixo único por execução: leftovers de uma rodada anterior não colidem. */
  prefixo = 'pre'
  preapprovals = new Map<string, MpPreapproval>()
  cobrancas = new Map<string, MpAuthorizedPayment>()
  atualizacoes: Array<{ id: string; body: Record<string, unknown> }> = []
  chavesDeIdempotencia: string[] = []

  criarPreapproval(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<MpPreapproval> {
    this.chavesDeIdempotencia.push(idempotencyKey)

    const id = `${this.prefixo}-${this.preapprovals.size + 1}`
    const criado: MpPreapproval = {
      id,
      status: 'pending',
      external_reference: typeof body.external_reference === 'string' ? body.external_reference : '',
      init_point: `https://mercadopago.com/checkout/${id}`,
    }

    this.preapprovals.set(id, criado)
    return Promise.resolve(criado)
  }

  buscarPreapproval(id: string): Promise<MpPreapproval> {
    const encontrado = this.preapprovals.get(id)
    if (!encontrado) return Promise.reject(new Error(`preapproval ${id} inexistente`))
    return Promise.resolve(encontrado)
  }

  atualizarPreapproval(id: string, body: Record<string, unknown>): Promise<MpPreapproval> {
    this.atualizacoes.push({ id, body })
    const atual = this.preapprovals.get(id)
    if (atual && typeof body.status === 'string') {
      atual.status = body.status as MpPreapproval['status']
    }
    return Promise.resolve(atual ?? { id })
  }

  buscarAuthorizedPayment(id: string): Promise<MpAuthorizedPayment> {
    const encontrada = this.cobrancas.get(id)
    if (!encontrada) return Promise.reject(new Error(`cobrança ${id} inexistente`))
    return Promise.resolve(encontrada)
  }

  criarPreapprovalPlan(): Promise<{ id: string }> {
    return Promise.resolve({ id: 'plan-mp-1' })
  }

  buscarPreapprovalPlan(): Promise<{ id: string }> {
    return Promise.resolve({ id: 'plan-mp-1' })
  }

  buscarPayment(): Promise<{ id: string }> {
    return Promise.resolve({ id: 'pay-1' })
  }
}

/**
 * A cobrança é a superfície mais perigosa do produto: uma rota pública que, se
 * errada, libera o sistema de graça ou cobra alguém duas vezes. Esta suíte é o
 * que impede as duas coisas, e cobre os cenários de `03-mercado-pago.md` §9:
 *
 *   • assinatura aprovada → conta liberada
 *   • assinatura sem webhook → conta NÃO liberada (o retorno do navegador não vale)
 *   • webhook com assinatura inválida → 401 e nada muda no banco
 *   • webhook duplicado → processa uma vez só
 *   • webhook fora de ordem → estado final correto
 *   • recorrência recusada → dunning começa
 *   • cancelamento → acesso até o fim do período pago
 *   • webhook órfão → registrado, sem quebrar
 *   • conta suspensa → ainda consegue pagar (senão é beco sem saída)
 *
 * Pré-requisito: MySQL de teste acessível (`npm run test:e2e`).
 */
describe('Cobrança e assinatura (e2e)', () => {
  let app: INestApplication
  let dataSource: DataSource
  let mp: MercadoPagoFalso
  let fila: WebhookQueue
  let cacheDeStatus: TenantStatusCache

  const carimbo = Date.now()

  const empresa = {
    name: 'Regina Diretora',
    email: `regina.${carimbo}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.COMPANY,
    companyName: 'Cuidados Regina ME',
  }

  /** Recursos do provedor nesta execução. Únicos para a suíte poder rodar de novo. */
  const cobrancaRecusadaId = `cob-${carimbo}-1`
  const cobrancaAprovadaId = `cob-${carimbo}-2`
  const preapprovalOrfaoId = `pre-orfao-${carimbo}`

  let token: string
  let tenantId: string
  let subscriptionId: string
  let preapprovalId: string
  let planoStartId: string

  const post = (url: string, comToken = true) => {
    const req = request(app.getHttpServer()).post(url)
    return comToken ? req.set('Authorization', `Bearer ${token}`) : req
  }

  const get = (url: string) =>
    request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`)

  /** Monta o manifesto exatamente como o provedor faz. */
  const assinaturaValida = (dataId: string, requestId: string, segredo = SEGREDO): string => {
    const ts = String(Math.floor(Date.now() / 1000))
    const manifesto = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`
    const v1 = createHmac('sha256', segredo).update(manifesto).digest('hex')
    return `ts=${ts},v1=${v1}`
  }

  /** Dispara o webhook e espera o processamento em segundo plano terminar. */
  const notificar = async (
    tipo: string,
    recurso: string,
    opcoes: { segredo?: string; esperado?: number } = {},
  ) => {
    const requestId = `req-${Math.random().toString(36).slice(2)}`

    const resposta = await request(app.getHttpServer())
      .post(`/v1/webhooks/mercadopago?data.id=${recurso}&type=${tipo}`)
      .set('x-signature', assinaturaValida(recurso, requestId, opcoes.segredo))
      .set('x-request-id', requestId)
      .send({ type: tipo, action: 'updated', data: { id: recurso } })
      .expect(opcoes.esperado ?? 200)

    await fila.ocioso()
    return resposta
  }

  const assinaturaNoBanco = async () => {
    const [linha] = await dataSource.query<
      Array<{
        id: string
        status: SubscriptionStatus
        dunning_stage: number
        past_due_since: Date | null
        current_period_end: Date | null
        mp_preapproval_id: string | null
      }>
    >('SELECT * FROM subscriptions WHERE tenant_id = ?', [tenantId])
    return linha
  }

  const statusDaConta = async (): Promise<TenantStatus> => {
    const [linha] = await dataSource.query<Array<{ status: TenantStatus }>>(
      'SELECT status FROM tenants WHERE id = ?',
      [tenantId],
    )
    return linha.status
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoClient)
      .useValue(Object.assign(new MercadoPagoFalso(), { prefixo: `pre-${carimbo}` }))
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('v1')
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()

    dataSource = app.get(DataSource)
    mp = app.get<unknown>(MercadoPagoClient) as MercadoPagoFalso
    fila = app.get(WebhookQueue)
    cacheDeStatus = app.get(TenantStatusCache)

    const sessao = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send(empresa)
      .expect(201)

    token = sessao.body.accessToken
    tenantId = sessao.body.tenant.id
  })

  afterAll(async () => {
    await dataSource.query('SET @mnvma_system_scope = 1')
    // Com `FOREIGN_KEY_CHECKS = 0` o `ON DELETE CASCADE` não dispara: apagar só
    // o tenant deixaria a assinatura para trás, e o `mp_preapproval_id` dela é
    // único no banco — a próxima execução da suíte esbarraria nele.
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 0')
    await dataSource.query(
      'DELETE FROM webhook_events WHERE tenant_id = ? OR event_id IN (?, ?, ?)',
      [tenantId, cobrancaRecusadaId, cobrancaAprovadaId, preapprovalOrfaoId],
    )
    for (const tabela of [
      'subscription_payments',
      'subscriptions',
      'customers',
      'refresh_tokens',
      'users',
      'caregivers',
    ]) {
      await dataSource.query(`DELETE FROM ${tabela} WHERE tenant_id = ?`, [tenantId])
    }
    await dataSource.query('DELETE FROM tenants WHERE id = ?', [tenantId])
    await dataSource.query("DELETE FROM plans WHERE code LIKE 'e2e%'")
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 1')
    await app.close()
  })

  // ─── Catálogo ───────────────────────────────────────────────────────────────

  it('lista só os planos do tipo da conta, com preço formatado', async () => {
    const resposta = await get('/v1/billing/plans').expect(200)

    expect(resposta.body.length).toBeGreaterThan(0)
    expect(resposta.body.every((p: { tenantType: string }) => p.tenantType === 'COMPANY')).toBe(
      true,
    )

    const start = resposta.body.find((p: { code: string }) => p.code === 'company_start')
    expect(start).toMatchObject({ price: '149.00', available: true })
    planoStartId = start.id
  })

  it('a conta nasce em teste, podendo escrever', async () => {
    const resposta = await get('/v1/billing/subscription').expect(200)

    expect(resposta.body.status).toBe(SubscriptionStatus.TRIAL)
    expect(resposta.body.tenantStatus).toBe(TenantStatus.TRIAL)
    expect(resposta.body.writable).toBe(true)
    expect(resposta.body.trialDaysLeft).toBeGreaterThan(0)

    subscriptionId = resposta.body.id
  })

  // ─── Assinar ────────────────────────────────────────────────────────────────

  it('assinar devolve o checkout e NÃO ativa a conta', async () => {
    const resposta = await post('/v1/billing/subscribe').send({ planId: planoStartId }).expect(200)

    expect(resposta.body.checkoutUrl).toContain('mercadopago.com/checkout/')
    expect(resposta.body.applied).toBe(false)

    // O ponto inteiro do desenho: quem ativa é o webhook. Se isto passar a
    // devolver ACTIVE, qualquer um monta a URL de retorno e usa de graça.
    expect(resposta.body.status).toBe(SubscriptionStatus.TRIAL)
    expect(await statusDaConta()).toBe(TenantStatus.TRIAL)

    const assinatura = await assinaturaNoBanco()
    expect(assinatura.mp_preapproval_id).toBeTruthy()
    preapprovalId = assinatura.mp_preapproval_id as string
  })

  it('a chave de idempotência amarra conta e plano, para timeout não criar duas assinaturas', () => {
    // O sufixo é a versão da assinatura: estável dentro de uma tentativa (as
    // retentativas do cliente HTTP reusam a mesma chave) e diferente na
    // tentativa seguinte, para quem reassina não receber de volta o checkout
    // cancelado da primeira vez.
    expect(mp.chavesDeIdempotencia[0]).toMatch(
      new RegExp(String.raw`^sub-${subscriptionId}-${planoStartId}-\d+$`),
    )
  })

  it('a assinatura mandada ao provedor referencia a nossa, que é a ponte de volta', () => {
    const criada = [...mp.preapprovals.values()][0]
    expect(criada.external_reference).toBe(subscriptionId)
  })

  // ─── Webhook ────────────────────────────────────────────────────────────────

  it('webhook com assinatura inválida devolve 401 e não muda nada', async () => {
    await notificar('subscription_preapproval', preapprovalId, {
      segredo: 'segredo-do-atacante',
      esperado: 401,
    })

    expect(await statusDaConta()).toBe(TenantStatus.TRIAL)

    const [evento] = await dataSource.query<Array<{ signature_ok: number; processed_at: Date }>>(
      'SELECT signature_ok, processed_at FROM webhook_events WHERE event_id = ? AND type = ?',
      [preapprovalId, 'subscription_preapproval'],
    )

    // Fica gravado como rastro de quem tentou — e nunca é processado.
    expect(evento.signature_ok).toBe(0)
    expect(evento.processed_at).toBeNull()
  })

  it('webhook válido de assinatura autorizada libera a conta', async () => {
    // A tentativa anterior gravou o evento com assinatura ruim; o provedor
    // reenvia o mesmo recurso, e é essa segunda chegada que precisa valer.
    await dataSource.query('DELETE FROM webhook_events WHERE event_id = ?', [preapprovalId])

    mp.preapprovals.get(preapprovalId)!.status = 'authorized'
    mp.preapprovals.get(preapprovalId)!.next_payment_date = new Date(
      Date.now() + 30 * 86_400_000,
    ).toISOString()

    await notificar('subscription_preapproval', preapprovalId)

    const assinatura = await assinaturaNoBanco()
    expect(assinatura.status).toBe(SubscriptionStatus.ACTIVE)
    expect(await statusDaConta()).toBe(TenantStatus.ACTIVE)
    expect(assinatura.current_period_end).not.toBeNull()
  })

  it('reenvio do mesmo evento não processa duas vezes', async () => {
    await notificar('subscription_preapproval', preapprovalId)

    const [linha] = await dataSource.query<Array<{ total: number; attempts: number }>>(
      'SELECT COUNT(*) AS total, MAX(attempts) AS attempts FROM webhook_events WHERE event_id = ? AND type = ?',
      [preapprovalId, 'subscription_preapproval'],
    )

    // Uma linha só (chave única) e uma tentativa só: a segunda chegada bateu
    // em `processed_at` e saiu de lado.
    expect(Number(linha.total)).toBe(1)
    expect(Number(linha.attempts)).toBe(1)
  })

  it('cobrança recusada começa o dunning sem bloquear a escrita', async () => {
    mp.cobrancas.set(cobrancaRecusadaId, {
      id: cobrancaRecusadaId,
      preapproval_id: preapprovalId,
      status: 'processed',
      transaction_amount: 149,
      debit_date: new Date().toISOString(),
      payment: { status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' },
    })

    await notificar('subscription_authorized_payment', cobrancaRecusadaId)

    const assinatura = await assinaturaNoBanco()
    expect(assinatura.status).toBe(SubscriptionStatus.PAST_DUE)
    expect(assinatura.dunning_stage).toBe(1)
    expect(assinatura.past_due_since).not.toBeNull()

    // Inadimplente ainda escreve: o bloqueio só chega no dia 7 do dunning.
    expect(await statusDaConta()).toBe(TenantStatus.PAST_DUE)

    const [pagamento] = await dataSource.query<
      Array<{ status: string; amount: string; status_detail: string }>
    >('SELECT status, amount, status_detail FROM subscription_payments WHERE mp_payment_id = ?', [
      cobrancaRecusadaId,
    ])

    expect(pagamento).toMatchObject({
      status: 'REJECTED',
      amount: '149.00',
      status_detail: 'cc_rejected_insufficient_amount',
    })
  })

  it('cobrança aprovada depois da recusa zera o dunning e reativa', async () => {
    mp.cobrancas.set(cobrancaAprovadaId, {
      id: cobrancaAprovadaId,
      preapproval_id: preapprovalId,
      transaction_amount: 149,
      debit_date: new Date().toISOString(),
      payment: { status: 'approved', payment_method_id: 'master' },
    })

    await notificar('subscription_authorized_payment', cobrancaAprovadaId)

    const assinatura = await assinaturaNoBanco()
    expect(assinatura.status).toBe(SubscriptionStatus.ACTIVE)
    expect(assinatura.dunning_stage).toBe(0)
    expect(assinatura.past_due_since).toBeNull()
    expect(await statusDaConta()).toBe(TenantStatus.ACTIVE)
  })

  it('reprocessar a mesma cobrança não duplica o extrato', async () => {
    await dataSource.query('UPDATE webhook_events SET processed_at = NULL WHERE event_id = ?', [
      cobrancaAprovadaId,
    ])

    await notificar('subscription_authorized_payment', cobrancaAprovadaId)

    const [linha] = await dataSource.query<Array<{ total: number }>>(
      'SELECT COUNT(*) AS total FROM subscription_payments WHERE mp_payment_id = ?',
      [cobrancaAprovadaId],
    )

    expect(Number(linha.total)).toBe(1)
  })

  it('o extrato aparece para a conta, do mais recente para o mais antigo', async () => {
    const resposta = await get('/v1/billing/payments').expect(200)

    expect(resposta.body).toHaveLength(2)
    expect(resposta.body[0].status).toBe('APPROVED')
  })

  it('evento órfão fica registrado para conferência, sem quebrar', async () => {
    mp.preapprovals.set(preapprovalOrfaoId, {
      id: preapprovalOrfaoId,
      status: 'authorized',
      external_reference: '00000000-0000-4000-8000-000000000000',
    })

    await notificar('subscription_preapproval', preapprovalOrfaoId)

    const [evento] = await dataSource.query<
      Array<{ processed_at: Date | null; last_error: string; attempts: number }>
    >('SELECT processed_at, last_error, attempts FROM webhook_events WHERE event_id = ?', [
      preapprovalOrfaoId,
    ])

    // Ainda não é órfão declarado: pode ser corrida com o commit de quem criou
    // a assinatura. Fica pendente para o job de reconciliação tentar de novo.
    expect(evento.processed_at).toBeNull()
    expect(evento.last_error).toContain('assinatura não encontrada')
    expect(Number(evento.attempts)).toBe(1)
  })

  // ─── Suspensão e pagamento ──────────────────────────────────────────────────

  it('conta suspensa perde a escrita mas continua conseguindo pagar', async () => {
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query('UPDATE tenants SET status = ? WHERE id = ?', [
      TenantStatus.SUSPENDED,
      tenantId,
    ])
    cacheDeStatus.invalidate(tenantId)

    // Escrita comum bloqueada…
    await post('/v1/customers')
      .send({ name: 'Cliente Qualquer', birthDate: '1940-01-01' })
      .expect(403)

    // …e a leitura preservada.
    await get('/v1/customers').expect(200)

    // Mas a rota que resolve a suspensão precisa continuar aberta, senão o
    // cliente fica trancado do lado de fora do próprio pagamento.
    await get('/v1/billing/plans').expect(200)
    await post('/v1/billing/sync').expect(200)

    await dataSource.query('UPDATE tenants SET status = ? WHERE id = ?', [
      TenantStatus.ACTIVE,
      tenantId,
    ])
    cacheDeStatus.invalidate(tenantId)
  })

  // ─── Cancelamento ───────────────────────────────────────────────────────────

  it('cancelar mantém a conta funcionando até o fim do período pago', async () => {
    const resposta = await post('/v1/billing/cancel')
      .send({ reason: 'fechando a empresa' })
      .expect(200)

    expect(resposta.body.status).toBe(SubscriptionStatus.CANCELED)
    // Pagou até o fim do mês: usa até o fim do mês.
    expect(resposta.body.tenantStatus).toBe(TenantStatus.ACTIVE)
    expect(resposta.body.writable).toBe(true)

    expect(mp.atualizacoes.at(-1)).toMatchObject({ body: { status: 'cancelled' } })
  })

  it('período vencido depois do cancelamento fecha a conta para escrita', async () => {
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query(
      'UPDATE subscriptions SET current_period_end = ? WHERE tenant_id = ?',
      [new Date(Date.now() - 86_400_000), tenantId],
    )

    // O provedor confirma o cancelamento; o webhook reavalia o estado da conta.
    mp.preapprovals.get(preapprovalId)!.status = 'cancelled'
    await dataSource.query('DELETE FROM webhook_events WHERE event_id = ?', [preapprovalId])
    await notificar('subscription_preapproval', preapprovalId)

    expect(await statusDaConta()).toBe(TenantStatus.CANCELED)

    // Somente leitura, com os dados todos preservados.
    await get('/v1/customers').expect(200)
    await post('/v1/customers').send({ name: 'Não Deve Entrar' }).expect(403)
  })

  // ─── Limites de plano ───────────────────────────────────────────────────────

  it('estourar o limite do plano devolve 402 com o que a tela precisa mostrar', async () => {
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query(
      `INSERT INTO plans (id, code, name, tenant_type, price_cents, \`interval\`, interval_count,
                          trial_days, max_customers, is_active, sort_order)
       VALUES ('e2e0aa01-0000-4000-8000-000000000001', 'e2e_um_cliente', 'E2E Um Cliente', 'COMPANY', 100, 'months', 1, 0, 1, 0, 99)`,
    )

    const [plano] = await dataSource.query<Array<{ id: string }>>(
      "SELECT id FROM plans WHERE code = 'e2e_um_cliente'",
    )

    await dataSource.query('UPDATE subscriptions SET plan_id = ? WHERE tenant_id = ?', [
      plano.id,
      tenantId,
    ])
    await dataSource.query('UPDATE tenants SET status = ? WHERE id = ?', [
      TenantStatus.ACTIVE,
      tenantId,
    ])
    cacheDeStatus.invalidate(tenantId)

    await post('/v1/customers').send({ name: 'Primeira Cliente' }).expect(201)

    const bloqueado = await post('/v1/customers').send({ name: 'Segunda Cliente' }).expect(402)

    // 402 e não 403: existe caminho para resolver, e é o que abre o modal de
    // upgrade com o plano certo já escolhido.
    expect(bloqueado.body.error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      resource: 'customers',
      limit: 1,
      used: 1,
    })
  })

  it('durante o teste não existe limite de plano', async () => {
    // A conta nasce no plano mais apertado do catálogo; cobrar os limites dele
    // no trial quebraria a promessa de "14 dias com tudo liberado" — e é o
    // cenário mais fácil de regredir sem ninguém perceber.
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query('UPDATE tenants SET status = ? WHERE id = ?', [
      TenantStatus.TRIAL,
      tenantId,
    ])
    cacheDeStatus.invalidate(tenantId)

    await post('/v1/customers').send({ name: 'Cliente Durante o Teste' }).expect(201)

    await dataSource.query('UPDATE tenants SET status = ? WHERE id = ?', [
      TenantStatus.ACTIVE,
      tenantId,
    ])
    cacheDeStatus.invalidate(tenantId)
  })

  it('a tela de planos desabilita o que não comporta o uso atual', async () => {
    const resposta = await get('/v1/billing/plans').expect(200)
    const start = resposta.body.find((p: { code: string }) => p.code === 'company_start')

    // O plano grande continua disponível…
    expect(start.available).toBe(true)

    // …e assinar um que não cabe é recusado com a explicação pronta.
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query(
      `INSERT INTO plans (id, code, name, tenant_type, price_cents, \`interval\`, interval_count,
                          trial_days, max_customers, is_active, sort_order)
       VALUES ('e2e0aa01-0000-4000-8000-000000000002', 'e2e_zero_cliente', 'E2E Zero Cliente', 'COMPANY', 100, 'months', 1, 0, 0, 1, 98)`,
    )

    const [apertado] = await dataSource.query<Array<{ id: string }>>(
      "SELECT id FROM plans WHERE code = 'e2e_zero_cliente'",
    )

    const recusa = await post('/v1/billing/subscribe').send({ planId: apertado.id }).expect(409)
    expect(recusa.body.error.code).toBe('PLANO_NAO_COMPORTA_USO')
    expect(recusa.body.error.message).toContain('o plano permite 0')
  })
})

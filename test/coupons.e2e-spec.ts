import { createHmac } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { DataSource } from 'typeorm'
// Cada suíte roda no mesmo processo do Jest, e `process.env` é compartilhado:
// definir o segredo aqui garante que esta suíte confira a assinatura do webhook
// mesmo quando a de cobrança rodar antes e deixar o dela para trás.
const SEGREDO = 'segredo-e2e-dos-cupons'
process.env.MP_WEBHOOK_SECRET = SEGREDO

import { AppModule } from '../src/app.module'
import { SubscriptionStatus, TenantStatus, TenantType } from '../src/common/enums/tenant.enum'
import { UserRole } from '../src/common/enums/user-role.enum'
import { TenantStatusCache } from '../src/common/services/tenant-status.cache'
import { MercadoPagoClient } from '../src/modules/billing/mercadopago/mercadopago.client'
import type {
  MpAuthorizedPayment,
  MpPreapproval,
} from '../src/modules/billing/mercadopago/mercadopago.types'
import { WebhookQueue } from '../src/modules/billing/webhook-queue.service'
import { BillingSyncJob } from '../src/modules/jobs/billing-sync.job'

/** Provedor de mentira, com o registro do que foi pedido a ele. */
class MercadoPagoFalso {
  enabled = true
  backUrl = 'http://localhost:5173/assinatura/retorno'
  notificationUrl = 'http://localhost:3000/v1/webhooks/mercadopago'

  prefixo = 'cup'
  preapprovals = new Map<string, MpPreapproval>()
  cobrancas = new Map<string, MpAuthorizedPayment>()
  criados: Array<Record<string, unknown>> = []
  atualizacoes: Array<{ id: string; body: Record<string, unknown> }> = []

  criarPreapproval(body: Record<string, unknown>): Promise<MpPreapproval> {
    this.criados.push(body)

    const id = `${this.prefixo}-${this.preapprovals.size + 1}`
    const criado: MpPreapproval = {
      id,
      status: 'pending',
      external_reference:
        typeof body.external_reference === 'string' ? body.external_reference : '',
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
 * Cupons de desconto.
 *
 * O que esta suíte protege é dinheiro nos dois sentidos: cupom que não deveria
 * valer liberando o produto de graça, e desconto que deveria acabar continuando
 * para sempre porque ninguém devolveu o valor cheio ao provedor.
 *
 * Cenários:
 *
 *   • administração só para SUPER_ADMIN
 *   • o valor mandado ao provedor é o COM desconto
 *   • o desconto acaba na fatura combinada e o valor cheio volta
 *   • uma vez por conta
 *   • cupom nominal recusa quem não está na lista
 *   • teto global esgota
 *   • cupom expirado não vale
 *   • cortesia de 100%: sem checkout, sem cartão — e com prazo que o job cobra
 *
 * Pré-requisito: MySQL de teste acessível (`npm run test:e2e`).
 */
describe('Cupons de desconto (e2e)', () => {
  let app: INestApplication
  let dataSource: DataSource
  let mp: MercadoPagoFalso
  let fila: WebhookQueue
  let cacheDeStatus: TenantStatusCache
  let sincronizacao: BillingSyncJob

  const carimbo = Date.now()

  const empresa = {
    name: 'Marta Diretora',
    email: `marta.${carimbo}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.COMPANY,
    companyName: 'Cuidados Marta ME',
  }

  const convidada = {
    name: 'Lúcia Cuidadora',
    email: `lucia.${carimbo}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.INDIVIDUAL,
  }

  const admin = {
    name: 'Dono do MNVMA',
    email: `dono.${carimbo}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.INDIVIDUAL,
  }

  let tokenEmpresa: string
  let tokenConvidada: string
  let tokenAdmin: string
  let tenantEmpresa: string
  let tenantConvidada: string
  let planoStart: string
  let planoIndividual: string

  const codigos = {
    metade: `META${carimbo}`,
    nominal: `NOMINAL${carimbo}`,
    unico: `UNICO${carimbo}`,
    vencido: `VENCIDO${carimbo}`,
    cortesia: `CORTESIA${carimbo}`,
  }

  const post = (url: string, token: string) =>
    request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`)
  const get = (url: string, token: string) =>
    request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`)
  const del = (url: string, token: string) =>
    request(app.getHttpServer()).delete(url).set('Authorization', `Bearer ${token}`)

  const notificar = async (tipo: string, recurso: string) => {
    const requestId = `req-${Math.random().toString(36).slice(2)}`
    const ts = String(Math.floor(Date.now() / 1000))
    const manifesto = `id:${recurso.toLowerCase()};request-id:${requestId};ts:${ts};`
    const v1 = createHmac('sha256', SEGREDO).update(manifesto).digest('hex')

    await request(app.getHttpServer())
      .post(`/v1/webhooks/mercadopago?data.id=${recurso}&type=${tipo}`)
      .set('x-signature', `ts=${ts},v1=${v1}`)
      .set('x-request-id', requestId)
      .send({ type: tipo, data: { id: recurso } })
      .expect(200)
    await fila.ocioso()
  }

  const assinaturaDe = async (tenantId: string) => {
    const [linha] = await dataSource.query<
      Array<{
        id: string
        status: SubscriptionStatus
        mp_preapproval_id: string | null
        current_period_end: Date | null
      }>
    >('SELECT * FROM subscriptions WHERE tenant_id = ?', [tenantId])
    return linha
  }

  const resgateDe = async (tenantId: string) => {
    const [linha] = await dataSource.query<
      Array<{ status: string; invoices_used: number; ends_at: Date | null; warned_stage: number }>
    >('SELECT * FROM coupon_redemptions WHERE tenant_id = ? ORDER BY redeemed_at DESC LIMIT 1', [
      tenantId,
    ])
    return linha
  }

  const statusDaConta = async (tenantId: string): Promise<TenantStatus> => {
    const [linha] = await dataSource.query<Array<{ status: TenantStatus }>>(
      'SELECT status FROM tenants WHERE id = ?',
      [tenantId],
    )
    return linha.status
  }

  /** Cria um cupom pela rota de administração e devolve o id. */
  const criarCupom = async (corpo: Record<string, unknown>): Promise<string> => {
    const criado = await post('/v1/admin/coupons', tokenAdmin).send(corpo).expect(201)
    return String(criado.body.id)
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoClient)
      .useValue(Object.assign(new MercadoPagoFalso(), { prefixo: `cup-${carimbo}` }))
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
    sincronizacao = app.get(BillingSyncJob)

    const umaEmpresa = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send(empresa)
      .expect(201)
    tokenEmpresa = umaEmpresa.body.accessToken
    tenantEmpresa = umaEmpresa.body.tenant.id

    const umaConvidada = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send(convidada)
      .expect(201)
    tokenConvidada = umaConvidada.body.accessToken
    tenantConvidada = umaConvidada.body.tenant.id

    await request(app.getHttpServer()).post('/v1/auth/register').send(admin).expect(201)

    // O papel de SUPER_ADMIN não é criado por cadastro — e não deveria mesmo
    // ser. Aqui ele é promovido no banco, e o token novo já sai com o papel.
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query('UPDATE users SET role = ? WHERE email = ?', [
      UserRole.SUPER_ADMIN,
      admin.email,
    ])

    const sessaoAdmin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200)
    tokenAdmin = sessaoAdmin.body.accessToken

    const planos = await get('/v1/billing/plans', tokenEmpresa).expect(200)
    planoStart = planos.body.find((p: { code: string }) => p.code === 'company_start').id

    const planosIndividuais = await get('/v1/billing/plans', tokenConvidada).expect(200)
    planoIndividual = planosIndividuais.body.find(
      (p: { code: string }) => p.code === 'individual_pro',
    ).id
  })

  afterAll(async () => {
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 0')

    for (const tenantId of [tenantEmpresa, tenantConvidada]) {
      for (const tabela of [
        'coupon_redemptions',
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
    }

    await dataSource.query(
      'DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM users WHERE email = ?)',
      [admin.email],
    )
    await dataSource.query('DELETE FROM users WHERE email = ?', [admin.email])
    await dataSource.query('DELETE FROM coupons WHERE code LIKE ?', [`%${carimbo}`])
    await dataSource.query('DELETE FROM job_runs WHERE job = ?', ['billing.sincronizacao'])
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 1')
    await app.close()
  })

  // ─── Administração ──────────────────────────────────────────────────────────

  it('a administração de cupons é fechada para quem não é SUPER_ADMIN', async () => {
    // O OWNER tem TODAS as permissões dentro da conta dele — inclusive
    // `billing:write`. Se a rota dependesse de permissão, ele criaria o próprio
    // cupom de 100%.
    const recusa = await get('/v1/admin/coupons', tokenEmpresa).expect(403)
    expect(recusa.body.error.code).toBe('SOMENTE_SUPER_ADMIN')

    await post('/v1/admin/coupons', tokenEmpresa)
      .send({ code: `PIRATA${carimbo}`, name: 'Tentativa', discountPercent: 100 })
      .expect(403)
  })

  it('o dono do SaaS cria um cupom e ele nasce resgatável', async () => {
    const id = await criarCupom({
      code: codigos.metade.toLowerCase(),
      name: 'Metade do preço',
      discountPercent: 50,
      maxInvoices: 3,
    })

    const detalhe = await get(`/v1/admin/coupons/${id}`, tokenAdmin).expect(200)

    expect(detalhe.body).toMatchObject({
      // Digitado em minúsculas, guardado em maiúsculas: o cliente vai digitar
      // do jeito que estiver no WhatsApp dele.
      code: codigos.metade,
      discountPercent: 50,
      maxInvoices: 3,
      courtesy: false,
      restricted: false,
      redeemable: true,
      redemptions: 0,
    })
  })

  it('código repetido é recusado', async () => {
    const repetido = await post('/v1/admin/coupons', tokenAdmin)
      .send({ code: codigos.metade, name: 'Outro', discountPercent: 10 })
      .expect(409)

    expect(repetido.body.error.code).toBe('CUPOM_DUPLICADO')
  })

  // ─── Prévia e uso ───────────────────────────────────────────────────────────

  it('a prévia mostra o desconto antes de a pessoa se comprometer', async () => {
    const previa = await post('/v1/billing/coupons/preview', tokenEmpresa)
      .send({ code: codigos.metade, planId: planoStart })
      .expect(200)

    expect(previa.body).toMatchObject({
      discountPercent: 50,
      priceCents: 14900,
      discountedPriceCents: 7450,
      discountedPrice: '74.50',
      // 3 faturas × R$ 74,50 de economia.
      totalSavingsCents: 22350,
      courtesy: false,
      requiresCheckout: true,
      summary: '50% de desconto nas 3 primeiras faturas',
    })
  })

  it('cupom inexistente e cupom desligado respondem igual', async () => {
    const recusa = await post('/v1/billing/coupons/preview', tokenEmpresa)
      .send({ code: 'NAO-EXISTE-ESTE', planId: planoStart })
      .expect(400)

    expect(recusa.body.error.code).toBe('CUPOM_INVALIDO')
  })

  it('assinar com cupom manda ao provedor o valor JÁ com desconto', async () => {
    const resposta = await post('/v1/billing/subscribe', tokenEmpresa)
      .send({ planId: planoStart, couponCode: codigos.metade })
      .expect(200)

    expect(resposta.body.checkoutUrl).toContain('mercadopago.com/checkout/')
    expect(resposta.body.message).toContain('50% de desconto nas 3 primeiras faturas')

    // O ponto mais fácil de errar da feature inteira: mandar o cupom junto com
    // o `preapproval_plan_id`, que carrega o preço cheio — e cobrar sem desconto.
    const enviado = mp.criados.at(-1)
    expect(enviado?.preapproval_plan_id).toBeUndefined()
    expect(enviado?.auto_recurring).toMatchObject({ transaction_amount: 74.5 })

    const resgate = await resgateDe(tenantEmpresa)
    expect(resgate.status).toBe('PENDING')
  })

  it('o desconto só passa a valer quando o pagamento é confirmado', async () => {
    const assinatura = await assinaturaDe(tenantEmpresa)
    const preapprovalId = assinatura.mp_preapproval_id as string

    mp.preapprovals.get(preapprovalId)!.status = 'authorized'
    await notificar('subscription_preapproval', preapprovalId)

    const resgate = await resgateDe(tenantEmpresa)
    expect(resgate.status).toBe('ACTIVE')

    const naTela = await get('/v1/billing/subscription', tokenEmpresa).expect(200)
    expect(naTela.body.discount).toMatchObject({
      code: codigos.metade,
      discountPercent: 50,
      invoicesUsed: 0,
      courtesy: false,
    })
  })

  it('o mesmo cupom não vale duas vezes na mesma conta', async () => {
    const recusa = await post('/v1/billing/subscribe', tokenEmpresa)
      .send({ planId: planoStart, couponCode: codigos.metade })
      .expect(409)

    // A assinatura já está ativa, então a recusa vem antes até de olhar o
    // cupom — o que importa é que não dá para reaplicar.
    expect(['CUPOM_ASSINATURA_ATIVA', 'CUPOM_JA_USADO']).toContain(recusa.body.error.code)
  })

  it('o desconto acaba na fatura combinada e o valor cheio volta ao provedor', async () => {
    const assinatura = await assinaturaDe(tenantEmpresa)
    const preapprovalId = assinatura.mp_preapproval_id as string

    for (const numero of [1, 2, 3]) {
      const cobrancaId = `desconto-${carimbo}-${numero}`
      mp.cobrancas.set(cobrancaId, {
        id: cobrancaId,
        preapproval_id: preapprovalId,
        transaction_amount: 74.5,
        debit_date: new Date().toISOString(),
        payment: { status: 'approved', payment_method_id: 'master' },
      })

      await notificar('subscription_authorized_payment', cobrancaId)

      const resgate = await resgateDe(tenantEmpresa)
      expect(resgate.invoices_used).toBe(numero)
      expect(resgate.status).toBe(numero === 3 ? 'EXHAUSTED' : 'ACTIVE')
    }

    // Assinatura recorrente no Mercado Pago tem valor fixo: "50% nos 3
    // primeiros meses" é cobrar metade e depois PEDIR que ele volte ao cheio.
    // Sem esta chamada, o desconto duraria para sempre em silêncio.
    const ultima = mp.atualizacoes.at(-1)
    expect(ultima?.id).toBe(preapprovalId)
    expect(ultima?.body).toMatchObject({ auto_recurring: { transaction_amount: 149 } })
  })

  // ─── Cupom nominal ──────────────────────────────────────────────────────────

  it('cupom nominal recusa quem não está na lista e aceita quem está', async () => {
    await criarCupom({
      code: codigos.nominal,
      name: 'Combinado com a Lúcia',
      discountPercent: 30,
      maxInvoices: 2,
      targets: { emails: [convidada.email.toUpperCase()] },
    })

    // A empresa tem o código (alguém compartilhou), mas o cupom não é dela.
    const recusa = await post('/v1/billing/coupons/preview', tokenEmpresa)
      .send({ code: codigos.nominal, planId: planoStart })
      .expect(400)
    expect(recusa.body.error.code).toBe('CUPOM_RESTRITO')

    // A destinatária passa — e o e-mail foi cadastrado em caixa alta de
    // propósito: e-mail não diferencia maiúsculas na vida real.
    const previa = await post('/v1/billing/coupons/preview', tokenConvidada)
      .send({ code: codigos.nominal, planId: planoIndividual })
      .expect(200)
    expect(previa.body.discountPercent).toBe(30)
  })

  it('tirar alguém da lista fecha a porta para quem ainda não resgatou', async () => {
    const lista = await get('/v1/admin/coupons', tokenAdmin).expect(200)
    const nominal = lista.body.find((c: { code: string }) => c.code === codigos.nominal)

    expect(nominal.restricted).toBe(true)
    expect(nominal.targetEmails).toContain(convidada.email.toLowerCase())

    await del(
      `/v1/admin/coupons/${nominal.id}/targets/${encodeURIComponent(convidada.email)}`,
      tokenAdmin,
    ).expect(200)

    // Sem alvo nenhum, o cupom volta a ser aberto — é a regra: a lista é o que
    // o torna nominal.
    const depois = await post('/v1/billing/coupons/preview', tokenEmpresa)
      .send({ code: codigos.nominal, planId: planoStart })
      .expect(200)
    expect(depois.body.discountPercent).toBe(30)
  })

  // ─── Teto e validade ────────────────────────────────────────────────────────

  it('cupom com teto esgota depois do número de resgates', async () => {
    const id = await criarCupom({
      code: codigos.unico,
      name: 'Só um',
      discountPercent: 20,
      maxRedemptions: 1,
    })

    // Ainda dá para conferir: o teto não foi atingido.
    await post('/v1/billing/coupons/preview', tokenConvidada)
      .send({ code: codigos.unico, planId: planoIndividual })
      .expect(200)

    // Simula o resgate de outra conta ocupando a única vaga.
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query(
      `INSERT INTO coupon_redemptions
         (id, tenant_id, coupon_id, discount_percent, max_invoices, status, redeemed_at)
       VALUES (UUID(), ?, ?, 20, 1, 'ACTIVE', UTC_TIMESTAMP(6))`,
      [tenantEmpresa, id],
    )

    const esgotado = await post('/v1/billing/coupons/preview', tokenConvidada)
      .send({ code: codigos.unico, planId: planoIndividual })
      .expect(409)
    expect(esgotado.body.error.code).toBe('CUPOM_ESGOTADO')

    const detalhe = await get(`/v1/admin/coupons/${id}`, tokenAdmin).expect(200)
    expect(detalhe.body).toMatchObject({ redemptions: 1, redeemable: false, blockedReason: 'Esgotado' })
  })

  it('cupom fora da janela de resgate não vale', async () => {
    await criarCupom({
      code: codigos.vencido,
      name: 'Campanha que passou',
      discountPercent: 40,
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    })

    const recusa = await post('/v1/billing/coupons/preview', tokenConvidada)
      .send({ code: codigos.vencido, planId: planoIndividual })
      .expect(400)

    expect(recusa.body.error.code).toBe('CUPOM_EXPIRADO')
  })

  // ─── Cortesia: 100% ─────────────────────────────────────────────────────────

  it('cupom de 100% libera a conta sem checkout e sem cartão', async () => {
    await criarCupom({
      code: codigos.cortesia,
      name: 'Cortesia de dois meses',
      discountPercent: 100,
      maxInvoices: 2,
    })

    const previa = await post('/v1/billing/coupons/preview', tokenConvidada)
      .send({ code: codigos.cortesia, planId: planoIndividual })
      .expect(200)

    expect(previa.body).toMatchObject({
      courtesy: true,
      requiresCheckout: false,
      discountedPriceCents: 0,
    })
    expect(previa.body.courtesyEndsAt).toBeTruthy()

    const resposta = await post('/v1/billing/subscribe', tokenConvidada)
      .send({ planId: planoIndividual, couponCode: codigos.cortesia })
      .expect(200)

    expect(resposta.body).toMatchObject({
      applied: true,
      checkoutUrl: null,
      status: SubscriptionStatus.ACTIVE,
    })
    expect(resposta.body.message).toContain('sem cobrança')
    expect(resposta.body.message).toContain('cartão')

    const assinatura = await assinaturaDe(tenantConvidada)
    expect(assinatura.status).toBe(SubscriptionStatus.ACTIVE)
    // Nada foi criado no provedor: não existe o que cobrar.
    expect(assinatura.mp_preapproval_id).toBeNull()
    expect(assinatura.current_period_end).not.toBeNull()

    expect(await statusDaConta(tenantConvidada)).toBe(TenantStatus.ACTIVE)
  })

  it('durante a cortesia a conta escreve normalmente', async () => {
    cacheDeStatus.invalidate(tenantConvidada)
    await post('/v1/customers', tokenConvidada).send({ name: 'Dona Antônia' }).expect(201)
  })

  it('a tela de assinatura mostra a cortesia e até quando ela vale', async () => {
    const naTela = await get('/v1/billing/subscription', tokenConvidada).expect(200)

    expect(naTela.body.discount).toMatchObject({
      code: codigos.cortesia,
      discountPercent: 100,
      courtesy: true,
      status: 'ACTIVE',
    })
    expect(naTela.body.discount.summary).toContain('Cortesia de 100% até')
  })

  it('quando a cortesia vence, a conta vira somente leitura — sem falar em inadimplência', async () => {
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query(
      'UPDATE coupon_redemptions SET ends_at = ? WHERE tenant_id = ?',
      [new Date(Date.now() - 86_400_000), tenantConvidada],
    )

    // Referência no futuro só para a trava do job não colidir com a janela
    // horária que outra suíte possa ter usado.
    await sincronizacao.executar(new Date(Date.now() + 3 * 3_600_000))

    const resgate = await resgateDe(tenantConvidada)
    expect(resgate.status).toBe('EXHAUSTED')

    // EXPIRED, e não SUSPENDED: ninguém deixou de pagar. É a diferença entre
    // "escolha um plano" e uma cobrança que nunca existiu.
    expect(await statusDaConta(tenantConvidada)).toBe(TenantStatus.EXPIRED)

    cacheDeStatus.invalidate(tenantConvidada)
    await get('/v1/customers', tokenConvidada).expect(200)
    await post('/v1/customers', tokenConvidada).send({ name: 'Não deve entrar' }).expect(403)
  })

  it('depois da cortesia, o mesmo cupom não volta a valer', async () => {
    cacheDeStatus.invalidate(tenantConvidada)

    const recusa = await post('/v1/billing/coupons/preview', tokenConvidada)
      .send({ code: codigos.cortesia, planId: planoIndividual })
      .expect(409)

    expect(recusa.body.error.code).toBe('CUPOM_JA_USADO')
  })

  it('o administrador vê quem resgatou cada campanha', async () => {
    const lista = await get('/v1/admin/coupons', tokenAdmin).expect(200)
    const cortesia = lista.body.find((c: { code: string }) => c.code === codigos.cortesia)

    const resgates = await get(`/v1/admin/coupons/${cortesia.id}/redemptions`, tokenAdmin).expect(
      200,
    )

    expect(resgates.body).toHaveLength(1)
    expect(resgates.body[0]).toMatchObject({
      tenantId: tenantConvidada,
      tenantName: convidada.name,
      discountPercent: 100,
      status: 'EXHAUSTED',
    })
  })

  it('desligar um cupom fecha para novos resgates', async () => {
    const lista = await get('/v1/admin/coupons', tokenAdmin).expect(200)
    const nominal = lista.body.find((c: { code: string }) => c.code === codigos.nominal)

    const desligado = await del(`/v1/admin/coupons/${nominal.id}`, tokenAdmin).expect(200)
    expect(desligado.body).toMatchObject({ isActive: false, blockedReason: 'Desligado' })

    const recusa = await post('/v1/billing/coupons/preview', tokenEmpresa)
      .send({ code: codigos.nominal, planId: planoStart })
      .expect(400)
    expect(recusa.body.error.code).toBe('CUPOM_INVALIDO')
  })
})

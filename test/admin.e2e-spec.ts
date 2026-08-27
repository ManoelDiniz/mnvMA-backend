import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module'
import { TenantStatus, TenantType } from '../src/common/enums/tenant.enum'
import { UserRole } from '../src/common/enums/user-role.enum'
import { TenantStatusCache } from '../src/common/services/tenant-status.cache'

/**
 * MNVMA Core — o painel do dono do SaaS.
 *
 * O risco desta área é diferente do resto do sistema: aqui uma falha não vaza
 * uma conta, vaza **todas**. Por isso a suíte começa provando que o OWNER de uma
 * conta qualquer — que tem todas as permissões dentro dela — não passa da porta.
 *
 * Depois vem o que o painel promete: números do negócio, a lista de contas, e as
 * duas ações que mudam a vida de um cliente (suspender e reativar) sempre com
 * motivo e sempre registradas.
 *
 * Pré-requisito: MySQL de teste acessível (`npm run test:e2e`).
 */
describe('MNVMA Core (e2e)', () => {
  let app: INestApplication
  let dataSource: DataSource
  let cacheDeStatus: TenantStatusCache

  const carimbo = Date.now()

  const cliente = {
    name: 'Célia Titular',
    email: `celia.${carimbo}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.COMPANY,
    companyName: `Cuidados Célia ${carimbo}`,
  }

  const dono = {
    name: 'Dona do MNVMA',
    email: `core.${carimbo}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.INDIVIDUAL,
  }

  let tokenCliente: string
  let tokenDono: string
  let tenantCliente: string

  const post = (url: string, token: string) =>
    request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`)
  const get = (url: string, token: string) =>
    request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`)

  const statusDaConta = async (): Promise<TenantStatus> => {
    const [linha] = await dataSource.query<Array<{ status: TenantStatus }>>(
      'SELECT status FROM tenants WHERE id = ?',
      [tenantCliente],
    )
    return linha.status
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('v1')
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()

    dataSource = app.get(DataSource)
    cacheDeStatus = app.get(TenantStatusCache)

    const sessaoCliente = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send(cliente)
      .expect(201)
    tokenCliente = sessaoCliente.body.accessToken
    tenantCliente = sessaoCliente.body.tenant.id

    await request(app.getHttpServer()).post('/v1/auth/register').send(dono).expect(201)

    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query('UPDATE users SET role = ? WHERE email = ?', [
      UserRole.SUPER_ADMIN,
      dono.email,
    ])

    const sessaoDono = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: dono.email, password: dono.password })
      .expect(200)
    tokenDono = sessaoDono.body.accessToken
  })

  afterAll(async () => {
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 0')
    await dataSource.query('DELETE FROM admin_actions WHERE target_tenant_id = ?', [tenantCliente])

    for (const tabela of [
      'coupon_redemptions',
      'subscription_payments',
      'subscriptions',
      'customers',
      'refresh_tokens',
      'users',
      'caregivers',
    ]) {
      await dataSource.query(`DELETE FROM ${tabela} WHERE tenant_id = ?`, [tenantCliente])
    }
    await dataSource.query('DELETE FROM tenants WHERE id = ?', [tenantCliente])

    await dataSource.query(
      'DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM users WHERE email = ?)',
      [dono.email],
    )
    await dataSource.query('DELETE FROM users WHERE email = ?', [dono.email])
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 1')
    await app.close()
  })

  // ─── A porta ────────────────────────────────────────────────────────────────

  it('o painel inteiro é fechado para quem não é SUPER_ADMIN', async () => {
    // O OWNER tem TODAS as permissões dentro da conta dele. Se o Core dependesse
    // de permissão, ele veria a lista de clientes do concorrente.
    for (const rota of ['/v1/admin/metrics', '/v1/admin/tenants']) {
      const recusa = await get(rota, tokenCliente).expect(403)
      expect(recusa.body.error.code).toBe('SOMENTE_SUPER_ADMIN')
    }

    await get(`/v1/admin/tenants/${tenantCliente}`, tokenCliente).expect(403)
    await post(`/v1/admin/tenants/${tenantCliente}/suspend`, tokenCliente)
      .send({ reason: 'tentativa indevida' })
      .expect(403)
  })

  it('sem sessão nenhuma, 401', async () => {
    await request(app.getHttpServer()).get('/v1/admin/metrics').expect(401)
  })

  // ─── Métricas ───────────────────────────────────────────────────────────────

  it('as métricas respondem as perguntas do negócio', async () => {
    const painel = await get('/v1/admin/metrics', tokenDono).expect(200)

    expect(painel.body.contas).toBeGreaterThanOrEqual(2)
    expect(painel.body.porStatus.TRIAL).toBeGreaterThanOrEqual(2)
    expect(painel.body.empresas).toBeGreaterThanOrEqual(1)
    expect(painel.body.individuais).toBeGreaterThanOrEqual(1)
    expect(painel.body.novasNoMes).toBeGreaterThanOrEqual(2)

    // Dinheiro em centavos inteiros e string formatada — nunca float.
    expect(Number.isInteger(painel.body.mrrCents)).toBe(true)
    expect(painel.body.mrr).toMatch(/^-?\d+\.\d{2}$/)

    expect(typeof painel.body.webhooksPendentes).toBe('number')
  })

  // ─── Contas ─────────────────────────────────────────────────────────────────

  it('a lista de contas encontra o cliente e traz o titular', async () => {
    const lista = await get(
      `/v1/admin/tenants?q=${encodeURIComponent(cliente.companyName)}`,
      tokenDono,
    ).expect(200)

    expect(lista.body.data).toHaveLength(1)
    expect(lista.body.data[0]).toMatchObject({
      id: tenantCliente,
      name: cliente.companyName,
      type: TenantType.COMPANY,
      status: TenantStatus.TRIAL,
      ownerEmail: cliente.email,
      users: 1,
    })
  })

  it('os filtros de situação e tipo funcionam juntos com a busca', async () => {
    const semResultado = await get(
      `/v1/admin/tenants?q=${encodeURIComponent(cliente.companyName)}&type=INDIVIDUAL`,
      tokenDono,
    ).expect(200)
    expect(semResultado.body.data).toHaveLength(0)

    const comResultado = await get(
      `/v1/admin/tenants?q=${encodeURIComponent(cliente.companyName)}&status=TRIAL`,
      tokenDono,
    ).expect(200)
    expect(comResultado.body.data).toHaveLength(1)
  })

  it('o detalhe mostra uso, usuários e histórico vazio', async () => {
    await post('/v1/customers', tokenCliente).send({ name: 'Dona Ruth' }).expect(201)

    const detalhe = await get(`/v1/admin/tenants/${tenantCliente}`, tokenDono).expect(200)

    expect(detalhe.body.usage).toMatchObject({ customers: 1, users: 1 })
    expect(detalhe.body.usuarios).toHaveLength(1)
    expect(detalhe.body.usuarios[0]).toMatchObject({
      email: cliente.email,
      role: UserRole.OWNER,
      roleLabel: 'Titular da conta',
    })
    expect(detalhe.body.historico).toEqual([])
    expect(detalhe.body.cobrancas).toEqual([])
  })

  // ─── Suspender e reativar ───────────────────────────────────────────────────

  it('suspender sem motivo é recusado', async () => {
    // O motivo não é burocracia: sem ele, a ação é a que ninguém consegue
    // explicar quando o cliente liga perguntando por que a conta parou.
    await post(`/v1/admin/tenants/${tenantCliente}/suspend`, tokenDono).send({}).expect(400)
    await post(`/v1/admin/tenants/${tenantCliente}/suspend`, tokenDono)
      .send({ reason: 'oi' })
      .expect(400)
  })

  it('suspender bloqueia a escrita do cliente e preserva a leitura', async () => {
    const depois = await post(`/v1/admin/tenants/${tenantCliente}/suspend`, tokenDono)
      .send({ reason: 'Chargeback confirmado na competência de agosto' })
      .expect(200)

    expect(depois.body.status).toBe(TenantStatus.SUSPENDED)
    expect(await statusDaConta()).toBe(TenantStatus.SUSPENDED)

    cacheDeStatus.invalidate(tenantCliente)
    await post('/v1/customers', tokenCliente).send({ name: 'Não deve entrar' }).expect(403)
    await get('/v1/customers', tokenCliente).expect(200)
  })

  it('a suspensão fica no histórico, com quem fez e por quê', async () => {
    const detalhe = await get(`/v1/admin/tenants/${tenantCliente}`, tokenDono).expect(200)

    expect(detalhe.body.historico).toHaveLength(1)
    expect(detalhe.body.historico[0]).toMatchObject({
      action: 'tenant.suspend',
      actionLabel: 'Conta suspensa',
      // O e-mail vem do token, não do corpo da requisição.
      actorEmail: dono.email,
      reason: 'Chargeback confirmado na competência de agosto',
    })
  })

  it('reativar devolve a conta ao teste, porque não há período pago', async () => {
    // Reativar não é presentear: sem assinatura paga valendo, a conta volta ao
    // teste que ainda tem prazo — não vira ACTIVE de graça.
    const depois = await post(`/v1/admin/tenants/${tenantCliente}/reactivate`, tokenDono)
      .send({ reason: 'Chargeback revertido pelo banco' })
      .expect(200)

    expect(depois.body.status).toBe(TenantStatus.TRIAL)
    expect(await statusDaConta()).toBe(TenantStatus.TRIAL)

    cacheDeStatus.invalidate(tenantCliente)
    await post('/v1/customers', tokenCliente).send({ name: 'Dona Neusa' }).expect(201)

    expect(depois.body.historico).toHaveLength(2)
    expect(depois.body.historico[0]).toMatchObject({
      action: 'tenant.reactivate',
      actionLabel: 'Conta reativada',
    })
  })

  it('conta inexistente responde 404, não 500', async () => {
    await get('/v1/admin/tenants/00000000-0000-4000-8000-000000000000', tokenDono).expect(404)
  })
})

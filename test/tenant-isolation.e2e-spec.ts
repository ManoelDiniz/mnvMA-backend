import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module'
import { TenantType } from '../src/common/enums/tenant.enum'

/**
 * A suíte mais importante do projeto.
 *
 * Com MySQL não existe Row Level Security: o isolamento de leitura depende do
 * TenantScopedRepository. Este teste é o que prova, a cada PR, que ele está
 * sendo usado em todo lugar — se alguém injetar `Repository<T>` cru num service
 * novo, é aqui que aparece.
 *
 * Regra: todo endpoint novo entra nesta suíte antes do merge.
 *
 * Pré-requisito: MySQL de teste acessível (DATABASE_URL apontando para um banco
 * descartável). Rode com `npm run test:e2e`.
 */
describe('Isolamento entre tenants (e2e)', () => {
  let app: INestApplication
  let dataSource: DataSource

  const alice = {
    name: 'Alice Cuidadora',
    email: `alice.${Date.now()}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.INDIVIDUAL,
  }

  const bob = {
    name: 'Bob Cuidados ME',
    email: `bob.${Date.now()}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.COMPANY,
    companyName: 'Bob Cuidados ME',
  }

  let aliceToken: string
  let bobToken: string
  let aliceCustomerId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('v1')
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()

    dataSource = app.get(DataSource)

    const aliceSession = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send(alice)
      .expect(201)
    aliceToken = aliceSession.body.accessToken

    const bobSession = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send(bob)
      .expect(201)
    bobToken = bobSession.body.accessToken

    const customer = await request(app.getHttpServer())
      .post('/v1/customers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ name: 'Dona Maria', cpf: '52998224725' })
      .expect(201)
    aliceCustomerId = customer.body.id
  })

  afterAll(async () => {
    // Limpa só o que este teste criou.
    await dataSource.query('SET @mnvma_system_scope = 1')
    // `customers` é referenciado com RESTRICT por finanças e ocorrências — de
    // propósito: ninguém apaga um cliente que já tem histórico de dinheiro. O
    // efeito colateral é que apagar o tenant em cascata esbarra nisso. Num banco
    // de teste descartável, desligar a checagem é mais honesto que replicar a
    // ordem de dependência aqui e deixá-la desatualizar.
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 0')
    await dataSource.query('DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM users WHERE email IN (?, ?))', [
      alice.email,
      bob.email,
    ])
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 1')
    await app.close()
  })

  it('Bob não enxerga o cliente da Alice na listagem', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/customers')
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200)

    expect(response.body.data).toHaveLength(0)
    expect(response.body.meta.total).toBe(0)
  })

  it('Bob recebe 404 (e não 403) ao acessar o cliente da Alice pelo id', async () => {
    // 403 confirmaria que o registro existe. 404 não revela nada.
    await request(app.getHttpServer())
      .get(`/v1/customers/${aliceCustomerId}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(404)
  })

  it('Bob não consegue editar o cliente da Alice', async () => {
    await request(app.getHttpServer())
      .patch(`/v1/customers/${aliceCustomerId}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ name: 'Invadido' })
      .expect(404)
  })

  it('Bob não consegue excluir o cliente da Alice', async () => {
    await request(app.getHttpServer())
      .delete(`/v1/customers/${aliceCustomerId}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(404)
  })

  it('Alice continua enxergando o próprio cliente', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/customers/${aliceCustomerId}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200)

    expect(response.body.name).toBe('Dona Maria')
  })

  it('O mesmo CPF pode existir em contas diferentes', async () => {
    await request(app.getHttpServer())
      .post('/v1/customers')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ name: 'Outra Maria', cpf: '52998224725' })
      .expect(201)
  })

  it('CPF duplicado dentro da MESMA conta é recusado', async () => {
    await request(app.getHttpServer())
      .post('/v1/customers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ name: 'Maria Repetida', cpf: '52998224725' })
      .expect(409)
  })

  it('O trigger do MySQL barra escrita com tenant_id de outra conta', async () => {
    const [{ tenant_id: bobTenantId }] = await dataSource.query<Array<{ tenant_id: string }>>(
      'SELECT tenant_id FROM users WHERE email = ? LIMIT 1',
      [bob.email],
    )

    // Simula um bug que escapou da camada de aplicação: escrita direta com o
    // contexto de sessão de uma conta e o tenant_id de outra.
    await dataSource.query('SET @mnvma_system_scope = 0, @mnvma_tenant_id = ?', [
      '00000000-0000-0000-0000-000000000000',
    ])

    await expect(
      dataSource.query(
        `INSERT INTO customers (id, tenant_id, name, is_active, created_at, updated_at)
         VALUES (UUID(), ?, 'Invasor', 1, NOW(6), NOW(6))`,
        [bobTenantId],
      ),
    ).rejects.toThrow(/tenant_id nao confere/i)

    await dataSource.query('SET @mnvma_tenant_id = NULL')
  })

  it('Token sem Bearer é recusado', async () => {
    await request(app.getHttpServer()).get('/v1/customers').expect(401)
  })
})

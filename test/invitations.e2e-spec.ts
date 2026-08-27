import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module'
import { TenantType } from '../src/common/enums/tenant.enum'
import { UserRole } from '../src/common/enums/user-role.enum'

/**
 * O convite é a única porta pela qual alguém entra numa conta que não criou.
 * Por isso ele é testado como se fosse superfície de ataque, e não como CRUD:
 *
 *   • o token só existe em texto claro na resposta — o banco guarda o hash;
 *   • aceitar duas vezes não cria dois acessos;
 *   • reenviar mata o link anterior, que pode ter ido para a caixa errada;
 *   • cancelar mata o link mesmo que ele já esteja no e-mail de alguém.
 *
 * Pré-requisito: MySQL de teste acessível (`npm run test:e2e`).
 */
describe('Convites de equipe (e2e)', () => {
  let app: INestApplication
  let dataSource: DataSource

  const carimbo = Date.now()

  const empresa = {
    name: 'Sirlene Diretora',
    email: `sirlene.${carimbo}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.COMPANY,
    companyName: 'Cuidar Bem ME',
  }

  const convidada = `paula.${carimbo}@mnvma.test`

  let ownerToken: string
  let ownerId: string
  let http: ReturnType<typeof request>

  const post = (url: string, token?: string) => {
    const req = request(app.getHttpServer()).post(url)
    return token ? req.set('Authorization', `Bearer ${token}`) : req
  }

  const get = (url: string, token?: string) => {
    const req = request(app.getHttpServer()).get(url)
    return token ? req.set('Authorization', `Bearer ${token}`) : req
  }

  /** O link só aparece uma vez; o teste guarda o token que vem dentro dele. */
  const tokenDe = (inviteUrl: string): string => inviteUrl.split('/').pop() as string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('v1')
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()

    dataSource = app.get(DataSource)
    http = request(app.getHttpServer())

    const sessao = await post('/v1/auth/register').send(empresa).expect(201)
    ownerToken = sessao.body.accessToken
    ownerId = sessao.body.user.id
  })

  afterAll(async () => {
    await dataSource.query('SET @mnvma_system_scope = 1')
    // `customers` é referenciado com RESTRICT por finanças e ocorrências — de
    // propósito: ninguém apaga um cliente que já tem histórico de dinheiro. O
    // efeito colateral é que apagar o tenant em cascata esbarra nisso. Num banco
    // de teste descartável, desligar a checagem é mais honesto que replicar a
    // ordem de dependência aqui e deixá-la desatualizar.
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 0')
    await dataSource.query(
      'DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM users WHERE email = ?)',
      [empresa.email],
    )
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 1')
    await app.close()
  })

  it('o convite devolve o link uma vez e o banco guarda só o hash', async () => {
    const criado = await post('/v1/users/invites', ownerToken)
      .send({ email: convidada, name: 'Paula Coordenadora', role: UserRole.COORDINATOR })
      .expect(201)

    const token = tokenDe(criado.body.inviteUrl)
    expect(token.length).toBeGreaterThan(20)
    expect(criado.body.invitation.situation).toBe('pending')

    const [linha] = await dataSource.query<Array<{ token_hash: string }>>(
      'SELECT token_hash FROM invitations WHERE id = ?',
      [criado.body.invitation.id],
    )

    // Um dump do banco não pode virar acesso: o que está gravado é o SHA-256.
    expect(linha.token_hash).toHaveLength(64)
    expect(linha.token_hash).not.toContain(token)
  })

  it('a listagem de convites nunca expõe o hash', async () => {
    const lista = await get('/v1/users/invites?situation=pending', ownerToken).expect(200)
    expect(JSON.stringify(lista.body)).not.toContain('tokenHash')
  })

  it('recusa um segundo convite para o mesmo e-mail enquanto o primeiro está de pé', async () => {
    await post('/v1/users/invites', ownerToken)
      .send({ email: convidada, name: 'Paula de novo', role: UserRole.FINANCE })
      .expect(409)
  })

  it('token inexistente e token válido de outra conta respondem igual: 404', async () => {
    await http.get('/v1/invites/nao-existe-este-token-aqui').expect(404)
  })

  it('a prévia mostra a empresa antes de a pessoa criar a senha', async () => {
    const outroConvite = await post('/v1/users/invites', ownerToken)
      .send({ email: `previa.${carimbo}@mnvma.test`, name: 'Previa', role: UserRole.FINANCE })
      .expect(201)

    const previa = await http
      .get(`/v1/invites/${tokenDe(outroConvite.body.inviteUrl)}`)
      .expect(200)

    expect(previa.body.tenantName).toBe('Cuidar Bem ME')
    expect(previa.body.roleLabel).toBe('Financeiro')

    await request(app.getHttpServer())
      .delete(`/v1/users/invites/${outroConvite.body.invitation.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
  })

  it('reenviar invalida o link anterior', async () => {
    const criado = await post('/v1/users/invites', ownerToken)
      .send({ email: `reenvio.${carimbo}@mnvma.test`, name: 'Reenvio', role: UserRole.FINANCE })
      .expect(201)

    const antigo = tokenDe(criado.body.inviteUrl)

    const reenviado = await post(
      `/v1/users/invites/${criado.body.invitation.id}/resend`,
      ownerToken,
    ).expect(200)

    const novo = tokenDe(reenviado.body.inviteUrl)
    expect(novo).not.toBe(antigo)

    await http.get(`/v1/invites/${antigo}`).expect(404)
    await http.get(`/v1/invites/${novo}`).expect(200)

    await request(app.getHttpServer())
      .delete(`/v1/users/invites/${criado.body.invitation.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    // Cancelado: o link que já está na caixa de entrada morre junto.
    await http.get(`/v1/invites/${novo}`).expect(404)
  })

  it('aceitar cria o acesso, autentica na hora e queima o token', async () => {
    const lista = await get('/v1/users/invites?situation=pending', ownerToken).expect(200)
    const pendente = lista.body.data.find((i: { email: string }) => i.email === convidada)
    expect(pendente).toBeDefined()

    // O token do primeiro teste não é reaproveitável entre `it`s: reenvia para
    // ter um link fresco em mãos sem depender da ordem de execução.
    const reenviado = await post(`/v1/users/invites/${pendente.id}/resend`, ownerToken).expect(200)
    const token = tokenDe(reenviado.body.inviteUrl)

    const sessao = await http
      .post('/v1/invites/accept')
      .send({ token, password: 'senha-da-paula-1', name: 'Paula Ferreira' })
      .expect(200)

    expect(sessao.body.accessToken).toBeTruthy()
    expect(sessao.body.user.role).toBe(UserRole.COORDINATOR)
    expect(sessao.body.user.name).toBe('Paula Ferreira')
    expect(sessao.body.tenant.name).toBe('Cuidar Bem ME')

    // Sessão de verdade: veio com o cookie de refresh, igual ao login.
    expect(String(sessao.headers['set-cookie'])).toContain('mnvma_rt')

    await http
      .post('/v1/invites/accept')
      .send({ token, password: 'outra-senha-123' })
      .expect(404)

    const login = await http
      .post('/v1/auth/login')
      .send({ email: convidada, password: 'senha-da-paula-1' })
      .expect(200)

    expect(login.body.user.email).toBe(convidada)
  })

  it('o titular da conta não pode ser rebaixado nem removido', async () => {
    await request(app.getHttpServer())
      .patch(`/v1/users/${ownerId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: UserRole.FINANCE })
      .expect(409)

    await request(app.getHttpServer())
      .delete(`/v1/users/${ownerId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(409)
  })

  it('o papel de cuidador exige o cuidador que ele representa', async () => {
    await post('/v1/users/invites', ownerToken)
      .send({ email: `semvinculo.${carimbo}@mnvma.test`, name: 'Sem Vínculo', role: UserRole.CAREGIVER })
      .expect(400)

    const cuidadora = await post('/v1/caregivers', ownerToken)
      .send({ name: 'Marta Silva' })
      .expect(201)

    const comVinculo = await post('/v1/users/invites', ownerToken)
      .send({
        email: `marta.${carimbo}@mnvma.test`,
        name: 'Marta',
        role: UserRole.CAREGIVER,
        caregiverId: cuidadora.body.id,
      })
      .expect(201)

    expect(comVinculo.body.invitation.caregiverId).toBe(cuidadora.body.id)

    // O mesmo cuidador não pode ter dois acessos: os dados dele passariam a ser
    // editados por duas pessoas sem que nenhuma soubesse da outra.
    const aceite = await http
      .post('/v1/invites/accept')
      .send({ token: tokenDe(comVinculo.body.inviteUrl), password: 'senha-da-marta-1' })
      .expect(200)

    expect(aceite.body.user.caregiverId).toBe(cuidadora.body.id)

    await post('/v1/users/invites', ownerToken)
      .send({
        email: `marta2.${carimbo}@mnvma.test`,
        name: 'Marta 2',
        role: UserRole.CAREGIVER,
        caregiverId: cuidadora.body.id,
      })
      .expect(409)
  })
})

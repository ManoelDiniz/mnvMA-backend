import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module'
import { TenantType } from '../src/common/enums/tenant.enum'
import { LogMailTransport } from '../src/modules/mail/transports/log.transport'

/**
 * Redefinição de senha, testada como superfície de ataque:
 *
 *   • a resposta é a mesma para e-mail que existe e para e-mail que não existe
 *     — senão a rota vira um verificador de quem é cliente;
 *   • o token só existe em texto claro dentro do e-mail; o banco guarda o hash;
 *   • pedir de novo mata o link anterior;
 *   • usar o link duas vezes não funciona;
 *   • redefinir derruba as sessões abertas — inclusive a de quem tomou a conta,
 *     que é o motivo de a pessoa estar redefinindo.
 *
 * Pré-requisito: MySQL de teste acessível (`npm run test:e2e`).
 */
describe('Redefinição de senha (e2e)', () => {
  let app: INestApplication
  let dataSource: DataSource
  let caixaDeSaida: LogMailTransport

  const carimbo = Date.now()
  const senhaAntiga = 'senha12345'
  const senhaNova = 'outrasenha99'

  const conta = {
    name: 'Marcos Cuidador',
    email: `marcos.${carimbo}@mnvma.test`,
    password: senhaAntiga,
    accountType: TenantType.INDIVIDUAL,
  }

  const post = (url: string, token?: string) => {
    const req = request(app.getHttpServer()).post(url)
    return token ? req.set('Authorization', `Bearer ${token}`) : req
  }

  /** O link só existe no e-mail; daqui sai o token que a tela receberia. */
  const tokenDoUltimoEmail = (tag: string): string => {
    const mensagem = caixaDeSaida.ultimoPara(conta.email, tag)
    if (!mensagem) throw new Error(`nenhum e-mail "${tag}" para ${conta.email}`)
    const [link] = LogMailTransport.linksDe(mensagem)
    return link.split('/').pop() as string
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('v1')
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()

    dataSource = app.get(DataSource)
    caixaDeSaida = app.get(LogMailTransport)

    await post('/v1/auth/register').send(conta).expect(201)
    caixaDeSaida.limpar()
  })

  afterAll(async () => {
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 0')
    await dataSource.query(
      'DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM users WHERE email = ?)',
      [conta.email],
    )
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 1')
    await app.close()
  })

  it('responde 204 para e-mail que não existe, igual ao que existe', async () => {
    await post('/v1/auth/forgot-password')
      .send({ email: `ninguem.${carimbo}@mnvma.test` })
      .expect(204)

    expect(caixaDeSaida.enviados).toHaveLength(0)
  })

  it('manda o link por e-mail e guarda só o hash', async () => {
    await post('/v1/auth/forgot-password').send({ email: conta.email }).expect(204)

    const token = tokenDoUltimoEmail('reset-senha')
    expect(token.length).toBeGreaterThan(20)

    const linhas = await dataSource.query<Array<{ token_hash: string }>>(
      `SELECT p.token_hash FROM password_reset_tokens p
         JOIN users u ON u.id = p.user_id
        WHERE u.email = ? AND p.used_at IS NULL`,
      [conta.email],
    )

    expect(linhas).toHaveLength(1)
    expect(linhas[0].token_hash).toHaveLength(64)
    expect(linhas[0].token_hash).not.toContain(token)
  })

  it('a prévia mostra o e-mail mascarado antes de a pessoa digitar a senha', async () => {
    const token = tokenDoUltimoEmail('reset-senha')
    const previa = await request(app.getHttpServer())
      .get(`/v1/auth/reset-password/${token}`)
      .expect(200)

    expect(previa.body.name).toBe(conta.name)
    expect(previa.body.email).toMatch(/^ma\*\*\*@mnvma\.test$/)
    // O endereço completo não pode sair daqui: quem interceptou o link ficaria
    // sabendo para onde ele foi.
    expect(previa.body.email).not.toBe(conta.email)
  })

  it('pedir de novo mata o link anterior', async () => {
    const anterior = tokenDoUltimoEmail('reset-senha')

    await post('/v1/auth/forgot-password').send({ email: conta.email }).expect(204)
    const novo = tokenDoUltimoEmail('reset-senha')

    expect(novo).not.toBe(anterior)
    await request(app.getHttpServer()).get(`/v1/auth/reset-password/${anterior}`).expect(400)
    await request(app.getHttpServer()).get(`/v1/auth/reset-password/${novo}`).expect(200)
  })

  it('token inexistente responde igual a token expirado: 400', async () => {
    await request(app.getHttpServer())
      .get('/v1/auth/reset-password/nao-existe-este-token-de-redefinicao')
      .expect(400)
  })

  it('redefine a senha, derruba as sessões e o link não serve duas vezes', async () => {
    // Sessão aberta antes da redefinição: é ela que precisa cair.
    const sessaoAntiga = await post('/v1/auth/login')
      .send({ email: conta.email, password: senhaAntiga })
      .expect(200)

    const cookieAntigo = pegarCookie(sessaoAntiga)
    const token = tokenDoUltimoEmail('reset-senha')

    await post('/v1/auth/reset-password').send({ token, password: senhaNova }).expect(204)

    // O refresh de quem estava logado antes não vale mais.
    await post('/v1/auth/refresh').set('Cookie', cookieAntigo).expect(401)

    await post('/v1/auth/login').send({ email: conta.email, password: senhaAntiga }).expect(401)
    await post('/v1/auth/login').send({ email: conta.email, password: senhaNova }).expect(200)

    // Reusar o link não redefine de novo.
    await post('/v1/auth/reset-password')
      .send({ token, password: 'maisumasenha1' })
      .expect(400)

    const aviso = caixaDeSaida.ultimoPara(conta.email, 'senha-alterada')
    expect(aviso?.subject).toContain('alterada')
  })

  it('recusa senha fraca com a mesma regra do cadastro', async () => {
    await post('/v1/auth/forgot-password').send({ email: conta.email }).expect(204)
    const token = tokenDoUltimoEmail('reset-senha')

    await post('/v1/auth/reset-password').send({ token, password: 'somenteletras' }).expect(400)
    await post('/v1/auth/reset-password').send({ token, password: 'curta1' }).expect(400)
  })

  it('trocar a senha logado exige a senha atual e renova a própria sessão', async () => {
    const sessao = await post('/v1/auth/login')
      .send({ email: conta.email, password: senhaNova })
      .expect(200)

    const accessToken = sessao.body.accessToken as string

    await post('/v1/auth/change-password', accessToken)
      .send({ currentPassword: 'chuteerrado1', password: 'terceirasenha7' })
      .expect(401)

    await post('/v1/auth/change-password', accessToken)
      .send({ currentPassword: senhaNova, password: senhaNova })
      .expect(400)

    const trocada = await post('/v1/auth/change-password', accessToken)
      .send({ currentPassword: senhaNova, password: 'terceirasenha7' })
      .expect(204)

    // A sessão de quem trocou continua de pé — com um refresh token novo.
    await post('/v1/auth/refresh').set('Cookie', pegarCookie(trocada)).expect(200)
    await post('/v1/auth/login').send({ email: conta.email, password: 'terceirasenha7' }).expect(200)
  })
})

function pegarCookie(resposta: request.Response): string {
  const cookies = resposta.headers['set-cookie'] as unknown as string[] | undefined
  const refresh = cookies?.find((c) => c.startsWith('mnvma_rt='))
  if (!refresh) throw new Error('resposta sem cookie de refresh')
  return refresh.split(';')[0]
}

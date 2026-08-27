import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { DataSource } from 'typeorm'

// Cada execução guarda os arquivos numa pasta temporária própria: o teste não
// pode sujar o `./uploads` de quem está desenvolvendo.
process.env.STORAGE_DRIVER = 'local'
process.env.STORAGE_LOCAL_DIR = mkdtempSync(join(tmpdir(), 'mnvma-uploads-'))

import { AppModule } from '../src/app.module'
import { TenantType } from '../src/common/enums/tenant.enum'
import { DocumentType } from '../src/modules/documents/entities/caregiver-document.entity'

/** Um PDF mínimo, com a assinatura de verdade nos primeiros bytes. */
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n', 'binary')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])

/**
 * O arquivo do documento do cuidador.
 *
 * É a lacuna que mais doía da auditoria: a validade do COREN era controlada,
 * mas o PDF não subia. O que esta suíte protege não é o upload em si — é o
 * acesso ao arquivo depois dele. Documento de cuidador tem CPF e foto, e o
 * risco aqui é o mesmo de um vazamento entre contas.
 *
 * Pré-requisito: MySQL de teste acessível (`npm run test:e2e`).
 */
describe('Arquivo do documento (e2e)', () => {
  let app: INestApplication
  let dataSource: DataSource

  const carimbo = Date.now()

  const empresa = {
    name: 'Ana Diretora',
    email: `ana.${carimbo}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.COMPANY,
    companyName: 'Cuidados Ana ME',
  }

  const rival = {
    name: 'Bruno Concorrente',
    email: `bruno.${carimbo}@mnvma.test`,
    password: 'senha12345',
    accountType: TenantType.COMPANY,
    companyName: 'Cuidados Bruno ME',
  }

  let token: string
  let tokenRival: string
  let tenantId: string
  let tenantRival: string
  let documentoId: string

  const post = (url: string, t = token) =>
    request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${t}`)
  const get = (url: string, t = token) =>
    request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${t}`)

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('v1')
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()

    dataSource = app.get(DataSource)

    const sessao = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send(empresa)
      .expect(201)
    token = sessao.body.accessToken
    tenantId = sessao.body.tenant.id

    const sessaoRival = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send(rival)
      .expect(201)
    tokenRival = sessaoRival.body.accessToken
    tenantRival = sessaoRival.body.tenant.id

    const cuidadora = await post('/v1/caregivers')
      .send({ name: 'Joana Cuidadora' })
      .expect(201)

    const documento = await post(`/v1/caregivers/${cuidadora.body.id}/documents`)
      .send({ type: DocumentType.COREN, number: '123456', expiresAt: '2027-12-31' })
      .expect(201)

    documentoId = documento.body.id
  })

  afterAll(async () => {
    await dataSource.query('SET @mnvma_system_scope = 1')
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const conta of [tenantId, tenantRival]) {
      for (const tabela of [
        'caregiver_documents',
        'coupon_redemptions',
        'subscription_payments',
        'subscriptions',
        'refresh_tokens',
        'users',
        'caregivers',
      ]) {
        await dataSource.query(`DELETE FROM ${tabela} WHERE tenant_id = ?`, [conta])
      }
      await dataSource.query('DELETE FROM tenants WHERE id = ?', [conta])
    }
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 1')
    await app.close()
  })

  // ─── Upload ─────────────────────────────────────────────────────────────────

  it('sem arquivo, o documento existe e não tem link', async () => {
    const documento = await get(`/v1/documents/${documentoId}`).expect(200)

    expect(documento.body.fileKey).toBeNull()
    expect(documento.body.fileUrl).toBeNull()
  })

  it('anexa o PDF e devolve o link assinado', async () => {
    const resposta = await post(`/v1/documents/${documentoId}/file`)
      .attach('file', PDF, { filename: 'coren-joana.pdf', contentType: 'application/pdf' })
      .expect(200)

    expect(resposta.body.fileName).toBe('coren-joana.pdf')
    expect(resposta.body.mimeType).toBe('application/pdf')
    expect(resposta.body.fileSize).toBe(PDF.length)
    expect(resposta.body.fileUploadedAt).toBeTruthy()

    // A chave é montada pelo servidor e começa pelo tenant: chave adivinhável
    // somada a link de vida longa seria como raspar documento dos outros.
    expect(resposta.body.fileKey).toMatch(
      new RegExp(`^tenants/${tenantId}/caregivers/[0-9a-f-]+/documents/${documentoId}/[0-9a-f-]+\\.pdf$`),
    )
    expect(resposta.body.fileUrl).toContain('/v1/files/')
    expect(resposta.body.fileUrl).toContain('sig=')
  })

  it('recusa arquivo com o tipo trocado', async () => {
    // Um executável anunciado como PDF. O `Content-Type` é palpite do cliente;
    // os primeiros bytes é que dizem a verdade.
    const executavel = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])

    const recusa = await post(`/v1/documents/${documentoId}/file`)
      .attach('file', executavel, { filename: 'virus.pdf', contentType: 'application/pdf' })
      .expect(400)

    expect(recusa.body.error.code).toBe('ARQUIVO_CORROMPIDO')
  })

  it('recusa tipo fora da lista', async () => {
    const recusa = await post(`/v1/documents/${documentoId}/file`)
      .attach('file', Buffer.from('<svg onload="alert(1)" />'), {
        filename: 'x.svg',
        contentType: 'image/svg+xml',
      })
      .expect(400)

    expect(recusa.body.error.code).toBe('TIPO_DE_ARQUIVO_NAO_ACEITO')
  })

  // ─── Download ───────────────────────────────────────────────────────────────

  it('o link assinado baixa o arquivo, sem sessão', async () => {
    const documento = await get(`/v1/documents/${documentoId}`).expect(200)
    const caminho = String(documento.body.fileUrl).replace(/^https?:\/\/[^/]+/, '')

    // Sem Authorization de propósito: a autorização está na assinatura da URL,
    // como num link presigned de bucket. É o que permite o navegador baixar
    // direto, sem o painel intermediar cada byte.
    const arquivo = await request(app.getHttpServer())
      .get(caminho)
      .buffer(true)
      .parse((res, callback) => {
        const pedacos: Buffer[] = []
        res.on('data', (pedaco: Buffer) => pedacos.push(pedaco))
        res.on('end', () => callback(null, Buffer.concat(pedacos)))
      })
      .expect(200)

    expect(arquivo.headers['content-type']).toContain('application/pdf')
    // `attachment` sempre: abrir arquivo de terceiro no mesmo domínio é caminho
    // conhecido de XSS.
    expect(arquivo.headers['content-disposition']).toContain('attachment')
    expect(arquivo.headers['content-disposition']).toContain('coren-joana.pdf')
    expect(arquivo.headers['x-content-type-options']).toBe('nosniff')
    expect((arquivo.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('link adulterado não baixa nada', async () => {
    const documento = await get(`/v1/documents/${documentoId}`).expect(200)
    const caminho = String(documento.body.fileUrl).replace(/^https?:\/\/[^/]+/, '')

    await request(app.getHttpServer()).get(caminho.replace(/sig=\w/, 'sig=0')).expect(404)
    await request(app.getHttpServer()).get(caminho.replace(/[?&]sig=[^&]+/, '')).expect(404)
  })

  it('link expirado não baixa nada', async () => {
    const documento = await get(`/v1/documents/${documentoId}`).expect(200)
    const url = new URL(String(documento.body.fileUrl))
    url.searchParams.set('exp', '1000000000')

    await request(app.getHttpServer())
      .get(`${url.pathname}${url.search}`)
      .expect(404)
  })

  it('não dá para escapar da pasta com ../ na chave', async () => {
    // Mesmo com assinatura válida — que ninguém de fora consegue produzir —, o
    // caminho é resolvido dentro da raiz e nada sobe de diretório.
    await request(app.getHttpServer())
      .get('/v1/files/../../../.env?exp=9999999999&sig=qualquer')
      .expect(404)
  })

  // ─── Isolamento ─────────────────────────────────────────────────────────────

  it('a conta vizinha não vê nem anexa nada neste documento', async () => {
    await get(`/v1/documents/${documentoId}`, tokenRival).expect(404)

    await post(`/v1/documents/${documentoId}/file`, tokenRival)
      .attach('file', PNG, { filename: 'x.png', contentType: 'image/png' })
      .expect(404)
  })

  // ─── Troca e remoção ────────────────────────────────────────────────────────

  it('trocar o arquivo apaga o anterior do armazenamento', async () => {
    const antes = await get(`/v1/documents/${documentoId}`).expect(200)
    const chaveAntiga = String(antes.body.fileKey)
    const urlAntiga = String(antes.body.fileUrl).replace(/^https?:\/\/[^/]+/, '')

    const depois = await post(`/v1/documents/${documentoId}/file`)
      .attach('file', PNG, { filename: 'coren-novo.png', contentType: 'image/png' })
      .expect(200)

    expect(depois.body.fileKey).not.toBe(chaveAntiga)
    expect(depois.body.mimeType).toBe('image/png')

    // Guardar as duas versões seria acumular documento pessoal sem que ninguém
    // consiga chegar nele pela tela: custo e risco sem utilidade.
    await request(app.getHttpServer()).get(urlAntiga).expect(404)
  })

  it('remover o arquivo mantém o documento e a validade', async () => {
    const depois = await request(app.getHttpServer())
      .delete(`/v1/documents/${documentoId}/file`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(depois.body.fileKey).toBeNull()
    expect(depois.body.fileUrl).toBeNull()
    // O que o produto controla é a validade; o arquivo é anexo dela.
    expect(depois.body.expiresAt).toBe('2027-12-31')
    expect(depois.body.status).toBe('VALID')
  })
})

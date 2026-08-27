import { validateEnv } from './env'

/**
 * O boot é o único lugar onde dá para recusar uma configuração errada de graça.
 * Depois dele, `STORAGE_LOCAL_DIR` apontando para o lugar errado não dá erro
 * nenhum: o upload funciona, o link funciona, e o arquivo some no deploy
 * seguinte — sem exceção, sem log, sem ninguém para contar.
 */
const base = {
  DATABASE_URL: 'mysql://sa:masterkey@localhost:3306/cuidador',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  APP_URL: 'https://app.mnvma.com.br',
  API_URL: 'https://api.mnvma.com.br',
}

describe('validateEnv — arquivos em disco', () => {
  it('aceita caminho relativo em desenvolvimento', () => {
    const env = validateEnv({ ...base, STORAGE_LOCAL_DIR: './uploads' })
    expect(env.STORAGE_DRIVER).toBe('local')
    expect(env.STORAGE_LOCAL_DIR).toBe('./uploads')
  })

  it.each(['production', 'staging'])('recusa caminho relativo em %s', (NODE_ENV) => {
    expect(() => validateEnv({ ...base, NODE_ENV, STORAGE_LOCAL_DIR: './uploads' })).toThrow(
      /caminho absoluto de um volume persistente/,
    )
  })

  it('recusa o padrão herdado em produção — quem não escolheu, não decidiu', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/STORAGE_LOCAL_DIR/)
  })

  it('aceita volume absoluto em produção', () => {
    const env = validateEnv({ ...base, NODE_ENV: 'production', STORAGE_LOCAL_DIR: '/data/uploads' })
    expect(env.STORAGE_LOCAL_DIR).toBe('/data/uploads')
  })

  it('não cobra caminho de quem foi para o bucket', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      STORAGE_LOCAL_DIR: './uploads',
      S3_BUCKET: 'mnvma-documents',
      S3_ACCESS_KEY_ID: 'chave',
      S3_SECRET_ACCESS_KEY: 'segredo',
    })
    expect(env.STORAGE_DRIVER).toBe('s3')
  })
})

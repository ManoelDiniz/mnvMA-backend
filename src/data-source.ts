import 'reflect-metadata'
import { config as loadEnv } from 'dotenv'
import { DataSource } from 'typeorm'
import { SnakeNamingStrategy } from 'typeorm-naming-strategies'

loadEnv()

const isCompiled = __filename.endsWith('.js')

/**
 * DataSource usado APENAS pela CLI do TypeORM (migration:run / revert).
 * O runtime da aplicação usa TypeOrmModule.forRootAsync em app.module.ts.
 *
 * `timezone: 'Z'` é obrigatório: o MySQL não tem tipo com fuso, então tudo é
 * gravado em UTC e convertido só na borda. Sem isto, um plantão das 19h vira
 * 22h dependendo do fuso do servidor.
 */
export default new DataSource({
  type: 'mysql',
  url: process.env.DATABASE_URL,
  timezone: 'Z',
  charset: 'utf8mb4_0900_ai_ci',
  // DATE como string: data de calendário não sofre conversão de fuso.
  dateStrings: ['DATE'],
  supportBigNumbers: true,
  bigNumberStrings: false,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  entities: [isCompiled ? 'dist/**/*.entity.js' : 'src/**/*.entity.ts'],
  migrations: [isCompiled ? 'dist/database/migrations/*.js' : 'src/database/migrations/*.ts'],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  logging: ['error', 'warn', 'migration'],
})

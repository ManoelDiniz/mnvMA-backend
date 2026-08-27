import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Logger } from 'nestjs-pino'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import type { Env } from './config/env'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true })
  const config = app.get(ConfigService<Env, true>)
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production'

  app.useLogger(app.get(Logger))
  app.setGlobalPrefix('v1')
  app.use(cookieParser())
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))

  // Atrás do load balancer do Railway/Render: sem isto, req.ip vira o IP do
  // proxy e o rate limit passa a valer para o mundo inteiro junto.
  app.set('trust proxy', 1)

  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true, // o refresh token viaja em cookie httpOnly
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    maxAge: 86_400,
  })

  app.enableShutdownHooks()

  if (!isProduction) {
    const swagger = new DocumentBuilder()
      .setTitle('MNVMA API')
      .setDescription('API do MNVMA Care — gestão para cuidadores e empresas de cuidadores')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build()

    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger), {
      swaggerOptions: { persistAuthorization: true },
    })
  }

  const port = config.get('PORT', { infer: true })
  await app.listen(port, '0.0.0.0')

  const logger = app.get(Logger)
  logger.log(`MNVMA API em http://localhost:${port}/v1`)
  if (!isProduction) logger.log(`Swagger em http://localhost:${port}/docs`)
}

void bootstrap()

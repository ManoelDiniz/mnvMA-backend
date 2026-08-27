import { Module, ValidationPipe } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LoggerModule } from 'nestjs-pino'
import { SnakeNamingStrategy } from 'typeorm-naming-strategies'
import { CommonModule } from './common/common.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'
import { PermissionsGuard } from './common/guards/permissions.guard'
import { PlanLimitGuard } from './modules/billing/plan-limit.guard'
import { SuperAdminGuard } from './common/guards/super-admin.guard'
import { TenantStatusGuard } from './common/guards/tenant-status.guard'
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor'
import { validationExceptionFactory } from './common/pipes/validation-exception.factory'
import type { AuthenticatedRequest } from './common/types/authenticated-request'
import { validateEnv, type Env } from './config/env'
import { AdminModule } from './modules/admin/admin.module'
import { AuthModule } from './modules/auth/auth.module'
import { BillingModule } from './modules/billing/billing.module'
import { CaregiversModule } from './modules/caregivers/caregivers.module'
import { ContractsModule } from './modules/contracts/contracts.module'
import { CustomersModule } from './modules/customers/customers.module'
import { DocumentsModule } from './modules/documents/documents.module'
import { FinanceModule } from './modules/finance/finance.module'
import { HealthModule } from './modules/health/health.module'
import { JobsModule } from './modules/jobs/jobs.module'
import { MailModule } from './modules/mail/mail.module'
import { OccurrencesModule } from './modules/occurrences/occurrences.module'
import { ReportsModule } from './modules/reports/reports.module'
import { SchedulesModule } from './modules/schedules/schedules.module'
import { ServicesModule } from './modules/services/services.module'
import { ShiftsModule } from './modules/shifts/shifts.module'
import { UsersModule } from './modules/users/users.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
          // Nunca logar credencial nem token — o log vai para um agregador
          // externo e vive meses.
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'res.headers["set-cookie"]',
          ],
          autoLogging: { ignore: (req) => req.url === '/v1/health' },
        },
      }),
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        type: 'mysql' as const,
        url: config.get('DATABASE_URL', { infer: true }),
        ssl: config.get('DATABASE_SSL', { infer: true }) ? { rejectUnauthorized: false } : undefined,
        // MySQL não tem tipo com fuso: grava-se UTC e converte-se na borda.
        timezone: 'Z',
        charset: 'utf8mb4_0900_ai_ci',
        autoLoadEntities: true,
        // `synchronize` nunca, em ambiente nenhum: toda mudança de schema é
        // migration versionada e revertível.
        synchronize: false,
        migrationsRun: false,
        namingStrategy: new SnakeNamingStrategy(),
        logging: config.get('DATABASE_LOGGING', { infer: true }) ? ['query', 'error'] : ['error'],
        extra: {
          connectionLimit: 20,
          enableKeepAlive: true,
          // Coluna DATE é data de calendário — não tem hora nem fuso. Sem isto o
          // mysql2 a converte para Date em UTC e, no fuso do Brasil, "12/09"
          // volta como "11/09". DATETIME continua vindo como Date, que é o
          // correto para instante no tempo.
          dateStrings: ['DATE'],
        },
      }),
    }),

    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],

      /**
       * Conta a cota por USUÁRIO quando há sessão, e só cai no IP nas rotas
       * públicas.
       *
       * Contar por IP parece o padrão seguro, mas quebra o cliente real: uma
       * empresa com cinco pessoas na coordenação sai toda pelo mesmo IP do
       * escritório, e as cinco dividiriam 120 requisições por minuto. A primeira
       * a abrir o painel derrubaria as outras.
       *
       * Roda depois do JwtAuthGuard (ver a ordem em `providers`), então
       * `req.user` já existe aqui.
       */
      getTracker: (req: Record<string, unknown>) => {
        const requisicao = req as unknown as AuthenticatedRequest
        return requisicao.user?.userId
          ? `u:${requisicao.user.userId}`
          : `ip:${requisicao.ip ?? 'desconhecido'}`
      },
    }),

    CommonModule,
    HealthModule,
    ScheduleModule.forRoot(),

    MailModule,
    BillingModule,
    AdminModule,
    JobsModule,
    AuthModule,
    CustomersModule,
    CaregiversModule,
    ServicesModule,
    ShiftsModule,
    SchedulesModule,
    ContractsModule,
    OccurrencesModule,
    DocumentsModule,
    FinanceModule,
    ReportsModule,
    UsersModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
        exceptionFactory: validationExceptionFactory,
      }),
    },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },

    // A ordem importa: autentica → confere estado da conta → confere permissão
    // → confere a cota do plano. O limite de plano vem por último porque é o
    // único que custa consulta ao banco, e não faz sentido pagá-la para quem
    // nem passou da autenticação.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantStatusGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
    { provide: APP_GUARD, useClass: PlanLimitGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // Roda depois dos guards: abre a transação e declara `app.tenant_id` nela.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}

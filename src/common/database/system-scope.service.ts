import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, type EntityManager } from 'typeorm'
import { RequestContext } from '../context/request-context'

/**
 * Escape hatch explícito para as poucas operações que precisam atravessar
 * tenants:
 *
 *   • login (o e-mail é procurado antes de sabermos o tenant)
 *   • refresh de sessão
 *   • webhooks do Mercado Pago (o tenant vem do external_reference)
 *   • jobs agendados que varrem todas as contas
 *   • MNVMA Core (Super Admin)
 *
 * Liga `@mnvma_system_scope` na sessão do MySQL, o que faz os triggers de
 * guarda liberarem a escrita. Toda chamada exige um motivo e vira log: se
 * aparecer no log algo fora da lista acima, é bug.
 */
@Injectable()
export class SystemScope {
  private readonly logger = new Logger(SystemScope.name)

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async run<T>(reason: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    this.logger.debug(`system scope: ${reason}`)

    return this.dataSource.transaction(async (manager) => {
      // `time_zone` junto: ver o comentário no TenantContextInterceptor — o
      // cadastro de conta acontece por aqui, e é dele que sai o primeiro
      // `created_at` de todo tenant.
      await manager.query(
        "SET @mnvma_system_scope = 1, @mnvma_tenant_id = NULL, time_zone = '+00:00'",
      )

      const parent = RequestContext.tryGet()

      try {
        return await RequestContext.run(
          {
            tenantId: parent?.tenantId ?? null,
            userId: parent?.userId ?? null,
            role: parent?.role ?? null,
            caregiverId: parent?.caregiverId ?? null,
            requestId: parent?.requestId,
            manager,
            systemScope: true,
          },
          () => fn(manager),
        )
      } finally {
        // A conexão volta para o pool: desligar a flag evita que a próxima
        // requisição herde permissão cross-tenant por acidente.
        await manager.query('SET @mnvma_system_scope = 0')
      }
    })
  }

  /** Igual ao run(), porém já dentro de um tenant específico (jobs por conta). */
  async runAsTenant<T>(
    tenantId: string,
    reason: string,
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    this.logger.debug(`tenant scope [${tenantId}]: ${reason}`)

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        "SET @mnvma_tenant_id = ?, @mnvma_system_scope = 0, time_zone = '+00:00'",
        [tenantId],
      )

      return RequestContext.run(
        {
          tenantId,
          userId: null,
          role: null,
          caregiverId: null,
          manager,
        },
        () => fn(manager),
      )
    })
  }
}

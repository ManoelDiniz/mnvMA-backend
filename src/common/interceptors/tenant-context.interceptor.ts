import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { Observable, from, lastValueFrom } from 'rxjs'
import { DataSource } from 'typeorm'
import { RequestContext } from '../context/request-context'
import type { AuthenticatedRequest } from '../types/authenticated-request'

/**
 * O id do request vem do pino-http e pode ser string, número ou nada. Só estes
 * viram texto: qualquer outra coisa stringifica como `[object Object]` e polui
 * o log em vez de identificar a requisição.
 */
const requestIdOf = (request: { id?: unknown }): string | undefined =>
  typeof request.id === 'string' || typeof request.id === 'number'
    ? String(request.id)
    : undefined

/** Um SELECT que passa disso é bug, não lentidão. */
const MAX_EXECUTION_TIME_MS = 15_000

/**
 * Abre uma transação por requisição autenticada e declara o tenant nela.
 *
 * O MySQL não tem Row Level Security (diferente do PostgreSQL), então o
 * isolamento de LEITURA fica por conta do TenantScopedRepository — nenhum
 * service consulta sem o filtro, e a suíte de isolamento prova isso a cada PR.
 *
 * Para a ESCRITA existe rede de proteção no banco: a variável de sessão
 * `@mnvma_tenant_id` definida aqui é conferida por triggers BEFORE INSERT/UPDATE
 * em toda tabela com `tenant_id`. Gravar linha de outro tenant estoura no MySQL,
 * mesmo que o bug esteja na aplicação.
 *
 * Dois efeitos colaterais desejados:
 *   1. Atomicidade — se o handler lança, tudo volta atrás.
 *   2. Falha fechada — service que rode fora deste contexto não acha o
 *      EntityManager e estoura, em vez de consultar sem filtro.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle()

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const user = request.user

    // Rota pública (login, webhook, health): sem tenant. Quem precisar
    // atravessar contas usa SystemScope.run() de forma explícita.
    if (!user?.tenantId) return next.handle()

    return from(
      this.dataSource.transaction(async (manager) => {
        await manager.query(
          // `time_zone` na mesma ida ao banco: sem isto o MySQL resolve
          // `CURRENT_TIMESTAMP` no fuso do SERVIDOR, e as colunas com
          // `DEFAULT CURRENT_TIMESTAMP(6)` (todo `created_at`/`updated_at` do
          // schema) gravam hora local enquanto o resto da aplicação grava UTC.
          // O mysql2 lê tudo como UTC (`timezone: 'Z'`), então a diferença
          // aparecia como "convite enviado há 3 h" um segundo depois de criá-lo.
          "SET @mnvma_tenant_id = ?, @mnvma_system_scope = 0, time_zone = '+00:00'",
          [user.tenantId],
        )
        await manager.query(`SET SESSION max_execution_time = ${MAX_EXECUTION_TIME_MS}`)

        return RequestContext.run(
          {
            tenantId: user.tenantId,
            userId: user.userId,
            role: user.role,
            caregiverId: user.caregiverId ?? null,
            requestId: requestIdOf(request),
            manager,
          },
          () => lastValueFrom(next.handle()),
        )
      }),
    )
  }
}

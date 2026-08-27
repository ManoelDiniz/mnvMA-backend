import { AsyncLocalStorage } from 'node:async_hooks'
import { InternalServerErrorException } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import type { UserRole } from '../enums/user-role.enum'

export interface RequestStore {
  /** Tenant dono da requisição. `null` em rotas públicas/sistema. */
  tenantId: string | null
  userId: string | null
  role: UserRole | null
  /** Id do cuidador vinculado ao usuário (papel CAREGIVER). */
  caregiverId: string | null
  /** EntityManager da transação do request. É o ÚNICO que enxerga o tenant. */
  manager: EntityManager
  requestId?: string
  /** `true` dentro de SystemScope.run() — libera leitura cross-tenant. */
  systemScope?: boolean
}

const storage = new AsyncLocalStorage<RequestStore>()

export const RequestContext = {
  run<T>(store: RequestStore, fn: () => Promise<T>): Promise<T> {
    return storage.run(store, fn)
  },

  /** Store atual. Lança se chamado fora de um request/scope — falha fechada. */
  get(): RequestStore {
    const store = storage.getStore()
    if (!store) {
      throw new InternalServerErrorException(
        'RequestContext ausente: esta operação precisa rodar dentro de um request ' +
          'ou de SystemScope.run(). Sem ele o filtro de tenant não é aplicado.',
      )
    }
    return store
  },

  tryGet(): RequestStore | null {
    return storage.getStore() ?? null
  },

  tenantId(): string {
    const { tenantId } = RequestContext.get()
    if (!tenantId) {
      throw new InternalServerErrorException('Tenant ausente no contexto da requisição.')
    }
    return tenantId
  },

  manager(): EntityManager {
    return RequestContext.get().manager
  },
}

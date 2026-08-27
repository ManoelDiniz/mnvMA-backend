import { Injectable, UnauthorizedException } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { TenantStatus } from '../enums/tenant.enum'

interface CacheEntry {
  status: TenantStatus
  expiresAt: number
}

const TTL_MS = 30_000

/**
 * O status comercial da conta é consultado a cada requisição pelo
 * TenantStatusGuard, que roda ANTES da transação do request — por isso a
 * consulta é direta e cacheada em memória.
 *
 * TTL curto de propósito: quem acabou de pagar volta a escrever em até 30
 * segundos, e quem foi suspenso perde a escrita no mesmo prazo. Colocar o
 * status dentro do JWT seria mais barato, mas deixaria o cliente esperando o
 * token expirar (15 min) depois de regularizar — inaceitável.
 *
 * Em múltiplas instâncias cada uma tem seu cache; o efeito é o mesmo, já que a
 * fonte da verdade continua sendo o banco.
 */
@Injectable()
export class TenantStatusCache {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async get(tenantId: string): Promise<TenantStatus> {
    const cached = this.cache.get(tenantId)
    if (cached && cached.expiresAt > Date.now()) return cached.status

    // Consulta pontual por chave primária, antes da transação do request.
    const rows = await this.dataSource.query<Array<{ status: TenantStatus }>>(
      'SELECT status FROM tenants WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [tenantId],
    )

    if (rows.length === 0) {
      this.cache.delete(tenantId)
      throw new UnauthorizedException('Conta não encontrada.')
    }

    const status = rows[0].status
    this.cache.set(tenantId, { status, expiresAt: Date.now() + TTL_MS })
    return status
  }

  /** Chamado pelo billing ao mudar o status, para refletir na hora. */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId)
  }
}

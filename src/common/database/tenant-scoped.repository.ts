import { Inject, NotFoundException } from '@nestjs/common'
import type {
  DeepPartial,
  EntityTarget,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm'
import { RequestContext } from '../context/request-context'
import type { TenantBaseEntity } from '../entities/base.entity'

/**
 * Repositório com `tenant_id` obrigatório em toda operação.
 *
 * O MySQL não tem Row Level Security, então esta classe é a PRIMEIRA linha de
 * defesa do isolamento na leitura: o código de negócio nunca escreve `where
 * tenant_id`, e uma chamada fora do contexto de requisição estoura em vez de
 * consultar sem filtro. A escrita ainda é conferida por triggers no banco (ver
 * a migration inicial), e a suíte `test/tenant-isolation.e2e-spec.ts` prova que
 * tudo continua valendo a cada PR.
 *
 * Regra do projeto: nenhum service injeta `Repository<T>` do TypeORM
 * diretamente. Sempre `TenantScopedRepository<T>`.
 */
export class TenantScopedRepository<T extends TenantBaseEntity & ObjectLiteral> {
  constructor(private readonly target: EntityTarget<T>) {}

  private get repo(): Repository<T> {
    return RequestContext.manager().getRepository(this.target)
  }

  get tenantId(): string {
    return RequestContext.tenantId()
  }

  // ─── Leitura ────────────────────────────────────────────────────────────────

  find(options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.repo.find({ ...options, where: this.scope(options.where) })
  }

  findAndCount(options: FindManyOptions<T> = {}): Promise<[T[], number]> {
    return this.repo.findAndCount({ ...options, where: this.scope(options.where) })
  }

  findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repo.findOne({ ...options, where: this.scope(options.where) })
  }

  async findOneOrFail(options: FindOneOptions<T>, message = 'Registro não encontrado'): Promise<T> {
    const found = await this.findOne(options)
    // 404 e não 403: 403 confirmaria que o recurso existe em outro tenant.
    if (!found) throw new NotFoundException(message)
    return found
  }

  findById(id: string, options: Omit<FindOneOptions<T>, 'where'> = {}): Promise<T | null> {
    return this.findOne({ ...options, where: { id } as FindOptionsWhere<T> })
  }

  async findByIdOrFail(
    id: string,
    options: Omit<FindOneOptions<T>, 'where'> = {},
    message = 'Registro não encontrado',
  ): Promise<T> {
    return this.findOneOrFail({ ...options, where: { id } as FindOptionsWhere<T> }, message)
  }

  count(options: FindManyOptions<T> = {}): Promise<number> {
    return this.repo.count({ ...options, where: this.scope(options.where) })
  }

  exists(where: FindOptionsWhere<T>): Promise<boolean> {
    return this.repo.exists({ where: this.scope(where) })
  }

  // ─── Escrita ────────────────────────────────────────────────────────────────

  create(data: DeepPartial<T>): T {
    return this.repo.create({ ...data, tenantId: this.tenantId } as DeepPartial<T>)
  }

  save(entity: DeepPartial<T>): Promise<T> {
    return this.repo.save({ ...entity, tenantId: this.tenantId } as DeepPartial<T>)
  }

  async createAndSave(data: DeepPartial<T>): Promise<T> {
    return this.repo.save(this.create(data))
  }

  /** Atualiza dentro do tenant. Devolve a entidade recarregada. */
  async updateById(id: string, patch: DeepPartial<T>): Promise<T> {
    const entity = await this.findByIdOrFail(id)
    Object.assign(entity, patch)
    return this.repo.save(entity)
  }

  async softDeleteById(id: string): Promise<void> {
    await this.findByIdOrFail(id)
    await this.repo.softDelete({ id, tenantId: this.tenantId } as FindOptionsWhere<T>)
  }

  // ─── QueryBuilder ───────────────────────────────────────────────────────────

  /** QueryBuilder já filtrado pelo tenant. Use para relatórios e agregações. */
  qb(alias: string): SelectQueryBuilder<T> {
    return this.repo
      .createQueryBuilder(alias)
      .where(`${alias}.tenantId = :__tenantId`, { __tenantId: this.tenantId })
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private scope(
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  ): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
    const tenant = { tenantId: this.tenantId } as FindOptionsWhere<T>
    if (Array.isArray(where)) return where.map((w) => ({ ...w, ...tenant }))
    return { ...(where ?? {}), ...tenant }
  }
}

// ─── Wiring de DI ─────────────────────────────────────────────────────────────

export function tenantRepositoryToken(entity: EntityTarget<ObjectLiteral>): string {
  const name =
    typeof entity === 'function'
      ? entity.name
      : typeof entity === 'string'
        ? entity
        : String((entity as { name?: string }).name)
  return `TENANT_REPOSITORY_${name}`
}

/** Registra o repositório escopado de uma entidade no módulo. */
export function provideTenantRepository<T extends TenantBaseEntity & ObjectLiteral>(
  entity: EntityTarget<T>,
) {
  return {
    provide: tenantRepositoryToken(entity),
    useFactory: () => new TenantScopedRepository<T>(entity),
  }
}

/** `constructor(@InjectTenantRepository(Customer) private readonly customers: TenantScopedRepository<Customer>)` */
export const InjectTenantRepository = (entity: EntityTarget<ObjectLiteral>) =>
  Inject(tenantRepositoryToken(entity))

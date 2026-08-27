import { ConflictException, Injectable } from '@nestjs/common'
import { RequestContext } from '../../common/context/request-context'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { PageDto } from '../../common/dto/pagination.dto'
import { isValidCpf } from '../../common/utils/cpf'
import { CustomerResponsible } from './entities/customer-responsible.entity'
import { Customer } from './entities/customer.entity'
import type {
  CreateCustomerDto,
  CustomerQueryDto,
  ResponsibleInputDto,
  UpdateCustomerDto,
} from './dto/customer.dto'

@Injectable()
export class CustomersService {
  constructor(
    @InjectTenantRepository(Customer)
    private readonly customers: TenantScopedRepository<Customer>,
    @InjectTenantRepository(CustomerResponsible)
    private readonly responsibles: TenantScopedRepository<CustomerResponsible>,
  ) {}

  async list(query: CustomerQueryDto): Promise<PageDto<Customer>> {
    const qb = this.customers.qb('c')

    if (query.status !== 'all') {
      qb.andWhere('c.isActive = :active', { active: query.status === 'active' })
    }

    if (query.q) {
      // A collation utf8mb4_0900_ai_ci ignora acento e caixa, então "jose" já
      // encontra "José" sem função nenhuma em volta da coluna.
      const digits = query.q.replace(/\D/g, '')
      qb.andWhere(
        digits
          ? '(c.name LIKE :like OR c.cpf LIKE :digits OR c.phone LIKE :digits)'
          : '(c.name LIKE :like)',
        { like: `%${query.q}%`, digits: `%${digits}%` },
      )
    }

    const [column, direction] = query.sort.startsWith('-')
      ? [query.sort.slice(1), 'DESC' as const]
      : [query.sort, 'ASC' as const]

    qb.orderBy(column === 'name' ? 'c.name' : 'c.createdAt', direction)
      .skip(query.skip)
      .take(query.perPage)

    const [data, total] = await qb.getManyAndCount()
    return new PageDto(data, total, query)
  }

  async findOne(id: string): Promise<Customer> {
    return this.customers.findByIdOrFail(
      id,
      { relations: { responsibles: true } },
      'Cliente não encontrado.',
    )
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    await this.assertCpfIsFree(dto.cpf)

    const customer = await this.customers.createAndSave({
      name: dto.name,
      cpf: dto.cpf ?? null,
      birthDate: dto.birthDate ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      address: dto.address ?? null,
      notes: dto.notes ?? null,
      isActive: true,
    })

    if (dto.responsibles?.length) {
      await this.syncResponsibles(customer.id, dto.responsibles)
    }

    return this.findOne(customer.id)
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.customers.findByIdOrFail(id, {}, 'Cliente não encontrado.')

    if (dto.cpf !== undefined && dto.cpf !== customer.cpf) {
      await this.assertCpfIsFree(dto.cpf, id)
    }

    const { responsibles, ...fields } = dto
    await this.customers.updateById(id, fields)

    if (responsibles) {
      await this.syncResponsibles(id, responsibles)
    }

    return this.findOne(id)
  }

  /**
   * Soft delete. Cliente com histórico de plantão e cobrança não é apagado —
   * some das listas, mas os relatórios do ano passado continuam batendo.
   */
  async remove(id: string): Promise<void> {
    await this.customers.softDeleteById(id)
  }

  // ─── Responsáveis ───────────────────────────────────────────────────────────

  private async syncResponsibles(
    customerId: string,
    input: ResponsibleInputDto[],
  ): Promise<void> {
    const manager = RequestContext.manager()
    const existing = await this.responsibles.find({ where: { customerId } })

    const keepIds = new Set(input.filter((r) => r.id).map((r) => r.id as string))
    const removed = existing.filter((r) => !keepIds.has(r.id))

    if (removed.length) {
      await manager.getRepository(CustomerResponsible).softDelete(removed.map((r) => r.id))
    }

    for (const item of input) {
      const payload = {
        customerId,
        name: item.name,
        relationship: item.relationship ?? null,
        phone: item.phone ?? null,
        email: item.email ?? null,
        isPrimary: item.isPrimary ?? false,
        isFinancial: item.isFinancial ?? false,
        isEmergency: item.isEmergency ?? false,
      }

      if (item.id && existing.some((r) => r.id === item.id)) {
        await this.responsibles.updateById(item.id, payload)
      } else {
        await this.responsibles.createAndSave(payload)
      }
    }
  }

  // ─── Validações ─────────────────────────────────────────────────────────────

  private async assertCpfIsFree(cpf: string | null | undefined, ignoreId?: string): Promise<void> {
    if (!cpf) return

    if (!isValidCpf(cpf)) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: 'CPF inválido.',
        fields: { cpf: 'CPF inválido.' },
      })
    }

    const qb = this.customers.qb('c').andWhere('c.cpf = :cpf', { cpf })
    if (ignoreId) qb.andWhere('c.id != :ignoreId', { ignoreId })

    if (await qb.getExists()) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: 'Já existe um cliente com este CPF.',
        fields: { cpf: 'Já existe um cliente com este CPF.' },
      })
    }
  }
}

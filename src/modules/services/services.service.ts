import { ConflictException, Injectable } from '@nestjs/common'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { fromCents, toCents } from '../../common/database/decimal.transformer'
import { PageDto } from '../../common/dto/pagination.dto'
import { Service } from './entities/service.entity'
import type {
  CreateServiceDto,
  ServiceQueryDto,
  ServiceResponseDto,
  UpdateServiceDto,
} from './dto/service.dto'

@Injectable()
export class ServicesService {
  constructor(
    @InjectTenantRepository(Service)
    private readonly services: TenantScopedRepository<Service>,
  ) {}

  async list(query: ServiceQueryDto): Promise<PageDto<ServiceResponseDto>> {
    const qb = this.services.qb('s')

    if (query.status !== 'all') {
      qb.andWhere('s.isActive = :ativo', { ativo: query.status === 'active' })
    }
    if (query.q) {
      qb.andWhere('(s.name LIKE :busca OR s.code LIKE :busca)', { busca: `%${query.q}%` })
    }

    const [dados, total] = await qb
      .orderBy('s.name', 'ASC')
      .skip(query.skip)
      .take(query.perPage)
      .getManyAndCount()

    return new PageDto(dados.map(comCalculos), total, query)
  }

  async findOne(id: string): Promise<ServiceResponseDto> {
    return comCalculos(await this.services.findByIdOrFail(id, {}, 'Serviço não encontrado.'))
  }

  async create(dto: CreateServiceDto): Promise<ServiceResponseDto> {
    await this.assertCodigoLivre(dto.code)

    const servico = await this.services.createAndSave({
      name: dto.name,
      code: dto.code ?? null,
      unit: dto.unit,
      salePrice: dto.salePrice,
      caregiverCost: dto.caregiverCost ?? null,
      hours: dto.hours ?? null,
      notes: dto.notes ?? null,
      isActive: true,
    })

    return comCalculos(servico)
  }

  async update(id: string, dto: UpdateServiceDto): Promise<ServiceResponseDto> {
    const atual = await this.services.findByIdOrFail(id, {}, 'Serviço não encontrado.')

    if (dto.code !== undefined && dto.code !== atual.code) {
      await this.assertCodigoLivre(dto.code, id)
    }

    // Alterar o preço aqui NÃO mexe em plantão já criado: cada plantão guarda
    // os próprios valores. Sem isso, corrigir uma tabela de preços reescreveria
    // o faturamento dos meses anteriores.
    return comCalculos(await this.services.updateById(id, dto))
  }

  async remove(id: string): Promise<void> {
    await this.services.softDeleteById(id)
  }

  private async assertCodigoLivre(code: string | null | undefined, ignoreId?: string) {
    if (!code) return

    const qb = this.services.qb('s').andWhere('s.code = :code', { code })
    if (ignoreId) qb.andWhere('s.id != :ignoreId', { ignoreId })

    if (await qb.getExists()) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: 'Já existe um serviço com este código.',
        fields: { code: 'Já existe um serviço com este código.' },
      })
    }
  }
}

/**
 * Margem é DERIVADA, nunca coluna.
 *
 * Guardar margem calculada é garantia de inconsistência: basta alguém editar o
 * valor de venda e esquecer de recalcular. Aqui ela sai do valor atual, sempre.
 */
export function comCalculos(servico: Service): ServiceResponseDto {
  const venda = toCents(servico.salePrice)
  const custo = toCents(servico.caregiverCost)
  const margem = venda - custo

  const horas = servico.hours ? Number(servico.hours) : null

  return {
    id: servico.id,
    name: servico.name,
    code: servico.code ?? null,
    unit: servico.unit,
    salePrice: servico.salePrice,
    caregiverCost: servico.caregiverCost ?? null,
    hours: servico.hours ?? null,
    notes: servico.notes ?? null,
    isActive: servico.isActive,
    margin: fromCents(margem),
    marginPercent: venda > 0n ? Math.round(Number((margem * 1000n) / venda)) / 10 : null,
    // Divisão por horas fracionadas (12,5h) precisa passar por float; o
    // arredondamento é para centavo e serve só para exibir.
    hourlyRate: horas && horas > 0 ? fromCents(BigInt(Math.round(Number(venda) / horas))) : null,
  }
}

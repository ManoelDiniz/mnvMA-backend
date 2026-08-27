import { ConflictException, Injectable } from '@nestjs/common'
import {
  InjectTenantRepository,
  TenantScopedRepository,
} from '../../common/database/tenant-scoped.repository'
import { PageDto } from '../../common/dto/pagination.dto'
import { isValidCpf } from '../../common/utils/cpf'
import { Caregiver } from './entities/caregiver.entity'
import type {
  CaregiverQueryDto,
  CreateCaregiverDto,
  UpdateCaregiverDto,
} from './dto/caregiver.dto'

@Injectable()
export class CaregiversService {
  constructor(
    @InjectTenantRepository(Caregiver)
    private readonly caregivers: TenantScopedRepository<Caregiver>,
  ) {}

  async list(query: CaregiverQueryDto): Promise<PageDto<Caregiver>> {
    const qb = this.caregivers.qb('c')

    if (query.status !== 'all') {
      qb.andWhere('c.isActive = :ativo', { ativo: query.status === 'active' })
    }
    if (query.q) {
      qb.andWhere('(c.name LIKE :busca OR c.cpf LIKE :digitos OR c.phone LIKE :digitos)', {
        busca: `%${query.q}%`,
        digitos: `%${query.q.replace(/\D/g, '')}%`,
      })
    }

    const [data, total] = await qb
      // O dono da conta primeiro: na conta individual ele é o único, e na
      // empresarial é quem a pessoa reconhece na lista.
      .orderBy('c.isOwner', 'DESC')
      .addOrderBy('c.name', 'ASC')
      .skip(query.skip)
      .take(query.perPage)
      .getManyAndCount()

    return new PageDto(data, total, query)
  }

  findOne(id: string): Promise<Caregiver> {
    return this.caregivers.findByIdOrFail(id, {}, 'Cuidador não encontrado.')
  }

  async create(dto: CreateCaregiverDto): Promise<Caregiver> {
    await this.assertCpfLivre(dto.cpf)

    return this.caregivers.createAndSave({
      ...dto,
      cpf: dto.cpf ?? null,
      isOwner: false,
      isActive: true,
    })
  }

  async update(id: string, dto: UpdateCaregiverDto): Promise<Caregiver> {
    const atual = await this.findOne(id)

    if (dto.cpf !== undefined && dto.cpf !== atual.cpf) {
      await this.assertCpfLivre(dto.cpf, id)
    }

    return this.caregivers.updateById(id, dto)
  }

  /**
   * Soft delete, e nunca o dono da conta.
   *
   * Remover o registro do próprio dono quebraria a conta individual (é ele quem
   * executa os plantões) e deixaria o histórico sem autor.
   */
  async remove(id: string): Promise<void> {
    const cuidador = await this.findOne(id)

    if (cuidador.isOwner) {
      throw new ConflictException({
        code: 'OWNER_CAREGIVER',
        message: 'Este é o cadastro do titular da conta e não pode ser removido.',
      })
    }

    await this.caregivers.softDeleteById(id)
  }

  private async assertCpfLivre(cpf: string | null | undefined, ignorarId?: string): Promise<void> {
    if (!cpf) return

    if (!isValidCpf(cpf)) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: 'CPF inválido.',
        fields: { cpf: 'CPF inválido.' },
      })
    }

    const qb = this.caregivers.qb('c').andWhere('c.cpf = :cpf', { cpf })
    if (ignorarId) qb.andWhere('c.id != :ignorar', { ignorar: ignorarId })

    if (await qb.getExists()) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: 'Já existe um cuidador com este CPF.',
        fields: { cpf: 'Já existe um cuidador com este CPF.' },
      })
    }
  }
}

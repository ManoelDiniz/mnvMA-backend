import type { EntityManager } from 'typeorm'
import { UserRole } from '../../common/enums/user-role.enum'
import { User } from '../users/entities/user.entity'

/** Quem recebe aviso de dinheiro: só o titular. */
export const PAPEIS_DE_COBRANCA: readonly UserRole[] = [UserRole.OWNER]

/** Quem recebe aviso de operação: quem tem como resolver. */
export const PAPEIS_ADMINISTRATIVOS: readonly UserRole[] = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.MANAGER,
]

/**
 * Usuários ativos de um tenant nos papéis dados.
 *
 * Roda dentro do SystemScope (o job atravessa contas), por isso a consulta
 * filtra `tenantId` explicitamente em vez de contar com o repositório escopado.
 */
export async function destinatarios(
  manager: EntityManager,
  tenantId: string,
  papeis: readonly UserRole[],
): Promise<User[]> {
  return manager
    .getRepository(User)
    .createQueryBuilder('u')
    .where('u.tenantId = :tenantId', { tenantId })
    .andWhere('u.role IN (:...papeis)', { papeis })
    .andWhere('u.isActive = 1')
    .andWhere('u.deletedAt IS NULL')
    .orderBy('u.createdAt', 'ASC')
    .getMany()
}

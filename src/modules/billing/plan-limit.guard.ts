import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { PLAN_LIMIT_KEY } from '../../common/decorators'
import { TenantStatus } from '../../common/enums/tenant.enum'
import type { AuthenticatedRequest } from '../../common/types/authenticated-request'
import {
  PlanLimitsService,
  limiteDe,
  type RecursoLimitado,
} from './plan-limits.service'
import { Plan } from './entities/plan.entity'
import { Subscription } from './entities/subscription.entity'

/**
 * Devolve 402 quando a conta bateu o limite do plano.
 *
 * 402 e não 403 de propósito: o frontend distingue "você não tem permissão"
 * (403, não adianta insistir) de "seu plano acabou" (402, existe um caminho
 * para resolver) — e é o 402 que abre o modal de upgrade com o plano certo já
 * escolhido. Um 403 aqui viraria beco sem saída.
 *
 * Só age nas rotas marcadas com `@PlanLimit(...)`; nas outras devolve `true`
 * sem tocar no banco.
 */
@Injectable()
export class PlanLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limites: PlanLimitsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true

    const recurso = this.reflector.getAllAndOverride<RecursoLimitado>(PLAN_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!recurso) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const user = request.user
    if (!user) return true

    // Durante o teste, nada de limite.
    //
    // A conta nasce apontando para o primeiro plano do catálogo — que é o
    // gratuito, o mais apertado de todos. Cobrar os limites dele durante o
    // trial faria o produto quebrar a própria promessa ("14 dias com tudo
    // liberado") logo no quinto cliente cadastrado, e justamente com quem
    // ainda está decidindo se assina.
    //
    // `tenantStatus` já foi preenchido pelo TenantStatusGuard, que roda antes:
    // não custa consulta nenhuma.
    if (user.tenantStatus === TenantStatus.TRIAL) return true

    const plano = await this.planoDaConta(user.tenantId)
    // Sem assinatura ou sem plano: não é hora de barrar ninguém. Conta sem
    // catálogo é problema de instalação, e transformar isso em 402 esconderia
    // o problema real atrás de uma tela de upgrade.
    if (!plano) return true

    const limite = limiteDe(plano, recurso)
    if (limite === null) return true

    const uso = await this.limites.uso(user.tenantId)
    if (this.limites.cabeMaisUm(plano, recurso, uso)) return true

    // Payload plano, sem embrulhar em `error`: o HttpExceptionFilter é quem
    // monta o envelope único da API e repassa os campos extras para dentro dele.
    throw new HttpException(
      {
        code: 'PLAN_LIMIT_REACHED',
        message: `Seu plano ${plano.name} permite ${limite} ${this.limites.rotulo(recurso)}. Mude de plano para continuar.`,
        resource: recurso,
        limit: limite,
        used: uso[recurso],
        planCode: plano.code,
        planName: plano.name,
      },
      HttpStatus.PAYMENT_REQUIRED,
    )
  }

  /**
   * Consulta direta, fora do `RequestContext`: guards rodam ANTES do
   * interceptor que abre a transação do request, então aqui ainda não existe
   * o EntityManager escopado. O filtro por `tenant_id` é explícito.
   */
  private async planoDaConta(tenantId: string): Promise<Plan | null> {
    const assinatura = await this.dataSource.getRepository(Subscription).findOne({
      where: { tenantId },
      relations: { plan: true },
    })

    return assinatura?.plan ?? null
  }
}

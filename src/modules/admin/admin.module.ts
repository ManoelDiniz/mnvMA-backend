import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BillingModule } from '../billing/billing.module'
import { Subscription } from '../billing/entities/subscription.entity'
import { Tenant } from '../tenants/entities/tenant.entity'
import { User } from '../users/entities/user.entity'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AdminAction } from './entities/admin-action.entity'

/**
 * MNVMA Core — o painel do dono do SaaS.
 *
 * Módulo próprio, e não um canto do `billing`, porque o Core não é sobre
 * dinheiro: é sobre a plataforma inteira. Cobrança é só a primeira pergunta que
 * ele responde; a lista de contas, a auditoria e o que vier de suporte moram na
 * mesma casa.
 *
 * Importa `BillingModule` para reaproveitar a contagem de uso por conta — a
 * mesma que o limite de plano usa, e não uma segunda versão que fatalmente
 * divergiria da primeira.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AdminAction, Tenant, User, Subscription]), BillingModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}

import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { AuthModule } from '../auth/auth.module'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { Tenant } from '../tenants/entities/tenant.entity'
import { Invitation } from './entities/invitation.entity'
import { User } from './entities/user.entity'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

/**
 * Importa o AuthModule para reaproveitar login e cookie de sessão no aceite do
 * convite: quem acabou de escolher a senha entra pelo MESMO caminho de quem faz
 * login normal, com rotação de refresh e tudo mais. Um segundo caminho de
 * autenticação seria um segundo lugar para esquecer de revogar sessão.
 */
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([User, Invitation, Caregiver, Tenant])],
  controllers: [UsersController],
  providers: [
    UsersService,
    provideTenantRepository(User),
    provideTenantRepository(Invitation),
    provideTenantRepository(Caregiver),
  ],
  exports: [UsersService],
})
export class UsersModule {}

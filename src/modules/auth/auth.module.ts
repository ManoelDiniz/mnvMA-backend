import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { Plan } from '../billing/entities/plan.entity'
import { Subscription } from '../billing/entities/subscription.entity'
import { Tenant } from '../tenants/entities/tenant.entity'
import { User } from '../users/entities/user.entity'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { PasswordResetToken } from './entities/password-reset-token.entity'
import { RefreshToken } from './entities/refresh-token.entity'
import { PasswordService } from './password.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { TokenService } from './token.service'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // Sem `secret` global: cada assinatura escolhe o seu (access/refresh),
    // para que um segredo vazado não valide o outro tipo de token.
    JwtModule.register({}),
    TypeOrmModule.forFeature([
      Tenant,
      User,
      RefreshToken,
      PasswordResetToken,
      Caregiver,
      Plan,
      Subscription,
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, PasswordService, JwtStrategy],
  exports: [AuthService, TokenService, PasswordService],
})
export class AuthModule {}

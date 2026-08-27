import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { CaregiversModule } from '../caregivers/caregivers.module'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { Customer } from '../customers/entities/customer.entity'
import { FinanceModule } from '../finance/finance.module'
import { Service } from '../services/entities/service.entity'
import { Shift } from './entities/shift.entity'
import { ShiftSubstitution } from './entities/shift-substitution.entity'
import { User } from '../users/entities/user.entity'
import { ShiftsController } from './shifts.controller'
import { ShiftsService } from './shifts.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([Shift, ShiftSubstitution, Customer, Caregiver, Service, User]),
    FinanceModule,
    CaregiversModule,
  ],
  controllers: [ShiftsController],
  providers: [
    ShiftsService,
    provideTenantRepository(Shift),
    provideTenantRepository(Customer),
    provideTenantRepository(Caregiver),
    provideTenantRepository(Service),
    provideTenantRepository(ShiftSubstitution),
    provideTenantRepository(User),
  ],
  exports: [ShiftsService],
})
export class ShiftsModule {}

import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { Customer } from '../customers/entities/customer.entity'
import { AccountPayable } from './entities/account-payable.entity'
import { AccountReceivable } from './entities/account-receivable.entity'
import { FinanceController } from './finance.controller'
import { FinanceService } from './finance.service'
import { ShiftBillingService } from './shift-billing.service'

@Module({
  imports: [TypeOrmModule.forFeature([AccountReceivable, AccountPayable, Customer, Caregiver])],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    ShiftBillingService,
    provideTenantRepository(AccountReceivable),
    provideTenantRepository(AccountPayable),
    provideTenantRepository(Customer),
    provideTenantRepository(Caregiver),
  ],
  // ShiftsModule usa o ShiftBillingService para gerar os lançamentos quando um
  // plantão é concluído.
  exports: [FinanceService, ShiftBillingService],
})
export class FinanceModule {}

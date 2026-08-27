import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { Customer } from '../customers/entities/customer.entity'
import { AccountReceivable } from '../finance/entities/account-receivable.entity'
import { Service } from '../services/entities/service.entity'
import { ContractBillingService } from './contract-billing.service'
import { ContractsController } from './contracts.controller'
import { ContractsService } from './contracts.service'
import { Contract } from './entities/contract.entity'

@Module({
  imports: [
    TypeOrmModule.forFeature([Contract, Customer, Caregiver, Service, AccountReceivable]),
  ],
  controllers: [ContractsController],
  providers: [
    ContractsService,
    ContractBillingService,
    provideTenantRepository(Contract),
    provideTenantRepository(Customer),
    provideTenantRepository(Caregiver),
    provideTenantRepository(Service),
    provideTenantRepository(AccountReceivable),
  ],
  exports: [ContractsService, ContractBillingService],
})
export class ContractsModule {}

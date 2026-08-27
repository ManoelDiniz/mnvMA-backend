import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { CustomersController } from './customers.controller'
import { CustomersService } from './customers.service'
import { CustomerResponsible } from './entities/customer-responsible.entity'
import { Customer } from './entities/customer.entity'

@Module({
  imports: [TypeOrmModule.forFeature([Customer, CustomerResponsible])],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    provideTenantRepository(Customer),
    provideTenantRepository(CustomerResponsible),
  ],
  exports: [CustomersService],
})
export class CustomersModule {}

import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { Customer } from '../customers/entities/customer.entity'
import { Shift } from '../shifts/entities/shift.entity'
import { User } from '../users/entities/user.entity'
import { Occurrence } from './entities/occurrence.entity'
import { OccurrencesController } from './occurrences.controller'
import { OccurrencesService } from './occurrences.service'

@Module({
  imports: [TypeOrmModule.forFeature([Occurrence, Shift, Customer, Caregiver, User])],
  controllers: [OccurrencesController],
  providers: [
    OccurrencesService,
    provideTenantRepository(Occurrence),
    provideTenantRepository(Shift),
    provideTenantRepository(Customer),
    provideTenantRepository(Caregiver),
    provideTenantRepository(User),
  ],
  exports: [OccurrencesService],
})
export class OccurrencesModule {}

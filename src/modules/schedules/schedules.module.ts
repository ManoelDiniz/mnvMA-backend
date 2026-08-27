import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { Shift } from '../shifts/entities/shift.entity'
import { SchedulesController } from './schedules.controller'
import { SchedulesService } from './schedules.service'

@Module({
  imports: [TypeOrmModule.forFeature([Shift, Caregiver])],
  controllers: [SchedulesController],
  providers: [
    SchedulesService,
    provideTenantRepository(Shift),
    provideTenantRepository(Caregiver),
  ],
  exports: [SchedulesService],
})
export class SchedulesModule {}

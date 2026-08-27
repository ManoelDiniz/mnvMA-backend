import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { AvailabilityService } from './availability.service'
import { CaregiversController } from './caregivers.controller'
import { CaregiversService } from './caregivers.service'
import { CaregiverAvailability } from './entities/caregiver-availability.entity'
import { Caregiver } from './entities/caregiver.entity'

@Module({
  imports: [TypeOrmModule.forFeature([Caregiver, CaregiverAvailability])],
  controllers: [CaregiversController],
  providers: [
    CaregiversService,
    AvailabilityService,
    provideTenantRepository(Caregiver),
    provideTenantRepository(CaregiverAvailability),
  ],
  exports: [CaregiversService, AvailabilityService],
})
export class CaregiversModule {}

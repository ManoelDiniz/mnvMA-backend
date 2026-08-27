import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { Shift } from '../shifts/entities/shift.entity'
import { ReportsController } from './reports.controller'
import { ReportsService } from './reports.service'

@Module({
  imports: [TypeOrmModule.forFeature([Shift])],
  controllers: [ReportsController],
  providers: [ReportsService, provideTenantRepository(Shift)],
})
export class ReportsModule {}

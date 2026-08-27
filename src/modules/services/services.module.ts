import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { Service } from './entities/service.entity'
import { ServicesController } from './services.controller'
import { ServicesService } from './services.service'

@Module({
  imports: [TypeOrmModule.forFeature([Service])],
  controllers: [ServicesController],
  providers: [ServicesService, provideTenantRepository(Service)],
  exports: [ServicesService],
})
export class ServicesModule {}

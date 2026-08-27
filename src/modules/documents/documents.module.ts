import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { provideTenantRepository } from '../../common/database/tenant-scoped.repository'
import { Caregiver } from '../caregivers/entities/caregiver.entity'
import { DocumentsController } from './documents.controller'
import { DocumentsService } from './documents.service'
import { CaregiverDocument } from './entities/caregiver-document.entity'

@Module({
  imports: [TypeOrmModule.forFeature([CaregiverDocument, Caregiver])],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    provideTenantRepository(CaregiverDocument),
    provideTenantRepository(Caregiver),
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}

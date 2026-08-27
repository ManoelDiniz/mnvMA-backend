import { Global, Module } from '@nestjs/common'
import { SystemScope } from './database/system-scope.service'
import { TenantStatusCache } from './services/tenant-status.cache'

/**
 * Infra compartilhada por todos os módulos. Global porque contexto de tenant e
 * status da conta são transversais — importar isso em cada módulo só criaria
 * ruído.
 */
@Global()
@Module({
  providers: [SystemScope, TenantStatusCache],
  exports: [SystemScope, TenantStatusCache],
})
export class CommonModule {}

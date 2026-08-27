import { Controller, Get } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { DataSource } from 'typeorm'
import { Public } from '../../common/decorators'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness + readiness (banco respondendo)' })
  async check() {
    const startedAt = Date.now()
    let database: 'up' | 'down' = 'down'

    try {
      await this.dataSource.query('SELECT 1')
      database = 'up'
    } catch {
      database = 'down'
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'mnvma-api',
      version: process.env.npm_package_version ?? '0.1.0',
      uptime: Math.floor(process.uptime()),
      checks: { database, latencyMs: Date.now() - startedAt },
    }
  }
}

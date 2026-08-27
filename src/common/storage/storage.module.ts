import { Global, Logger, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../../config/env'
import { FilesController } from './files.controller'
import { LocalStorageDriver } from './local.driver'
import { S3StorageDriver } from './s3.driver'
import { StorageService } from './storage.service'
import { STORAGE_DRIVER, type StorageDriver } from './storage.types'

/**
 * Onde os arquivos ficam.
 *
 * Global pelo mesmo motivo do e-mail: é infraestrutura, e importar em cada
 * módulo que anexa arquivo só criaria ruído.
 *
 * O driver é escolhido no boot pelo `STORAGE_DRIVER`. O padrão é `local`: em
 * desenvolvimento nada sai da máquina e ninguém precisa de conta em provedor de
 * nuvem para testar o upload do COREN; em produção o arquivo fica num volume do
 * próprio servidor, que é a escolha atual da plataforma. O `s3` continua pronto
 * e é uma troca de variável de ambiente — nenhum código de módulo o menciona.
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    LocalStorageDriver,
    S3StorageDriver,
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService, LocalStorageDriver, S3StorageDriver],
      useFactory: (
        config: ConfigService<Env, true>,
        local: LocalStorageDriver,
        s3: S3StorageDriver,
      ): StorageDriver => {
        const escolhido = config.get('STORAGE_DRIVER', { infer: true })

        if (escolhido === 's3') return s3

        const ambiente = config.get('NODE_ENV', { infer: true })
        if (ambiente === 'production' || ambiente === 'staging') {
          // Não é aviso de erro: é o registro de onde os documentos estão
          // caindo. No dia em que alguém precisar restaurar um backup, esta
          // linha do log de boot é o que diz qual diretório copiar de volta.
          new Logger(StorageModule.name).log(
            `arquivos em disco: ${config.get('STORAGE_LOCAL_DIR', { infer: true })} ` +
              `— o backup precisa cobrir este diretório junto com o banco`,
          )
        }

        return local
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}

import { Global, Logger, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../../config/env'
import { MailService } from './mail.service'
import { MAIL_TRANSPORT, type MailTransport } from './mail.types'
import { LogMailTransport } from './transports/log.transport'
import { ResendMailTransport } from './transports/resend.transport'

/**
 * Global: convite, senha e jobs precisam de e-mail, e importar este módulo em
 * cada um só criaria ruído — é infraestrutura, como o SystemScope.
 *
 * O transporte é escolhido no boot pelo `MAIL_PROVIDER`. Em desenvolvimento e
 * em teste o padrão é `log`: nada sai da máquina e os links aparecem no
 * terminal.
 */
@Global()
@Module({
  providers: [
    LogMailTransport,
    ResendMailTransport,
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService, LogMailTransport, ResendMailTransport],
      useFactory: (
        config: ConfigService<Env, true>,
        log: LogMailTransport,
        resend: ResendMailTransport,
      ): MailTransport => {
        const provider = config.get('MAIL_PROVIDER', { infer: true })

        if (provider === 'resend') return resend

        if (config.get('NODE_ENV', { infer: true }) === 'production') {
          // Não derruba o boot: uma conta em produção sem e-mail configurado
          // ainda funciona (o convite mostra o link na tela). Mas isto precisa
          // gritar no log, porque redefinição de senha depende do envio.
          new Logger(MailModule.name).warn(
            'MAIL_PROVIDER=log em produção: nenhum e-mail será entregue. ' +
              'Redefinição de senha e convites por e-mail ficam inoperantes.',
          )
        }

        return log
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}

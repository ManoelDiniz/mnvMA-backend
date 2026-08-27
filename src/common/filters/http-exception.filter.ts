import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'
import { QueryFailedError } from 'typeorm'
import type { AuthenticatedRequest } from '../types/authenticated-request'

interface ErrorBody {
  error: {
    code: string
    message: string
    fields?: Record<string, string>
    [extra: string]: unknown
  }
}

/** Códigos do MySQL que têm resposta melhor que "erro interno". */
const MYSQL_DUP_ENTRY = 1062
const MYSQL_ROW_IS_REFERENCED = [1451, 1452]
/** SQLSTATE que os triggers de tenant usam no SIGNAL (ver migration inicial). */
const TENANT_GUARD_SQLSTATE = '45000'

/**
 * Formato único de erro para toda a API. O frontend depende disso: `code` guia
 * o comportamento (modal de upgrade, tela de reativação) e `fields` alimenta o
 * formulário.
 */
/** `HttpStatus` é enum; comparar com um número solto exige o valor cru. */
const ERRO_DE_SERVIDOR: number = HttpStatus.INTERNAL_SERVER_ERROR

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<AuthenticatedRequest>()

    const { status, body } = this.normalize(exception)

    if (status >= ERRO_DE_SERVIDOR) {
      this.logger.error(
        {
          err: exception,
          path: request.url,
          method: request.method,
          tenantId: request.user?.tenantId,
          userId: request.user?.userId,
        },
        'erro não tratado',
      )
    }

    response.status(status).json(body)
  }

  private normalize(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const payload = exception.getResponse()

      if (typeof payload === 'string') {
        return { status, body: { error: { code: codeFor(status), message: payload } } }
      }

      const obj = payload as Record<string, unknown>

      // Alguém lançou BadRequestException com lista de mensagens sem passar
      // pelo validationExceptionFactory (que já monta `fields` corretamente).
      if (Array.isArray(obj.message)) {
        return {
          status,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: (obj.message as string[]).join(' '),
            },
          },
        }
      }

      const { code, message, statusCode: _statusCode, error: _error, ...rest } = obj
      return {
        status,
        body: {
          error: {
            code: typeof code === 'string' ? code : codeFor(status),
            message: typeof message === 'string' ? message : 'Erro ao processar a requisição.',
            ...rest,
          },
        },
      }
    }

    if (exception instanceof QueryFailedError) {
      const driver = exception.driverError as
        | { errno?: number; sqlState?: string; sqlMessage?: string }
        | undefined

      // Escrita barrada pelo trigger de tenant. Nunca deveria acontecer: se
      // aconteceu, é bug na camada de aplicação e precisa gritar no log.
      if (driver?.sqlState === TENANT_GUARD_SQLSTATE) {
        this.logger.error(
          { sqlMessage: driver.sqlMessage },
          'TRAVA DE TENANT ACIONADA — tentativa de gravar em conta alheia',
        )
        return {
          status: HttpStatus.FORBIDDEN,
          body: { error: { code: 'TENANT_MISMATCH', message: 'Operação não permitida.' } },
        }
      }

      if (driver?.errno === MYSQL_DUP_ENTRY) {
        return {
          status: HttpStatus.CONFLICT,
          body: {
            error: { code: 'DUPLICATE', message: 'Já existe um registro com esses dados.' },
          },
        }
      }

      if (driver?.errno !== undefined && MYSQL_ROW_IS_REFERENCED.includes(driver.errno)) {
        return {
          status: HttpStatus.CONFLICT,
          body: {
            error: {
              code: 'IN_USE',
              message: 'Este registro está vinculado a outros e não pode ser removido.',
            },
          },
        }
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } },
    }
  }
}

function codeFor(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    402: 'PAYMENT_REQUIRED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE',
    429: 'TOO_MANY_REQUESTS',
  }
  return map[status] ?? 'ERROR'
}

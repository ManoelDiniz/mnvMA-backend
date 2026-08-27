import { z } from 'zod'

/**
 * Toda variável de ambiente passa por aqui. Se faltar algo obrigatório, a API
 * não sobe — falhar no boot é muito melhor que descobrir em produção que o
 * JWT_ACCESS_SECRET estava vazio.
 */
const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'))

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  DATABASE_SSL: bool(false),
  DATABASE_LOGGING: bool(false),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de pelo menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET precisa de pelo menos 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  /** Validade do link de "esqueci a senha". Curto de propósito. */
  PASSWORD_RESET_TTL: z.string().default('60m'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool(false),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  TRIAL_DAYS: z.coerce.number().int().min(0).default(14),
  DEFAULT_TIMEZONE: z.string().default('America/Sao_Paulo'),

  // ─── E-mail ────────────────────────────────────────────────────────────────
  // `log` não entrega nada: escreve a mensagem e os links no terminal. É o
  // padrão em desenvolvimento e em teste, e o que permite aceitar convite sem
  // conta em provedor nenhum.
  MAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
  MAIL_FROM: z.string().default('MNVMA <nao-responda@mnvma.com.br>'),
  MAIL_REPLY_TO: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  /** Dias de antecedência do aviso de documento vencendo. */
  DOCUMENT_ALERT_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  /** Liga os jobs agendados. Desligue nos processos que não são o worker. */
  JOBS_ENABLED: bool(true),

  MP_ACCESS_TOKEN: z.string().optional(),
  MP_PUBLIC_KEY: z.string().optional(),
  MP_WEBHOOK_SECRET: z.string().optional(),
  MP_BACK_URL: z.string().optional(),
  MP_NOTIFICATION_URL: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw)

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Variáveis de ambiente inválidas:\n${details}`)
  }

  // Escolher `resend` sem a chave faria todo envio falhar em silêncio, e a
  // primeira pessoa a descobrir seria quem esqueceu a senha.
  if (parsed.data.MAIL_PROVIDER === 'resend' && !parsed.data.RESEND_API_KEY) {
    throw new Error('MAIL_PROVIDER=resend exige RESEND_API_KEY.')
  }

  // O webhook é a única rota pública que mexe em dinheiro. Sem o segredo não há
  // como conferir a assinatura HMAC, e quem descobrisse a URL ativaria a
  // própria conta com um POST. Melhor não subir do que subir assim.
  if (
    parsed.data.MP_ACCESS_TOKEN &&
    !parsed.data.MP_WEBHOOK_SECRET &&
    (parsed.data.NODE_ENV === 'production' || parsed.data.NODE_ENV === 'staging')
  ) {
    throw new Error(
      'MP_ACCESS_TOKEN configurado sem MP_WEBHOOK_SECRET: o webhook do Mercado Pago ficaria sem ' +
        'validação de assinatura, o que permitiria a qualquer um ativar uma assinatura.',
    )
  }

  if (parsed.data.NODE_ENV === 'production') {
    const weak = ['troque-isto-em-producao-access', 'troque-isto-em-producao-refresh']
    if (weak.includes(parsed.data.JWT_ACCESS_SECRET) || weak.includes(parsed.data.JWT_REFRESH_SECRET)) {
      throw new Error('Os segredos de JWT do .env.example não podem ser usados em produção.')
    }
  }

  return parsed.data
}

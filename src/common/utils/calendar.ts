/**
 * Data de calendário no fuso do Brasil.
 *
 * "Hoje" não é `new Date()`: às 22h de São Paulo o servidor em UTC já virou o
 * dia, e um documento que vence hoje apareceria como vencido ontem. Toda regra
 * que compara datas de calendário — validade de documento, competência de
 * contrato, grade da escala — passa por aqui.
 */
export const FUSO_PADRAO = 'America/Sao_Paulo'

const FORMATO_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_PADRAO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** `2026-08-25` no fuso de São Paulo. */
export function dataLocal(instante: Date = new Date()): string {
  return FORMATO_ISO.format(instante)
}

/** Competência (`2026-08`) do instante, no fuso local. */
export function competenciaLocal(instante: Date = new Date()): string {
  return dataLocal(instante).slice(0, 7)
}

/**
 * Diferença em dias entre duas datas de calendário (`YYYY-MM-DD`).
 *
 * Feita em UTC de propósito: comparar `2026-03-01` com `2026-02-28` usando
 * horário local erra na virada do horário de verão, porque um dos "dias" tem
 * 23 horas. Como os dois lados são meia-noite UTC, a subtração é exata.
 */
export function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de}T00:00:00.000Z`)
  const b = Date.parse(`${ate}T00:00:00.000Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/** Soma dias a uma data de calendário, devolvendo `YYYY-MM-DD`. */
export function somarDias(data: string, dias: number): string {
  const base = Date.parse(`${data}T00:00:00.000Z`)
  return new Date(base + dias * 86_400_000).toISOString().slice(0, 10)
}

/** `2026-08` → `2026-09`. Aceita competência ou data completa. */
export function proximaCompetencia(competencia: string): string {
  const [ano, mes] = competencia.slice(0, 7).split('-').map(Number)
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`
}

/** Quantos dias tem o mês da competência. */
export function diasNoMes(competencia: string): number {
  const [ano, mes] = competencia.slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

/**
 * Data de vencimento dentro da competência, com o dia escolhido pelo contrato.
 *
 * Dia 31 num mês de 30 cai no último dia, nunca transborda para o mês seguinte:
 * uma cobrança de setembro vencendo em 1º de outubro entra na competência
 * errada do relatório.
 */
export function diaDaCompetencia(competencia: string, dia: number): string {
  const limite = diasNoMes(competencia)
  return `${competencia.slice(0, 7)}-${String(Math.min(dia, limite)).padStart(2, '0')}`
}

/** Compara competências como texto — `2026-08` < `2026-09` já é verdade em ASCII. */
export function competenciaMenorOuIgual(a: string, b: string): boolean {
  return a.slice(0, 7) <= b.slice(0, 7)
}

const FORMATO_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_PADRAO,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** `19:00` no fuso de São Paulo. */
export function horaLocal(instante: Date): string {
  return FORMATO_HORA.format(instante)
}

const FORMATO_OFFSET = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_PADRAO,
  timeZoneName: 'longOffset',
})

/** Offset do fuso local naquele instante, em minutos (GMT-03:00 → -180). */
export function offsetMinutos(instante: Date): number {
  const parte = FORMATO_OFFSET.formatToParts(instante).find((p) => p.type === 'timeZoneName')
  const casa = /GMT([+-])(\d{2}):(\d{2})/.exec(parte?.value ?? '')
  if (!casa) return 0
  const sinal = casa[1] === '-' ? -1 : 1
  return sinal * (Number(casa[2]) * 60 + Number(casa[3]))
}

/**
 * Data e hora LOCAIS para o instante em UTC.
 *
 * O caminho inverso de `dataLocal`. Necessário sempre que o usuário escolhe "1º
 * de setembro às 7h" na tela e isso precisa virar um ponto no tempo — somar
 * horas na string daria certo hoje e erraria no dia em que o Brasil voltar a
 * ter horário de verão.
 */
export function paraUtc(data: string, hora: string): Date {
  const palpite = new Date(`${data.slice(0, 10)}T${hora.slice(0, 5)}:00.000Z`)
  return new Date(palpite.getTime() - offsetMinutos(palpite) * 60_000)
}

/** Início do dia local (00:00) como instante UTC. */
export function inicioDoDiaLocal(data: string): Date {
  return paraUtc(data, '00:00')
}

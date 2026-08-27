import { Column, type ValueTransformer } from 'typeorm'

/**
 * O mysql2 devolve `decimal` como string, e isso é proposital: converter para
 * `number` perde centavos em somas grandes. Dinheiro trafega e é guardado como
 * string; conta se faz em SQL (SUM) ou em inteiro de centavos.
 */
export const DecimalTransformer: ValueTransformer = {
  to: (value?: string | number | null): string | null => {
    if (value === null || value === undefined || value === '') return null
    return typeof value === 'number' ? value.toFixed(2) : value
  },
  from: (value?: string | null): string | null => value ?? null,
}

export const MoneyColumn = (options: { nullable?: boolean; default?: string } = {}) =>
  Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: options.nullable ?? false,
    default: options.default,
    transformer: DecimalTransformer,
  })

/** Soma valores monetários em string sem passar por float. */
export function sumMoney(values: Array<string | null | undefined>): string {
  const cents = values.reduce<bigint>((acc, v) => acc + toCents(v), 0n)
  return fromCents(cents)
}

export function toCents(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n
  const [int, frac = ''] = String(value).split('.')
  const sign = int.startsWith('-') ? -1n : 1n
  const digits = `${int.replace('-', '')}${frac.padEnd(2, '0').slice(0, 2)}`
  return sign * BigInt(digits || '0')
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : ''
  const abs = cents < 0n ? -cents : cents
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

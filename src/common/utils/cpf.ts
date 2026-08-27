/**
 * Validação de CPF pelos dígitos verificadores.
 *
 * Não é enfeite: o CPF vira chave de unicidade dentro do tenant e aparece em
 * recibo e cobrança. Deixar entrar "111.111.111-11" cria cliente duplicado com
 * documento impossível, e a limpeza depois é manual.
 */
export function isValidCpf(value: string): boolean {
  const cpf = value.replace(/\D/g, '')

  if (cpf.length !== 11) return false
  // Sequências repetidas passam no cálculo mas não existem na Receita.
  if (/^(\d)\1{10}$/.test(cpf)) return false

  const digits = cpf.split('').map(Number)

  for (const [length, position] of [
    [9, 9],
    [10, 10],
  ]) {
    let sum = 0
    for (let i = 0; i < length; i++) {
      sum += digits[i] * (length + 1 - i)
    }
    const remainder = (sum * 10) % 11
    const check = remainder === 10 ? 0 : remainder
    if (check !== digits[position]) return false
  }

  return true
}

export function isValidCnpj(value: string): boolean {
  const cnpj = value.replace(/\D/g, '')

  if (cnpj.length !== 14) return false
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  const digits = cnpj.split('').map(Number)
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

  for (const size of [12, 13]) {
    const slice = weights.slice(weights.length - size)
    const sum = digits.slice(0, size).reduce((acc, digit, i) => acc + digit * slice[i], 0)
    const remainder = sum % 11
    const check = remainder < 2 ? 0 : 11 - remainder
    if (check !== digits[size]) return false
  }

  return true
}

export function formatCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11) return cpf
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

/**
 * Transformações de entrada compartilhadas pelos DTOs.
 *
 * Estavam duplicadas em cinco módulos; o mesmo dinheiro chegando do formulário
 * como `"1.234,50"` precisa virar `"1234.50"` em todos eles, e uma cópia que
 * ficasse para trás viraria divergência de centavos.
 */

/**
 * Normaliza dinheiro vindo do formulário para o formato que o `decimal(12,2)`
 * espera. Valor que não é número nem texto volta intacto — quem rejeita é o
 * validador do DTO, que sabe montar a mensagem de erro do campo.
 */
export const dinheiro = ({ value }: { value: unknown }): unknown => {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return value.toFixed(2)
  if (typeof value === 'string') return value.replace(',', '.').trim()
  return value
}

/** Mantém só os dígitos (CPF, CNPJ, telefone, CEP). */
export const digitos = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/\D/g, '') || undefined : value

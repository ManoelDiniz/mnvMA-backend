import { BadRequestException } from '@nestjs/common'
import type { ValidationError } from 'class-validator'

/**
 * Transforma o retorno do class-validator no formato de erro da API.
 *
 * O padrão do Nest devolve `message: string[]` e a única forma de descobrir o
 * campo seria olhar a primeira palavra da frase — o que quebra assim que a
 * mensagem é escrita em português ("A senha precisa conter letras e números"
 * viraria o campo "A"). Aqui o nome vem de `error.property`, que é o dado certo.
 *
 * Campos aninhados viram caminho com ponto: `address.zipCode`,
 * `responsibles.0.name` — é assim que o formulário do painel acha o input.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const fields = flatten(errors)

  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message: 'Dados inválidos.',
    fields,
  })
}

function flatten(errors: ValidationError[], prefix = ''): Record<string, string> {
  return errors.reduce<Record<string, string>>((acc, error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property

    const constraints = error.constraints ? Object.values(error.constraints) : []
    if (constraints.length > 0 && !acc[path]) {
      acc[path] = constraints[0]
    }

    if (error.children?.length) {
      Object.assign(acc, flatten(error.children, path))
    }

    return acc
  }, {})
}

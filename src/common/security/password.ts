import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'

/**
 * Parâmetros do Argon2id. `memoryCost` de 19 MiB é a recomendação mínima atual
 * do OWASP para este algoritmo; subir mais encarece o login legítimo tanto
 * quanto o ataque, então fica em faixa segura sem travar o servidor.
 *
 * Ficam AQUI, e não dentro do AuthService, porque cadastro, convite aceito e
 * troca de senha precisam gerar hashes com exatamente os mesmos parâmetros.
 * Dois lugares com números diferentes viram, meses depois, um subconjunto de
 * usuários com senha mais fraca que o resto — e ninguém percebe.
 */
export const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON_OPTIONS)
}

/** Nunca lança: hash corrompido ou de formato antigo é senha errada, não 500. */
export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argonVerify(hash, plain).then(
    (ok) => ok,
    () => false,
  )
}

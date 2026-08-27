import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Conserta a comparação dos triggers de tenant.
 *
 * O problema: variável de usuário do MySQL (`@mnvma_tenant_id`) herda a
 * collation da CONEXÃO, enquanto a coluna `tenant_id` tem a collation da
 * TABELA. Quando as duas diferem, `NEW.tenant_id <> @mnvma_tenant_id` não
 * compara — o MySQL aborta com
 * `ER_CANT_AGGREGATE_2COLLATIONS (1267)`.
 *
 * Na prática isso significava que qualquer cliente conectado com collation
 * diferente de `utf8mb4_0900_ai_ci` — console de DBA, ferramenta de restore,
 * outra versão do driver — **não conseguia gravar nada**, e o erro apontava
 * para collation, não para a trava de tenant. A API funcionava só porque
 * declara a collation explicitamente na conexão.
 *
 * A correção normaliza os dois lados antes de comparar, deixando a trava
 * independente de como o cliente se conectou.
 */
export class FixTenantGuardCollation1756000001000 implements MigrationInterface {
  name = 'FixTenantGuardCollation1756000001000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TENANT_TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${table}_tenant_insert\``)
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${table}_tenant_update\``)
      await createTenantGuards(queryRunner, table, COMPARE_SAFE)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TENANT_TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${table}_tenant_insert\``)
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${table}_tenant_update\``)
      await createTenantGuards(queryRunner, table, COMPARE_NAIVE)
    }
  }
}

const TENANT_TABLES = [
  'subscriptions',
  'users',
  'refresh_tokens',
  'caregivers',
  'customers',
  'customer_responsibles',
] as const

/** Normaliza os dois lados: funciona com qualquer collation de conexão. */
const COMPARE_SAFE = (row: 'NEW' | 'OLD') =>
  `${row}.tenant_id COLLATE utf8mb4_0900_ai_ci <> ` +
  `CONVERT(@mnvma_tenant_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci`

/** Versão original, mantida só para o `down()` reproduzir o estado anterior. */
const COMPARE_NAIVE = (row: 'NEW' | 'OLD') => `${row}.tenant_id <> @mnvma_tenant_id`

async function createTenantGuards(
  queryRunner: QueryRunner,
  table: string,
  compare: (row: 'NEW' | 'OLD') => string,
): Promise<void> {
  const check = (row: 'NEW' | 'OLD') => `
    IF @mnvma_system_scope IS NULL OR @mnvma_system_scope <> 1 THEN
      IF @mnvma_tenant_id IS NOT NULL AND ${compare(row)} THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'MNVMA: tenant_id nao confere com o contexto da sessao';
      END IF;
    END IF;
  `

  await queryRunner.query(`
    CREATE TRIGGER \`trg_${table}_tenant_insert\` BEFORE INSERT ON \`${table}\`
    FOR EACH ROW
    BEGIN
      ${check('NEW')}
    END
  `)

  await queryRunner.query(`
    CREATE TRIGGER \`trg_${table}_tenant_update\` BEFORE UPDATE ON \`${table}\`
    FOR EACH ROW
    BEGIN
      ${check('OLD')}
      ${check('NEW')}
    END
  `)
}

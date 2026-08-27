import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Sprint 2 — catálogo de serviços.
 *
 * Guarda os dois valores (venda e custo do cuidador) porque é daqui que sai a
 * margem. A margem em si NÃO é coluna: é derivada na leitura, senão editar o
 * preço deixaria margens antigas erradas no banco.
 */
export class AddServices1756000002000 implements MigrationInterface {
  name = 'AddServices1756000002000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`services\` (
        \`id\`             varchar(36) NOT NULL,
        \`tenant_id\`      varchar(36) NOT NULL,
        \`name\`           varchar(160) NOT NULL,
        \`code\`           varchar(30) NULL,
        \`unit\`           enum('PLANTAO','HORA','DIA') NOT NULL DEFAULT 'PLANTAO',
        \`sale_price\`     decimal(12,2) NOT NULL,
        \`caregiver_cost\` decimal(12,2) NULL,
        \`hours\`          decimal(6,2) NULL,
        \`notes\`          text NULL,
        \`is_active\`      tinyint(1) NOT NULL DEFAULT 1,
        \`created_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                           ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`     datetime(6) NULL,
        \`deleted_marker\` datetime(6) GENERATED ALWAYS AS
                           (ifnull(\`deleted_at\`, '1970-01-01 00:00:00.000000')) STORED,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_services_tenant_code\` (\`tenant_id\`, \`code\`, \`deleted_marker\`),
        KEY \`idx_services_tenant_id\` (\`tenant_id\`),
        KEY \`idx_services_tenant_name\` (\`tenant_id\`, \`name\`),
        CONSTRAINT \`fk_services_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    await criarTravasDeTenant(queryRunner, 'services')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_services_tenant_insert\``)
    await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_services_tenant_update\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`services\``)
  }
}

/**
 * Mesma trava das demais tabelas com `tenant_id` (ver migration inicial).
 * Duplicada de propósito: migration é registro histórico e não pode depender de
 * um helper compartilhado que mude depois.
 */
async function criarTravasDeTenant(
  queryRunner: QueryRunner,
  tabela: string,
): Promise<void> {
  const conferir = (linha: 'NEW' | 'OLD') => `
    IF @mnvma_system_scope IS NULL OR @mnvma_system_scope <> 1 THEN
      IF @mnvma_tenant_id IS NOT NULL
         AND ${linha}.tenant_id COLLATE utf8mb4_0900_ai_ci <>
             CONVERT(@mnvma_tenant_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'MNVMA: tenant_id nao confere com o contexto da sessao';
      END IF;
    END IF;
  `

  await queryRunner.query(`
    CREATE TRIGGER \`trg_${tabela}_tenant_insert\` BEFORE INSERT ON \`${tabela}\`
    FOR EACH ROW
    BEGIN
      ${conferir('NEW')}
    END
  `)

  await queryRunner.query(`
    CREATE TRIGGER \`trg_${tabela}_tenant_update\` BEFORE UPDATE ON \`${tabela}\`
    FOR EACH ROW
    BEGIN
      ${conferir('OLD')}
      ${conferir('NEW')}
    END
  `)
}

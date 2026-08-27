import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Sprint 4 — contas a receber e a pagar.
 *
 * O `shift_id` é ÚNICO por conta nas duas tabelas. Essa constraint é a trava de
 * idempotência da regra central: mesmo que o backend reprocesse a conclusão de
 * um plantão, o banco recusa a segunda cobrança. Sem ela, um retry de rede
 * viraria cobrança duplicada — o tipo de bug que só aparece quando o cliente
 * reclama.
 */
export class AddFinance1756000004000 implements MigrationInterface {
  name = 'AddFinance1756000004000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`account_receivables\` (
        \`id\`           varchar(36) NOT NULL,
        \`tenant_id\`    varchar(36) NOT NULL,
        \`customer_id\`  varchar(36) NOT NULL,
        \`shift_id\`     varchar(36) NULL,
        \`competence\`   char(7) NOT NULL,
        \`description\`  varchar(200) NOT NULL,
        \`amount\`       decimal(12,2) NOT NULL,
        \`due_date\`     date NOT NULL,
        \`paid_at\`      date NULL,
        \`paid_amount\`  decimal(12,2) NULL,
        \`status\`       enum('FORECAST','PENDING','PAID','OVERDUE','CANCELED')
                         NOT NULL DEFAULT 'PENDING',
        \`external_ref\` varchar(120) NULL,
        \`notes\`        text NULL,
        \`created_at\`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                         ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`   datetime(6) NULL,
        \`deleted_marker\` datetime(6) GENERATED ALWAYS AS
                           (ifnull(\`deleted_at\`, '1970-01-01 00:00:00.000000')) STORED,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_receivables_shift\` (\`tenant_id\`, \`shift_id\`, \`deleted_marker\`),
        KEY \`idx_receivables_tenant_id\` (\`tenant_id\`),
        KEY \`idx_receivables_vencimento\` (\`tenant_id\`, \`due_date\`, \`status\`),
        KEY \`idx_receivables_competencia\` (\`tenant_id\`, \`competence\`),
        KEY \`idx_receivables_cliente\` (\`tenant_id\`, \`customer_id\`),
        KEY \`idx_receivables_pagamento\` (\`tenant_id\`, \`paid_at\`),
        CONSTRAINT \`fk_receivables_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_receivables_customer\` FOREIGN KEY (\`customer_id\`)
          REFERENCES \`customers\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_receivables_shift\` FOREIGN KEY (\`shift_id\`)
          REFERENCES \`shifts\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`account_payables\` (
        \`id\`           varchar(36) NOT NULL,
        \`tenant_id\`    varchar(36) NOT NULL,
        \`caregiver_id\` varchar(36) NULL,
        \`supplier\`     varchar(160) NULL,
        \`category\`     enum('CAREGIVER','TRANSPORT','FOOD','SUPPLIES','TAXES','RENT','SOFTWARE','ACCOUNTING','MARKETING','COURSES','EQUIPMENT','OTHER')
                         NOT NULL DEFAULT 'OTHER',
        \`shift_id\`     varchar(36) NULL,
        \`competence\`   char(7) NOT NULL,
        \`description\`  varchar(200) NOT NULL,
        \`amount\`       decimal(12,2) NOT NULL,
        \`due_date\`     date NOT NULL,
        \`paid_at\`      date NULL,
        \`paid_amount\`  decimal(12,2) NULL,
        \`status\`       enum('PENDING','PAID','OVERDUE','CANCELED') NOT NULL DEFAULT 'PENDING',
        \`notes\`        text NULL,
        \`created_at\`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                         ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`   datetime(6) NULL,
        \`deleted_marker\` datetime(6) GENERATED ALWAYS AS
                           (ifnull(\`deleted_at\`, '1970-01-01 00:00:00.000000')) STORED,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_payables_shift\` (\`tenant_id\`, \`shift_id\`, \`deleted_marker\`),
        KEY \`idx_payables_tenant_id\` (\`tenant_id\`),
        KEY \`idx_payables_vencimento\` (\`tenant_id\`, \`due_date\`, \`status\`),
        KEY \`idx_payables_competencia\` (\`tenant_id\`, \`competence\`),
        KEY \`idx_payables_categoria\` (\`tenant_id\`, \`category\`),
        KEY \`idx_payables_pagamento\` (\`tenant_id\`, \`paid_at\`),
        CONSTRAINT \`fk_payables_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_payables_caregiver\` FOREIGN KEY (\`caregiver_id\`)
          REFERENCES \`caregivers\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`fk_payables_shift\` FOREIGN KEY (\`shift_id\`)
          REFERENCES \`shifts\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    for (const tabela of ['account_receivables', 'account_payables']) {
      await criarTravasDeTenant(queryRunner, tabela)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tabela of ['account_receivables', 'account_payables']) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${tabela}_tenant_insert\``)
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${tabela}_tenant_update\``)
    }
    await queryRunner.query(`DROP TABLE IF EXISTS \`account_payables\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`account_receivables\``)
  }
}

/** Mesma trava das demais tabelas com `tenant_id` (ver migration inicial). */
async function criarTravasDeTenant(queryRunner: QueryRunner, tabela: string): Promise<void> {
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

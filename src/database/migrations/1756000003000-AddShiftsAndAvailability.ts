import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Sprint 3 — plantões e disponibilidade.
 *
 * `starts_at`/`ends_at` são datetime completos em UTC, não data + hora: o
 * plantão noturno 19h→07h atravessa o dia, e modelar como "data + hora inicial +
 * hora final" quebra o cálculo de horas em toda virada de dia.
 *
 * O FK de cliente é RESTRICT de propósito: apagar um cliente que tem plantão
 * levaria junto o histórico financeiro que nasceu dele.
 */
export class AddShiftsAndAvailability1756000003000 implements MigrationInterface {
  name = 'AddShiftsAndAvailability1756000003000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`shifts\` (
        \`id\`             varchar(36) NOT NULL,
        \`tenant_id\`      varchar(36) NOT NULL,
        \`customer_id\`    varchar(36) NOT NULL,
        \`caregiver_id\`   varchar(36) NULL,
        \`service_id\`     varchar(36) NULL,
        \`starts_at\`      datetime(6) NOT NULL,
        \`ends_at\`        datetime(6) NOT NULL,
        \`charge_amount\`  decimal(12,2) NOT NULL,
        \`caregiver_cost\` decimal(12,2) NOT NULL DEFAULT '0.00',
        \`other_costs\`    decimal(12,2) NOT NULL DEFAULT '0.00',
        \`status\`         enum('PLANNED','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELED','NO_SHOW')
                           NOT NULL DEFAULT 'PLANNED',
        \`check_in_at\`    datetime(6) NULL,
        \`check_out_at\`   datetime(6) NULL,
        \`status_reason\`  varchar(255) NULL,
        \`notes\`          text NULL,
        \`created_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                           ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`     datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_shifts_tenant_id\` (\`tenant_id\`),
        KEY \`idx_shifts_tenant_inicio\` (\`tenant_id\`, \`starts_at\`),
        KEY \`idx_shifts_tenant_cuidador\` (\`tenant_id\`, \`caregiver_id\`, \`starts_at\`),
        KEY \`idx_shifts_tenant_cliente\` (\`tenant_id\`, \`customer_id\`, \`starts_at\`),
        KEY \`idx_shifts_tenant_status\` (\`tenant_id\`, \`status\`),
        CONSTRAINT \`fk_shifts_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_shifts_customer\` FOREIGN KEY (\`customer_id\`)
          REFERENCES \`customers\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_shifts_caregiver\` FOREIGN KEY (\`caregiver_id\`)
          REFERENCES \`caregivers\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`fk_shifts_service\` FOREIGN KEY (\`service_id\`)
          REFERENCES \`services\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    await queryRunner.query(`
      CREATE TABLE \`caregiver_availabilities\` (
        \`id\`           varchar(36) NOT NULL,
        \`tenant_id\`    varchar(36) NOT NULL,
        \`caregiver_id\` varchar(36) NOT NULL,
        \`kind\`         enum('RECURRING','BLOCK') NOT NULL,
        \`weekday\`      tinyint NULL,
        \`start_time\`   time NULL,
        \`end_time\`     time NULL,
        \`blocked_from\` datetime(6) NULL,
        \`blocked_to\`   datetime(6) NULL,
        \`reason\`       varchar(160) NULL,
        \`created_at\`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                         ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`   datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_availability_tenant_id\` (\`tenant_id\`),
        KEY \`idx_availability_cuidador\` (\`tenant_id\`, \`caregiver_id\`),
        KEY \`idx_availability_bloqueio\` (\`tenant_id\`, \`blocked_from\`, \`blocked_to\`),
        CONSTRAINT \`fk_availability_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_availability_caregiver\` FOREIGN KEY (\`caregiver_id\`)
          REFERENCES \`caregivers\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    for (const tabela of ['shifts', 'caregiver_availabilities']) {
      await criarTravasDeTenant(queryRunner, tabela)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tabela of ['shifts', 'caregiver_availabilities']) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${tabela}_tenant_insert\``)
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${tabela}_tenant_update\``)
    }
    await queryRunner.query(`DROP TABLE IF EXISTS \`caregiver_availabilities\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`shifts\``)
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

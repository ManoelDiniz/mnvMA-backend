import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Schema inicial do MNVMA (MySQL 8): fundação multi-tenant + autenticação +
 * clientes.
 *
 * Três detalhes que valem a leitura:
 *
 * 1. `deleted_marker` — o MySQL não tem índice parcial
 *    (`UNIQUE ... WHERE deleted_at IS NULL`). A coluna gerada devolve a época
 *    quando o registro está ativo e a data da exclusão quando não está, então
 *    incluí-la na chave única garante "único entre os ativos" sem impedir que um
 *    CPF excluído seja recadastrado.
 *
 * 2. Triggers de tenant — o MySQL também não tem Row Level Security. Toda
 *    tabela com `tenant_id` ganha um BEFORE INSERT/UPDATE que compara a linha
 *    com a variável de sessão `@mnvma_tenant_id` (definida pelo
 *    TenantContextInterceptor) e aborta com SIGNAL se não bater. Isso protege a
 *    ESCRITA no nível do banco; a leitura depende do TenantScopedRepository e
 *    da suíte de isolamento que roda em todo PR.
 *
 * 3. Collation `utf8mb4_0900_ai_ci` — acento e caixa são ignorados na
 *    comparação, então "jose" acha "José" e o e-mail fica único sem
 *    `lower()`.
 */
export class InitialSchema1756000000000 implements MigrationInterface {
  name = 'InitialSchema1756000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── tenants ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`tenants\` (
        \`id\`            varchar(36) NOT NULL,
        \`name\`          varchar(255) NOT NULL,
        \`type\`          enum('INDIVIDUAL','COMPANY') NOT NULL,
        \`document\`      varchar(18) NULL,
        \`status\`        enum('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','EXPIRED','CANCELED')
                          NOT NULL DEFAULT 'TRIAL',
        \`trial_ends_at\` datetime(6) NULL,
        \`timezone\`      varchar(60) NOT NULL DEFAULT 'America/Sao_Paulo',
        \`created_at\`    datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`    datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                          ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`    datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_tenants_document\` (\`document\`),
        KEY \`idx_tenants_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── plans (catálogo global, sem tenant) ──────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`plans\` (
        \`id\`                     varchar(36) NOT NULL,
        \`code\`                   varchar(60) NOT NULL,
        \`name\`                   varchar(120) NOT NULL,
        \`description\`            text NULL,
        \`tenant_type\`            enum('INDIVIDUAL','COMPANY') NOT NULL,
        \`price_cents\`            int NOT NULL,
        \`interval\`               varchar(20) NOT NULL DEFAULT 'months',
        \`interval_count\`         int NOT NULL DEFAULT 1,
        \`trial_days\`             int NOT NULL DEFAULT 14,
        \`max_customers\`          int NULL,
        \`max_caregivers\`         int NULL,
        \`max_shifts_per_month\`   int NULL,
        \`max_users\`              int NULL,
        \`features\`               json NULL,
        \`mp_preapproval_plan_id\` varchar(120) NULL,
        \`is_active\`              tinyint(1) NOT NULL DEFAULT 1,
        \`sort_order\`             int NOT NULL DEFAULT 0,
        \`created_at\`             datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`             datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                   ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`             datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_plans_code\` (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── subscriptions ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`subscriptions\` (
        \`id\`                 varchar(36) NOT NULL,
        \`tenant_id\`          varchar(36) NOT NULL,
        \`plan_id\`            varchar(36) NOT NULL,
        \`status\`             enum('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELED')
                               NOT NULL DEFAULT 'TRIAL',
        \`provider\`           varchar(30) NOT NULL DEFAULT 'mercadopago',
        \`mp_preapproval_id\`  varchar(120) NULL,
        \`mp_payer_id\`        varchar(120) NULL,
        \`current_period_end\` datetime(6) NULL,
        \`next_charge_at\`     datetime(6) NULL,
        \`canceled_at\`        datetime(6) NULL,
        \`grace_until\`        datetime(6) NULL,
        \`created_at\`         datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`         datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                               ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`         datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_subscriptions_tenant\` (\`tenant_id\`),
        UNIQUE KEY \`uq_subscriptions_mp_preapproval\` (\`mp_preapproval_id\`),
        CONSTRAINT \`fk_subscriptions_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_subscriptions_plan\` FOREIGN KEY (\`plan_id\`)
          REFERENCES \`plans\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── caregivers ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`caregivers\` (
        \`id\`             varchar(36) NOT NULL,
        \`tenant_id\`      varchar(36) NOT NULL,
        \`name\`           varchar(160) NOT NULL,
        \`cpf\`            varchar(14) NULL,
        \`phone\`          varchar(20) NULL,
        \`email\`          varchar(180) NULL,
        \`birth_date\`     date NULL,
        \`contract_type\`  varchar(30) NULL,
        \`hourly_rate\`    decimal(12,2) NULL,
        \`shift_rate\`     decimal(12,2) NULL,
        \`is_owner\`       tinyint(1) NOT NULL DEFAULT 0,
        \`is_active\`      tinyint(1) NOT NULL DEFAULT 1,
        \`notes\`          text NULL,
        \`created_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                           ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`     datetime(6) NULL,
        \`deleted_marker\` datetime(6) GENERATED ALWAYS AS
                           (ifnull(\`deleted_at\`, '1970-01-01 00:00:00.000000')) STORED,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_caregivers_tenant_cpf\` (\`tenant_id\`, \`cpf\`, \`deleted_marker\`),
        KEY \`idx_caregivers_tenant_id\` (\`tenant_id\`),
        KEY \`idx_caregivers_tenant_name\` (\`tenant_id\`, \`name\`),
        CONSTRAINT \`fk_caregivers_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── users ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`id\`             varchar(36) NOT NULL,
        \`tenant_id\`      varchar(36) NOT NULL,
        \`name\`           varchar(160) NOT NULL,
        \`email\`          varchar(180) NOT NULL,
        \`password_hash\`  varchar(255) NOT NULL,
        \`role\`           enum('SUPER_ADMIN','OWNER','ADMIN','MANAGER','COORDINATOR','FINANCE','CAREGIVER')
                           NOT NULL,
        \`caregiver_id\`   varchar(36) NULL,
        \`is_active\`      tinyint(1) NOT NULL DEFAULT 1,
        \`last_login_at\`  datetime(6) NULL,
        \`created_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                           ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`     datetime(6) NULL,
        \`deleted_marker\` datetime(6) GENERATED ALWAYS AS
                           (ifnull(\`deleted_at\`, '1970-01-01 00:00:00.000000')) STORED,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_users_email_global\` (\`email\`, \`deleted_marker\`),
        KEY \`idx_users_tenant_id\` (\`tenant_id\`),
        KEY \`idx_users_tenant_email\` (\`tenant_id\`, \`email\`),
        CONSTRAINT \`fk_users_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_users_caregiver\` FOREIGN KEY (\`caregiver_id\`)
          REFERENCES \`caregivers\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── refresh_tokens ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`refresh_tokens\` (
        \`id\`             varchar(36) NOT NULL,
        \`tenant_id\`      varchar(36) NOT NULL,
        \`user_id\`        varchar(36) NOT NULL,
        \`token_hash\`     char(64) NOT NULL,
        \`family_id\`      varchar(36) NOT NULL,
        \`expires_at\`     datetime(6) NOT NULL,
        \`revoked_at\`     datetime(6) NULL,
        \`replaced_by_id\` varchar(36) NULL,
        \`ip\`             varchar(45) NULL,
        \`user_agent\`     varchar(255) NULL,
        \`created_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                           ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`     datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_refresh_tokens_hash\` (\`token_hash\`),
        KEY \`idx_refresh_tokens_tenant_id\` (\`tenant_id\`),
        KEY \`idx_refresh_tokens_family\` (\`family_id\`),
        KEY \`idx_refresh_tokens_expires\` (\`expires_at\`),
        CONSTRAINT \`fk_refresh_tokens_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_refresh_tokens_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── customers ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`customers\` (
        \`id\`             varchar(36) NOT NULL,
        \`tenant_id\`      varchar(36) NOT NULL,
        \`name\`           varchar(160) NOT NULL,
        \`cpf\`            varchar(14) NULL,
        \`birth_date\`     date NULL,
        \`phone\`          varchar(20) NULL,
        \`email\`          varchar(180) NULL,
        \`address\`        json NULL,
        \`notes\`          text NULL,
        \`is_active\`      tinyint(1) NOT NULL DEFAULT 1,
        \`created_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                           ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`     datetime(6) NULL,
        \`deleted_marker\` datetime(6) GENERATED ALWAYS AS
                           (ifnull(\`deleted_at\`, '1970-01-01 00:00:00.000000')) STORED,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_customers_tenant_cpf\` (\`tenant_id\`, \`cpf\`, \`deleted_marker\`),
        KEY \`idx_customers_tenant_id\` (\`tenant_id\`),
        KEY \`idx_customers_tenant_name\` (\`tenant_id\`, \`name\`),
        KEY \`idx_customers_tenant_active\` (\`tenant_id\`, \`is_active\`),
        CONSTRAINT \`fk_customers_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── customer_responsibles ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`customer_responsibles\` (
        \`id\`           varchar(36) NOT NULL,
        \`tenant_id\`    varchar(36) NOT NULL,
        \`customer_id\`  varchar(36) NOT NULL,
        \`name\`         varchar(160) NOT NULL,
        \`relationship\` varchar(60) NULL,
        \`phone\`        varchar(20) NULL,
        \`email\`        varchar(180) NULL,
        \`is_primary\`   tinyint(1) NOT NULL DEFAULT 0,
        \`is_financial\` tinyint(1) NOT NULL DEFAULT 0,
        \`is_emergency\` tinyint(1) NOT NULL DEFAULT 0,
        \`created_at\`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                         ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`   datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_customer_responsibles_tenant_id\` (\`tenant_id\`),
        KEY \`idx_customer_responsibles_customer\` (\`tenant_id\`, \`customer_id\`),
        CONSTRAINT \`fk_customer_responsibles_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_customer_responsibles_customer\` FOREIGN KEY (\`customer_id\`)
          REFERENCES \`customers\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── Travas de tenant na escrita ──────────────────────────────────────────
    for (const table of TENANT_TABLES) {
      await createTenantGuards(queryRunner, table)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TENANT_TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${table}_tenant_insert\``)
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${table}_tenant_update\``)
    }

    await queryRunner.query(`DROP TABLE IF EXISTS \`customer_responsibles\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`customers\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`refresh_tokens\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`users\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`caregivers\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`subscriptions\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`plans\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`tenants\``)
  }
}

/** Tabelas com coluna `tenant_id`, protegidas na escrita pelos triggers. */
const TENANT_TABLES = [
  'subscriptions',
  'users',
  'refresh_tokens',
  'caregivers',
  'customers',
  'customer_responsibles',
] as const

/**
 * Substituto do Row Level Security para a escrita.
 *
 * `@mnvma_tenant_id` é definida pelo TenantContextInterceptor no início da
 * transação de cada requisição autenticada. Se um bug tentar gravar linha de
 * outro tenant, o MySQL aborta com SQLSTATE 45000 em vez de aceitar em silêncio.
 *
 * `@mnvma_system_scope = 1` libera a trava, e só o SystemScope.run() liga essa
 * flag — login, refresh, webhook, jobs e Super Admin. Quando nenhuma das duas
 * variáveis está definida (migrations, seeds, console de DBA), a trava não
 * bloqueia: travar aí só impediria manutenção legítima.
 */
async function createTenantGuards(queryRunner: QueryRunner, table: string): Promise<void> {
  const check = (row: 'NEW' | 'OLD') => `
    IF @mnvma_system_scope IS NULL OR @mnvma_system_scope <> 1 THEN
      IF @mnvma_tenant_id IS NOT NULL AND ${row}.tenant_id <> @mnvma_tenant_id THEN
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

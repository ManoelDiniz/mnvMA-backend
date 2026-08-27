import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Cupons de desconto sobre a mensalidade.
 *
 * Três tabelas, e a divisão entre elas é o que sustenta as regras:
 *
 *   • `coupons` — o cupom em si: percentual, por quantas faturas vale, janela
 *     em que pode ser resgatado e teto de resgates. É catálogo global, como
 *     `plans`: não pertence a tenant nenhum e só o dono do SaaS cria.
 *
 *   • `coupon_targets` — a lista de quem pode usar. Cupom SEM alvo é aberto;
 *     com alvo, só quem está nela entra. O alvo é por e-mail (a pessoa pode
 *     nem ter conta ainda quando o cupom é criado) ou por conta já existente.
 *
 *   • `coupon_redemptions` — o resgate. Guarda o percentual e a quantidade de
 *     faturas CONGELADOS no momento em que a pessoa usou: mexer no cupom
 *     depois não pode mudar o desconto de quem já resgatou. A chave única
 *     `(coupon_id, tenant_id)` é a regra "uma vez por conta" — não é
 *     verificação de aplicação, é o banco recusando a segunda linha.
 *
 * `coupon_targets.target_tenant_id` se chama assim, e não `tenant_id`, de
 * propósito: é uma tabela administrativa global, e a coluna `tenant_id` neste
 * projeto significa "esta linha pertence a este tenant" — com trigger de guarda
 * junto. Aqui ela é só um ponteiro para o alvo.
 */
export class AddCoupons1756000008000 implements MigrationInterface {
  name = 'AddCoupons1756000008000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Cupom ────────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE \`coupons\` (
        \`id\`                       varchar(36) NOT NULL,
        \`code\`                     varchar(40) NOT NULL,
        \`name\`                     varchar(120) NOT NULL,
        \`description\`              text NULL,
        \`discount_percent\`         tinyint unsigned NOT NULL,
        \`max_invoices\`             int NOT NULL DEFAULT 1,
        \`starts_at\`                datetime(6) NULL,
        \`expires_at\`               datetime(6) NULL,
        \`max_redemptions\`          int NULL,
        \`tenant_type\`              enum('INDIVIDUAL','COMPANY') NULL,
        \`first_subscription_only\`  tinyint(1) NOT NULL DEFAULT 0,
        \`is_active\`                tinyint(1) NOT NULL DEFAULT 1,
        \`created_by_user_id\`       varchar(36) NULL,
        \`created_at\`               datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`               datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                     ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`               datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_coupons_code\` (\`code\`),
        KEY \`idx_coupons_ativos\` (\`is_active\`, \`expires_at\`),
        CONSTRAINT \`ck_coupons_percentual\`
          CHECK (\`discount_percent\` >= 1 AND \`discount_percent\` <= 100),
        CONSTRAINT \`ck_coupons_faturas\` CHECK (\`max_invoices\` >= 1)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── Quem pode usar ───────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE \`coupon_targets\` (
        \`id\`                varchar(36) NOT NULL,
        \`coupon_id\`         varchar(36) NOT NULL,
        \`email\`             varchar(180) NULL,
        \`target_tenant_id\`  varchar(36) NULL,
        \`created_at\`        datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`        datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                              ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`        datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_coupon_targets_email\` (\`coupon_id\`, \`email\`),
        UNIQUE KEY \`uq_coupon_targets_tenant\` (\`coupon_id\`, \`target_tenant_id\`),
        CONSTRAINT \`fk_coupon_targets_coupon\` FOREIGN KEY (\`coupon_id\`)
          REFERENCES \`coupons\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`ck_coupon_targets_alvo\`
          CHECK (\`email\` IS NOT NULL OR \`target_tenant_id\` IS NOT NULL)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── Resgate ──────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE \`coupon_redemptions\` (
        \`id\`                varchar(36) NOT NULL,
        \`tenant_id\`         varchar(36) NOT NULL,
        \`coupon_id\`         varchar(36) NOT NULL,
        \`user_id\`           varchar(36) NULL,
        \`subscription_id\`   varchar(36) NULL,
        \`discount_percent\`  tinyint unsigned NOT NULL,
        \`max_invoices\`      int NOT NULL DEFAULT 1,
        \`invoices_used\`     int NOT NULL DEFAULT 0,
        \`status\`            enum('PENDING','ACTIVE','EXHAUSTED','CANCELED')
                              NOT NULL DEFAULT 'PENDING',
        \`redeemed_at\`       datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`activated_at\`      datetime(6) NULL,
        \`ends_at\`           datetime(6) NULL,
        \`warned_stage\`      tinyint NOT NULL DEFAULT 0,
        \`created_at\`        datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`        datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                              ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`        datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_coupon_redemptions_tenant_id\` (\`tenant_id\`),
        -- A regra "uma vez por conta", garantida pelo banco e não por um IF.
        UNIQUE KEY \`uq_coupon_redemptions_conta\` (\`coupon_id\`, \`tenant_id\`),
        KEY \`idx_coupon_redemptions_situacao\` (\`status\`, \`ends_at\`),
        CONSTRAINT \`fk_coupon_redemptions_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_coupon_redemptions_coupon\` FOREIGN KEY (\`coupon_id\`)
          REFERENCES \`coupons\` (\`id\`),
        CONSTRAINT \`fk_coupon_redemptions_assinatura\` FOREIGN KEY (\`subscription_id\`)
          REFERENCES \`subscriptions\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    await criarTravasDeTenant(queryRunner, 'coupon_redemptions')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_coupon_redemptions_tenant_insert\``)
    await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_coupon_redemptions_tenant_update\``)

    await queryRunner.query(`DROP TABLE IF EXISTS \`coupon_redemptions\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`coupon_targets\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`coupons\``)
  }
}

/** Mesmas travas das demais tabelas com `tenant_id` (ver a migration inicial). */
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

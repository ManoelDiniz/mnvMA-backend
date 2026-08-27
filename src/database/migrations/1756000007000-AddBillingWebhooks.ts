import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * O que faltava para a cobrança existir de verdade.
 *
 *   • `webhook_events` — tudo que o Mercado Pago manda, gravado ANTES de ser
 *     processado. A chave única `(provider, event_id, type)` é a idempotência
 *     inteira: o MP reenvia a mesma notificação quando o 200 demora, e sem esta
 *     trava o reenvio viraria período de assinatura duplicado. Também é o que
 *     permite reprocessar sem pedir nada ao provedor — o evento está aqui.
 *
 *   • `subscription_payments` — o extrato da assinatura. Cada cobrança
 *     recorrente aprovada ou recusada vira uma linha, e é dela que sai tanto o
 *     "quando venci" da tela quanto o gatilho do dunning.
 *
 *   • Colunas novas em `subscriptions` — o estado do dunning (em que aviso a
 *     conta está) e o downgrade agendado. Downgrade não pode valer na hora:
 *     quem pagou o mês inteiro tem direito ao mês inteiro, então o plano menor
 *     fica guardado aqui e entra quando o período vira.
 *
 * `webhook_events` não tem `tenant_id` de propósito: quando o evento chega
 * ainda não se sabe de quem ele é — o tenant é descoberto pelo
 * `external_reference`. É tabela de sistema, como `job_runs`.
 */
export class AddBillingWebhooks1756000007000 implements MigrationInterface {
  name = 'AddBillingWebhooks1756000007000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Eventos recebidos do provedor ────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE \`webhook_events\` (
        \`id\`             varchar(36) NOT NULL,
        \`provider\`       varchar(30) NOT NULL DEFAULT 'mercadopago',
        \`event_id\`       varchar(120) NOT NULL,
        \`type\`           varchar(60) NOT NULL,
        \`action\`         varchar(60) NULL,
        \`payload\`        json NULL,
        \`signature_ok\`   tinyint(1) NOT NULL DEFAULT 0,
        \`received_at\`    datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`processed_at\`   datetime(6) NULL,
        \`attempts\`       int NOT NULL DEFAULT 0,
        \`last_error\`     varchar(500) NULL,
        \`tenant_id\`      varchar(36) NULL,
        \`orphan\`         tinyint(1) NOT NULL DEFAULT 0,
        \`created_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                           ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`     datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_webhook_events_evento\` (\`provider\`, \`event_id\`, \`type\`),
        KEY \`idx_webhook_events_pendentes\` (\`processed_at\`, \`received_at\`),
        KEY \`idx_webhook_events_orfaos\` (\`orphan\`, \`processed_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── Extrato da assinatura ────────────────────────────────────────────────
    //
    // `tenant_id` aqui é do tenant: a tela de assinatura mostra o histórico de
    // cobranças da própria conta, então a linha precisa das travas de sempre.

    await queryRunner.query(`
      CREATE TABLE \`subscription_payments\` (
        \`id\`               varchar(36) NOT NULL,
        \`tenant_id\`        varchar(36) NOT NULL,
        \`subscription_id\`  varchar(36) NOT NULL,
        \`provider\`         varchar(30) NOT NULL DEFAULT 'mercadopago',
        \`mp_payment_id\`    varchar(120) NOT NULL,
        \`status\`           enum('PENDING','APPROVED','REJECTED','REFUNDED','CHARGED_BACK','CANCELLED')
                             NOT NULL DEFAULT 'PENDING',
        \`status_detail\`    varchar(120) NULL,
        \`amount\`           decimal(12,2) NOT NULL DEFAULT '0.00',
        \`currency\`         varchar(3) NOT NULL DEFAULT 'BRL',
        \`payment_method\`   varchar(60) NULL,
        \`due_at\`           datetime(6) NULL,
        \`paid_at\`          datetime(6) NULL,
        \`period_start\`     datetime(6) NULL,
        \`period_end\`       datetime(6) NULL,
        \`created_at\`       datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`       datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                             ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`       datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_subscription_payments_tenant_id\` (\`tenant_id\`),
        UNIQUE KEY \`uq_subscription_payments_mp\` (\`provider\`, \`mp_payment_id\`),
        KEY \`idx_subscription_payments_assinatura\` (\`subscription_id\`, \`created_at\`),
        CONSTRAINT \`fk_subscription_payments_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_subscription_payments_assinatura\` FOREIGN KEY (\`subscription_id\`)
          REFERENCES \`subscriptions\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    await criarTravasDeTenant(queryRunner, 'subscription_payments')

    // ─── Dunning e downgrade agendado ─────────────────────────────────────────

    await queryRunner.query(`
      ALTER TABLE \`subscriptions\`
        ADD COLUMN \`dunning_stage\`    tinyint NOT NULL DEFAULT 0 AFTER \`grace_until\`,
        ADD COLUMN \`past_due_since\`   datetime(6) NULL AFTER \`dunning_stage\`,
        ADD COLUMN \`last_dunning_at\`  datetime(6) NULL AFTER \`past_due_since\`,
        ADD COLUMN \`pending_plan_id\`  varchar(36) NULL AFTER \`last_dunning_at\`,
        ADD COLUMN \`checkout_url\`     varchar(500) NULL AFTER \`pending_plan_id\`,
        ADD CONSTRAINT \`fk_subscriptions_pending_plan\` FOREIGN KEY (\`pending_plan_id\`)
          REFERENCES \`plans\` (\`id\`)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`subscriptions\`
        DROP FOREIGN KEY \`fk_subscriptions_pending_plan\`
    `)
    await queryRunner.query(`
      ALTER TABLE \`subscriptions\`
        DROP COLUMN \`dunning_stage\`,
        DROP COLUMN \`past_due_since\`,
        DROP COLUMN \`last_dunning_at\`,
        DROP COLUMN \`pending_plan_id\`,
        DROP COLUMN \`checkout_url\`
    `)

    await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_subscription_payments_tenant_insert\``)
    await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_subscription_payments_tenant_update\``)

    await queryRunner.query(`DROP TABLE IF EXISTS \`subscription_payments\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`webhook_events\``)
  }
}

/**
 * Mesmas travas das demais tabelas com `tenant_id` (ver a migration inicial).
 * O `COLLATE` explícito existe porque `@mnvma_tenant_id` é variável de sessão e
 * vem com a collation do cliente — sem convertê-la, a comparação estoura.
 */
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

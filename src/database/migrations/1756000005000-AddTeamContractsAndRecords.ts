import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Sprint 6 — o que separa a empresa do cuidador sozinho.
 *
 * Cinco tabelas e uma coluna, todas com o mesmo motivo de existir: guardar o
 * que aconteceu, e não só o estado atual.
 *
 *   • `invitations`      — o usuário só nasce quando o convite é aceito, e por
 *                          isso o e-mail não fica queimado enquanto o convite
 *                          dorme na caixa de entrada.
 *   • `caregiver_documents` — validade de COREN e atestado, para o alerta
 *                          disparar ANTES de virar risco trabalhista.
 *   • `occurrences`      — o prontuário operacional. Não some.
 *   • `shift_substitutions` — o plantão mostra quem ficou; esta tabela mostra
 *                          quem saiu, que é o que responde por rotatividade.
 *   • `contracts`        — receita recorrente, cobrada independentemente de
 *                          quantos plantões couberam no mês.
 *
 * A coluna nova em `account_receivables` (`contract_id`) vem com chave única
 * `(tenant_id, contract_id, due_date)`: é ela que impede o job de cobrança de
 * mandar a mesma mensalidade duas vezes quando roda em duas instâncias ao mesmo
 * tempo. As travas em memória do serviço dão a mensagem boa; esta é a que
 * protege o cliente de verdade.
 */
export class AddTeamContractsAndRecords1756000005000 implements MigrationInterface {
  name = 'AddTeamContractsAndRecords1756000005000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Convites ─────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE \`invitations\` (
        \`id\`                  varchar(36) NOT NULL,
        \`tenant_id\`           varchar(36) NOT NULL,
        \`email\`               varchar(180) NOT NULL,
        \`name\`                varchar(160) NOT NULL,
        \`role\`                enum('SUPER_ADMIN','OWNER','ADMIN','MANAGER','COORDINATOR','FINANCE','CAREGIVER')
                                NOT NULL,
        \`caregiver_id\`        varchar(36) NULL,
        \`token_hash\`          varchar(64) NOT NULL,
        \`expires_at\`          datetime(6) NOT NULL,
        \`accepted_at\`         datetime(6) NULL,
        \`revoked_at\`          datetime(6) NULL,
        \`invited_by_user_id\`  varchar(36) NULL,
        \`invited_by_name\`     varchar(160) NULL,
        \`created_at\`          datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`          datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`          datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_invitations_tenant_id\` (\`tenant_id\`),
        KEY \`idx_invitations_email\` (\`tenant_id\`, \`email\`),
        KEY \`idx_invitations_token\` (\`token_hash\`),
        CONSTRAINT \`fk_invitations_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_invitations_caregiver\` FOREIGN KEY (\`caregiver_id\`)
          REFERENCES \`caregivers\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── Documentos do cuidador ───────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE \`caregiver_documents\` (
        \`id\`           varchar(36) NOT NULL,
        \`tenant_id\`    varchar(36) NOT NULL,
        \`caregiver_id\` varchar(36) NOT NULL,
        \`type\`         enum('RG','CPF','CNH','COREN','PROOF_OF_ADDRESS','COURSE_CERTIFICATE','HEALTH_CERTIFICATE','CRIMINAL_RECORD','VACCINATION','CONTRACT','OTHER')
                         NOT NULL DEFAULT 'OTHER',
        \`label\`        varchar(120) NULL,
        \`number\`       varchar(60) NULL,
        \`issued_at\`    date NULL,
        \`expires_at\`   date NULL,
        \`file_key\`     varchar(400) NULL,
        \`file_name\`    varchar(200) NULL,
        \`notes\`        text NULL,
        \`created_at\`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                         ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`   datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_caregiver_documents_tenant_id\` (\`tenant_id\`),
        KEY \`idx_documents_cuidador\` (\`tenant_id\`, \`caregiver_id\`),
        KEY \`idx_documents_validade\` (\`tenant_id\`, \`expires_at\`),
        CONSTRAINT \`fk_documents_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_documents_caregiver\` FOREIGN KEY (\`caregiver_id\`)
          REFERENCES \`caregivers\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── Ocorrências ──────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE \`occurrences\` (
        \`id\`                   varchar(36) NOT NULL,
        \`tenant_id\`            varchar(36) NOT NULL,
        \`shift_id\`             varchar(36) NULL,
        \`customer_id\`          varchar(36) NOT NULL,
        \`caregiver_id\`         varchar(36) NULL,
        \`type\`                 enum('HEALTH','FALL','MEDICATION','BEHAVIOR','ABSENCE','DELAY','EQUIPMENT','FAMILY','OTHER')
                                 NOT NULL DEFAULT 'OTHER',
        \`severity\`             enum('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'LOW',
        \`occurred_at\`          datetime(6) NOT NULL,
        \`title\`                varchar(200) NOT NULL,
        \`description\`          text NOT NULL,
        \`action_taken\`         text NULL,
        \`family_notified\`      tinyint NOT NULL DEFAULT 0,
        \`resolved_at\`          datetime(6) NULL,
        \`resolution\`           text NULL,
        \`reported_by_user_id\`  varchar(36) NULL,
        \`reported_by_name\`     varchar(160) NULL,
        \`created_at\`           datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`           datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                 ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`           datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_occurrences_tenant_id\` (\`tenant_id\`),
        KEY \`idx_occurrences_data\` (\`tenant_id\`, \`occurred_at\`),
        KEY \`idx_occurrences_cliente\` (\`tenant_id\`, \`customer_id\`, \`occurred_at\`),
        KEY \`idx_occurrences_cuidador\` (\`tenant_id\`, \`caregiver_id\`, \`occurred_at\`),
        KEY \`idx_occurrences_gravidade\` (\`tenant_id\`, \`severity\`, \`resolved_at\`),
        CONSTRAINT \`fk_occurrences_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_occurrences_shift\` FOREIGN KEY (\`shift_id\`)
          REFERENCES \`shifts\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`fk_occurrences_customer\` FOREIGN KEY (\`customer_id\`)
          REFERENCES \`customers\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_occurrences_caregiver\` FOREIGN KEY (\`caregiver_id\`)
          REFERENCES \`caregivers\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── Substituições ────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE \`shift_substitutions\` (
        \`id\`                     varchar(36) NOT NULL,
        \`tenant_id\`              varchar(36) NOT NULL,
        \`shift_id\`               varchar(36) NOT NULL,
        \`previous_caregiver_id\`  varchar(36) NULL,
        \`new_caregiver_id\`       varchar(36) NOT NULL,
        \`reason\`                 varchar(255) NOT NULL,
        \`changed_by_user_id\`     varchar(36) NULL,
        \`changed_by_name\`        varchar(160) NULL,
        \`previous_cost\`          decimal(12,2) NOT NULL DEFAULT '0.00',
        \`created_at\`             datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`             datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                   ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`             datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_shift_substitutions_tenant_id\` (\`tenant_id\`),
        KEY \`idx_substitutions_plantao\` (\`tenant_id\`, \`shift_id\`),
        KEY \`idx_substitutions_anterior\` (\`tenant_id\`, \`previous_caregiver_id\`),
        CONSTRAINT \`fk_substitutions_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_substitutions_shift\` FOREIGN KEY (\`shift_id\`)
          REFERENCES \`shifts\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_substitutions_previous\` FOREIGN KEY (\`previous_caregiver_id\`)
          REFERENCES \`caregivers\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`fk_substitutions_new\` FOREIGN KEY (\`new_caregiver_id\`)
          REFERENCES \`caregivers\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── Contratos ────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE \`contracts\` (
        \`id\`                      varchar(36) NOT NULL,
        \`tenant_id\`               varchar(36) NOT NULL,
        \`customer_id\`             varchar(36) NOT NULL,
        \`service_id\`              varchar(36) NULL,
        \`caregiver_id\`            varchar(36) NULL,
        \`name\`                    varchar(160) NOT NULL,
        \`code\`                    varchar(40) NULL,
        \`status\`                  enum('DRAFT','ACTIVE','SUSPENDED','ENDED') NOT NULL DEFAULT 'DRAFT',
        \`start_date\`              date NOT NULL,
        \`end_date\`                date NULL,
        \`billing_cycle\`           enum('MONTHLY','BIWEEKLY') NOT NULL DEFAULT 'MONTHLY',
        \`amount\`                  decimal(12,2) NOT NULL,
        \`estimated_cost\`          decimal(12,2) NULL,
        \`billing_day\`             smallint UNSIGNED NOT NULL DEFAULT 10,
        \`bill_in_arrears\`         tinyint NOT NULL DEFAULT 0,
        \`last_billed_competence\`  char(7) NULL,
        \`status_reason\`           varchar(255) NULL,
        \`notes\`                   text NULL,
        \`created_at\`              datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`              datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                    ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`              datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_contracts_tenant_id\` (\`tenant_id\`),
        KEY \`idx_contracts_cliente\` (\`tenant_id\`, \`customer_id\`),
        KEY \`idx_contracts_status\` (\`tenant_id\`, \`status\`),
        CONSTRAINT \`fk_contracts_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_contracts_customer\` FOREIGN KEY (\`customer_id\`)
          REFERENCES \`customers\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_contracts_service\` FOREIGN KEY (\`service_id\`)
          REFERENCES \`services\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`fk_contracts_caregiver\` FOREIGN KEY (\`caregiver_id\`)
          REFERENCES \`caregivers\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    // ─── Cobrança do contrato dentro do contas a receber ──────────────────────
    //
    // A coluna é exclusiva com `shift_id`: ou a cobrança nasceu do plantão
    // realizado, ou da mensalidade. Preencher as duas seria cobrar o mesmo
    // atendimento duas vezes.

    await queryRunner.query(`
      ALTER TABLE \`account_receivables\`
        ADD COLUMN \`contract_id\` varchar(36) NULL AFTER \`shift_id\`,
        ADD KEY \`idx_receivables_contrato\` (\`tenant_id\`, \`contract_id\`),
        ADD UNIQUE KEY \`uq_receivables_contrato_vencimento\`
          (\`tenant_id\`, \`contract_id\`, \`due_date\`, \`deleted_marker\`),
        ADD CONSTRAINT \`fk_receivables_contract\` FOREIGN KEY (\`contract_id\`)
          REFERENCES \`contracts\` (\`id\`) ON DELETE SET NULL
    `)

    for (const tabela of TABELAS) {
      await criarTravasDeTenant(queryRunner, tabela)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tabela of TABELAS) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${tabela}_tenant_insert\``)
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_${tabela}_tenant_update\``)
    }

    await queryRunner.query(`
      ALTER TABLE \`account_receivables\`
        DROP FOREIGN KEY \`fk_receivables_contract\`,
        DROP KEY \`uq_receivables_contrato_vencimento\`,
        DROP KEY \`idx_receivables_contrato\`,
        DROP COLUMN \`contract_id\`
    `)

    await queryRunner.query(`DROP TABLE IF EXISTS \`contracts\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`shift_substitutions\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`occurrences\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`caregiver_documents\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`invitations\``)
  }
}

const TABELAS = [
  'invitations',
  'caregiver_documents',
  'occurrences',
  'shift_substitutions',
  'contracts',
] as const

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

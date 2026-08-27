import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Duas tabelas que tiram a operação do modo manual.
 *
 *   • `password_reset_tokens` — até aqui, esquecer a senha significava pedir a
 *     alguém com acesso ao banco. Mesmo desenho do convite: o e-mail leva o
 *     token, o banco guarda só o hash, e a linha usada fica para poder dizer
 *     "este link já foi usado" em vez de "link inválido".
 *
 *   • `job_runs` — a trava que permite ter mais de uma instância da API sem que
 *     o aviso de fim de trial saia duplicado. A chave única `(job, run_key)` é
 *     o mecanismo inteiro: quem consegue inserir, roda. Trava em memória não
 *     atravessa contêiner; esta atravessa.
 */
export class AddPasswordResetAndJobs1756000006000 implements MigrationInterface {
  name = 'AddPasswordResetAndJobs1756000006000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Redefinição de senha ─────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE \`password_reset_tokens\` (
        \`id\`                     varchar(36) NOT NULL,
        \`tenant_id\`              varchar(36) NOT NULL,
        \`user_id\`                varchar(36) NOT NULL,
        \`token_hash\`             varchar(64) NOT NULL,
        \`expires_at\`             datetime(6) NOT NULL,
        \`used_at\`                datetime(6) NULL,
        \`requested_ip\`           varchar(45) NULL,
        \`requested_user_agent\`   varchar(255) NULL,
        \`created_at\`             datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`             datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                   ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`             datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_password_reset_tokens_tenant_id\` (\`tenant_id\`),
        UNIQUE KEY \`idx_password_resets_token\` (\`token_hash\`),
        KEY \`idx_password_resets_user\` (\`user_id\`, \`used_at\`),
        CONSTRAINT \`fk_password_resets_tenant\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_password_resets_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)

    await criarTravasDeTenant(queryRunner, 'password_reset_tokens')

    // ─── Execuções de job ─────────────────────────────────────────────────────
    //
    // Sem `tenant_id` e, portanto, sem trigger de guarda: é tabela de sistema.
    // Os jobs atravessam contas por dentro do SystemScope, que já exige motivo.

    await queryRunner.query(`
      CREATE TABLE \`job_runs\` (
        \`id\`           varchar(36) NOT NULL,
        \`job\`          varchar(60) NOT NULL,
        \`run_key\`      varchar(60) NOT NULL,
        \`status\`       enum('RUNNING','OK','FAILED') NOT NULL DEFAULT 'RUNNING',
        \`started_at\`   datetime(6) NOT NULL,
        \`finished_at\`  datetime(6) NULL,
        \`detail\`       varchar(500) NULL,
        \`runner\`       varchar(120) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_job_runs_execucao\` (\`job\`, \`run_key\`),
        KEY \`idx_job_runs_recentes\` (\`job\`, \`started_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_password_reset_tokens_tenant_insert\``)
    await queryRunner.query(`DROP TRIGGER IF EXISTS \`trg_password_reset_tokens_tenant_update\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`job_runs\``)
    await queryRunner.query(`DROP TABLE IF EXISTS \`password_reset_tokens\``)
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

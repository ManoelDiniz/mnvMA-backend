import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * O que o dono do SaaS fez na conta de um cliente.
 *
 * Existe por um motivo específico: as ações do MNVMA Core atravessam a fronteira
 * do tenant. Suspender uma conta que está pagando, cancelar o cupom de alguém,
 * e amanhã entrar como o cliente para investigar um problema — nenhuma dessas
 * coisas pode acontecer sem deixar rastro de **quem**, **quando** e **por quê**.
 *
 * Log em arquivo não serve para isso: ele expira, fica no agregador, e não é
 * consultável de dentro do produto quando o cliente liga perguntando por que a
 * conta dele parou. Aqui é uma tabela, ao lado do dado.
 *
 * Sem `tenant_id`: é tabela de sistema, como `job_runs` e `webhook_events`. A
 * coluna `target_tenant_id` aponta para a conta afetada, e por não se chamar
 * `tenant_id` não entra na convenção dos triggers de guarda — o que é correto,
 * porque quem grava aqui é justamente quem está fora de qualquer tenant.
 */
export class AddAdminActions1756000009000 implements MigrationInterface {
  name = 'AddAdminActions1756000009000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`admin_actions\` (
        \`id\`                varchar(36) NOT NULL,
        \`actor_user_id\`     varchar(36) NOT NULL,
        \`actor_email\`       varchar(180) NULL,
        \`action\`            varchar(60) NOT NULL,
        \`target_tenant_id\`  varchar(36) NULL,
        \`reason\`            varchar(500) NULL,
        \`metadata\`          json NULL,
        \`created_at\`        datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\`        datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                              ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\`        datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_admin_actions_conta\` (\`target_tenant_id\`, \`created_at\`),
        KEY \`idx_admin_actions_autor\` (\`actor_user_id\`, \`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`admin_actions\``)
  }
}

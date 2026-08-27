import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * O arquivo do documento, e não só a validade dele.
 *
 * `file_key` e `file_name` já existiam desde a migration do Sprint 6 — a tabela
 * sempre soube que um dia guardaria o PDF. O que faltava era o resto do que se
 * precisa para entregar o arquivo de volta corretamente:
 *
 *   • `mime_type` — para o download sair com o cabeçalho certo. Sem ele, o
 *     navegador adivinha, e adivinhar tipo de arquivo é como se abre a porta
 *     para um HTML disfarçado de PDF rodar no nosso domínio.
 *   • `file_size` — para a tela dizer "2,4 MB" antes de alguém no 3G tocar no
 *     link, e para conferir cota depois.
 *   • `file_uploaded_at` — o COREN que subiu hoje e o que subiu há dois anos
 *     valem a mesma coisa no papel; na auditoria, não.
 */
export class AddDocumentFiles1756000010000 implements MigrationInterface {
  name = 'AddDocumentFiles1756000010000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`caregiver_documents\`
        ADD COLUMN \`mime_type\`        varchar(120) NULL AFTER \`file_name\`,
        ADD COLUMN \`file_size\`        int NULL AFTER \`mime_type\`,
        ADD COLUMN \`file_uploaded_at\` datetime(6) NULL AFTER \`file_size\`
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`caregiver_documents\`
        DROP COLUMN \`mime_type\`,
        DROP COLUMN \`file_size\`,
        DROP COLUMN \`file_uploaded_at\`
    `)
  }
}

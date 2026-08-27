import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Caregiver } from '../../caregivers/entities/caregiver.entity'

/**
 * Tipos usados na contratação de cuidador no Brasil. `OTHER` existe porque cada
 * empresa exige um papel diferente e travar a lista faria o cadastro parar.
 */
export enum DocumentType {
  RG = 'RG',
  CPF = 'CPF',
  CNH = 'CNH',
  /** Registro no Conselho de Enfermagem — técnico e auxiliar. */
  COREN = 'COREN',
  PROOF_OF_ADDRESS = 'PROOF_OF_ADDRESS',
  COURSE_CERTIFICATE = 'COURSE_CERTIFICATE',
  HEALTH_CERTIFICATE = 'HEALTH_CERTIFICATE',
  CRIMINAL_RECORD = 'CRIMINAL_RECORD',
  VACCINATION = 'VACCINATION',
  CONTRACT = 'CONTRACT',
  OTHER = 'OTHER',
}

/** Situação DERIVADA de `expiresAt`. Nunca vira coluna — ver `situacaoDe()`. */
export enum DocumentStatus {
  /** Sem validade: RG, CPF, diploma. */
  PERMANENT = 'PERMANENT',
  VALID = 'VALID',
  /** Vence nos próximos 30 dias. */
  EXPIRING = 'EXPIRING',
  EXPIRED = 'EXPIRED',
}

/**
 * Documento do cuidador com controle de validade.
 *
 * O que importa aqui não é guardar o arquivo — é avisar ANTES de vencer.
 * Atestado de saúde vencido ou COREN suspenso põem a empresa em risco
 * trabalhista no dia em que acontece um incidente, e ninguém descobre isso
 * olhando pasta por pasta.
 *
 * O arquivo em si fica num bucket (R2/S3) e aqui guardamos só a referência:
 * banco não é lugar de PDF, e a URL assinada é gerada na hora do download.
 */
@Entity('caregiver_documents')
@Index('idx_documents_cuidador', ['tenantId', 'caregiverId'])
@Index('idx_documents_validade', ['tenantId', 'expiresAt'])
export class CaregiverDocument extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  caregiverId: string

  @ManyToOne(() => Caregiver, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caregiver_id' })
  caregiver?: Caregiver

  @ApiProperty({ enum: DocumentType })
  @Column({ type: 'enum', enum: DocumentType, default: DocumentType.OTHER })
  type: DocumentType

  @ApiPropertyOptional({ description: 'Rótulo livre, usado quando o tipo é OTHER' })
  @Column({ type: 'varchar', length: 120, nullable: true })
  label?: string | null

  @ApiPropertyOptional({ description: 'Número/registro do documento' })
  @Column({ type: 'varchar', length: 60, nullable: true })
  number?: string | null

  @ApiPropertyOptional({ type: 'string', format: 'date' })
  @Column({ type: 'date', nullable: true })
  issuedAt?: string | null

  @ApiPropertyOptional({
    type: 'string',
    format: 'date',
    description: 'Nulo = documento sem validade.',
  })
  @Column({ type: 'date', nullable: true })
  expiresAt?: string | null

  @ApiPropertyOptional({ description: 'Chave do arquivo no bucket' })
  @Column({ type: 'varchar', length: 400, nullable: true })
  fileKey?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'varchar', length: 200, nullable: true })
  fileName?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  notes?: string | null
}

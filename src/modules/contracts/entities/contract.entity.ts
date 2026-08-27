import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'
import { MoneyColumn } from '../../../common/database/decimal.transformer'
import { TenantBaseEntity } from '../../../common/entities/base.entity'
import { Caregiver } from '../../caregivers/entities/caregiver.entity'
import { Customer } from '../../customers/entities/customer.entity'
import { Service } from '../../services/entities/service.entity'

export enum ContractStatus {
  /** Ainda não vale — em negociação. Não gera cobrança. */
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  /** Pausado (internação do idoso, viagem da família). Não gera cobrança. */
  SUSPENDED = 'SUSPENDED',
  ENDED = 'ENDED',
}

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  /** Quinzenal: duas cobranças por competência. */
  BIWEEKLY = 'BIWEEKLY',
}

/**
 * Contrato de atendimento continuado.
 *
 * É o que separa a empresa do freelancer: receita previsível, cobrada todo mês
 * independentemente de quantos plantões couberam no calendário. Por isso a
 * cobrança do contrato **não** sai do plantão — plantão gera o financeiro dele
 * (§9), contrato gera o dele, e somar os dois no mesmo cliente seria cobrar
 * duas vezes pelo mesmo serviço.
 *
 * Na prática o cliente escolhe um dos dois modelos, e o relatório de
 * rentabilidade por contrato existe justamente para comparar o combinado
 * (`amount`) com o que a operação custou de verdade nos plantões do período.
 *
 * `lastBilledCompetence` é a marca d'água da geração: junto com a chave única
 * em `account_receivables`, garante que rodar o job duas vezes no mesmo dia não
 * cobre o cliente duas vezes.
 */
@Entity('contracts')
@Index('idx_contracts_cliente', ['tenantId', 'customerId'])
@Index('idx_contracts_status', ['tenantId', 'status'])
export class Contract extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  customerId: string

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer

  @ApiPropertyOptional({ description: 'Serviço contratado, para o relatório por serviço' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  serviceId?: string | null

  @ManyToOne(() => Service, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_id' })
  service?: Service | null

  @ApiPropertyOptional({ description: 'Cuidador de referência do contrato' })
  @Column({ type: 'varchar', length: 36, nullable: true })
  caregiverId?: string | null

  @ManyToOne(() => Caregiver, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'caregiver_id' })
  caregiver?: Caregiver | null

  @ApiProperty({ example: 'Acompanhamento 12h — Dona Marta' })
  @Column({ length: 160 })
  name: string

  @ApiPropertyOptional({ description: 'Número interno / do contrato assinado' })
  @Column({ type: 'varchar', length: 40, nullable: true })
  code?: string | null

  @ApiProperty({ enum: ContractStatus })
  @Column({ type: 'enum', enum: ContractStatus, default: ContractStatus.DRAFT })
  status: ContractStatus

  @ApiProperty({ type: 'string', format: 'date' })
  @Column({ type: 'date' })
  startDate: string

  @ApiPropertyOptional({ type: 'string', format: 'date', description: 'Vazio = sem prazo' })
  @Column({ type: 'date', nullable: true })
  endDate?: string | null

  @ApiProperty({ enum: BillingCycle })
  @Column({ type: 'enum', enum: BillingCycle, default: BillingCycle.MONTHLY })
  billingCycle: BillingCycle

  @ApiProperty({ description: 'Valor de CADA cobrança, não do mês', example: '3200.00' })
  @MoneyColumn()
  amount: string

  @ApiPropertyOptional({
    description: 'Custo previsto com cuidador por ciclo. Serve para a margem esperada.',
    example: '1900.00',
  })
  @MoneyColumn({ nullable: true })
  estimatedCost?: string | null

  @ApiProperty({ description: 'Dia do vencimento. 31 cai no último dia do mês.', example: 10 })
  @Column({ type: 'smallint', unsigned: true, default: 10 })
  billingDay: number

  @ApiProperty({
    description: 'Cobra no mês seguinte ao prestado (competência de agosto vence em setembro)',
    default: false,
  })
  @Column({ default: false })
  billInArrears: boolean

  @ApiPropertyOptional({ description: 'Última competência já cobrada', example: '2026-08' })
  @Column({ type: 'char', length: 7, nullable: true })
  lastBilledCompetence?: string | null

  @ApiPropertyOptional({ description: 'Motivo da suspensão ou do encerramento' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  statusReason?: string | null

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  notes?: string | null
}

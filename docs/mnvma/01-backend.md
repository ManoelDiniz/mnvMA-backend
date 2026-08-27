# MNVMA API — Planejamento do Backend

Repositório: `mnvma-api` · Deploy: Railway (ou Render/Fly.io) · Domínio: `api.mnvma.com.br`

**ORM do projeto: TypeORM.** Todas as decisões abaixo (isolamento de tenant,
migrations, transações) são feitas no padrão TypeORM + MySQL 8.

---

## 1. Responsabilidades

O backend é o dono de tudo que não pode ser confiado ao browser:

- Autenticação, sessão e permissões
- Isolamento entre tenants
- Toda regra de negócio (margem, status, limites de plano)
- Toda comunicação com o Mercado Pago
- Geração de relatórios e agregações
- Auditoria
- Jobs agendados (cobrança, notificações, vencimentos)

O backend **não** serve HTML, não tem template engine, não tem sessão em memória
com estado (precisa escalar horizontalmente).

---

## 2. Stack

| Camada | Escolha |
|---|---|
| Runtime | Node.js 22 LTS |
| Framework | NestJS |
| **ORM** | **TypeORM 0.3.x** (`@nestjs/typeorm`) |
| Banco | **MySQL 8** (`utf8mb4_0900_ai_ci`) |
| Cache / filas | Redis + BullMQ |
| Auth | JWT (access 15min + refresh 30d) + Argon2id |
| Validação | `class-validator` + `class-transformer` (mesmo estilo decorator das entities) |
| Arquivos | Volume no servidor (`STORAGE_DRIVER=local`); S3/R2 é troca de variável |
| Docs | Swagger em `/docs` |
| Logs | Pino + request-id |

---

## 3. Estrutura de pastas

```text
mnvma-api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── data-source.ts             # DataSource da CLI de migrations
│   ├── database/
│   │   ├── migrations/            # geradas por typeorm migration:generate
│   │   ├── seeds/
│   │   └── subscribers/           # TenantSubscriber, AuditSubscriber
│   ├── common/
│   │   ├── entities/              # BaseEntity, TenantBaseEntity
│   │   ├── repositories/          # TenantScopedRepository
│   │   ├── context/               # AsyncLocalStorage do request (tenantId, userId)
│   │   ├── guards/                # JwtAuthGuard, TenantGuard, PermissionsGuard, PlanLimitGuard
│   │   ├── decorators/            # @CurrentUser() @CurrentTenant() @RequirePermission()
│   │   ├── interceptors/          # TenantContextInterceptor, AuditInterceptor
│   │   └── filters/               # HttpExceptionFilter (formato de erro único)
│   ├── modules/
│   │   ├── auth/
│   │   ├── tenants/               # conta, tipo de conta, migração individual→empresa
│   │   ├── users/
│   │   ├── customers/
│   │   ├── caregivers/
│   │   ├── services/
│   │   ├── contracts/
│   │   ├── schedules/
│   │   ├── shifts/                # plantões, substituições, ocorrências, check-in
│   │   ├── finance/
│   │   ├── reports/
│   │   ├── dashboard/
│   │   ├── documents/
│   │   ├── notifications/
│   │   ├── billing/               # planos, assinaturas, Mercado Pago  ← ver 03
│   │   ├── webhooks/
│   │   └── admin/                 # MNVMA Core (Super Admin)
│   ├── jobs/
│   └── config/
├── test/
├── docker-compose.yml             # mysql + redis para dev (opcional)
├── Dockerfile
└── .env.example
```

Cada módulo: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `entities/`,
`dto/`, `*.spec.ts`. Nada de lógica no controller, nada de query fora do service.

### Configuração do TypeORM

```ts
// app.module.ts
TypeOrmModule.forRootAsync({
  useFactory: (cfg: ConfigService) => ({
    type: 'mysql',
    url: cfg.get('DATABASE_URL'),        // mysql://sa:masterkey@localhost:3306/cuidador
    timezone: 'Z',                       // tudo em UTC; conversão só na borda
    charset: 'utf8mb4_0900_ai_ci',
    autoLoadEntities: true,
    synchronize: false,                  // NUNCA true — nem em dev
    namingStrategy: new SnakeNamingStrategy(),
    extra: { connectionLimit: 20, enableKeepAlive: true },
  }),
  inject: [ConfigService],
})
```

`timezone: 'Z'` é obrigatório. O MySQL não tem tipo de data com fuso: se a
conexão reinterpretar o valor, um plantão das 19h vira 22h dependendo do fuso do
servidor — e o relatório de horas trabalhadas deixa de fechar.

A collation `utf8mb4_0900_ai_ci` ignora acento e caixa. Isso resolve de graça
duas coisas que no PostgreSQL exigiriam extensão: buscar "jose" e encontrar
"José", e manter e-mail único sem `lower()` em volta da coluna.

`synchronize: false` é inegociável. Todo mudança de schema vira migration
versionada (`npm run migration:generate -- src/database/migrations/AddShiftCheckIn`).

---

## 4. Multi-tenant com TypeORM + MySQL — a decisão mais importante

**Estratégia: banco único, schema único, coluna `tenant_id` em toda tabela de
negócio, protegida por três camadas.**

O TypeORM não tem filtro global de query, e o **MySQL não tem Row Level
Security** (esse era o plano quando o banco seria PostgreSQL). Confiar em cada
`where` escrito à mão é o caminho garantido para vazar dados de uma empresa para
outra. Então o isolamento fica assim:

| Camada | Protege | Garantia |
|---|---|---|
| `TenantScopedRepository` | Leitura **e** escrita | Aplicação |
| Triggers `BEFORE INSERT/UPDATE` | Escrita | **Banco** |
| Suíte de isolamento no CI | Ambas | Teste, bloqueia merge |

### Camada 1 — `TenantScopedRepository` (a que faz o trabalho na leitura)

Todo service recebe um repositório que já sabe o tenant. O `where` nunca é
escrito à mão, e o repositório estoura se for usado fora do contexto de uma
requisição — falha fechada, em vez de consultar sem filtro.

```ts
// common/database/tenant-scoped.repository.ts (resumo)
export class TenantScopedRepository<T extends TenantBaseEntity> {
  private get repo() { return RequestContext.manager().getRepository(this.target) }
  get tenantId() { return RequestContext.tenantId() }   // lança se não houver

  find(options = {})    { return this.repo.find({ ...options, where: this.scope(options.where) }) }
  findOne(options)      { return this.repo.findOne({ ...options, where: this.scope(options.where) }) }
  create(data)          { return this.repo.create({ ...data, tenantId: this.tenantId }) }
  qb(alias)             { return this.repo.createQueryBuilder(alias)
                            .where(`${alias}.tenantId = :__tenantId`, { __tenantId: this.tenantId }) }
}
```

**Regra do time: nenhum service injeta `Repository<T>` do TypeORM diretamente.**
Sempre `TenantScopedRepository<T>`. As exceções passam por `SystemScope`.

O contexto vem de um interceptor que abre uma transação por requisição
autenticada:

```ts
// common/interceptors/tenant-context.interceptor.ts (resumo)
return from(
  this.dataSource.transaction(async (manager) => {
    await manager.query('SET @mnvma_tenant_id = ?, @mnvma_system_scope = 0', [user.tenantId])
    return RequestContext.run({ tenantId: user.tenantId, userId: user.userId, manager },
      () => lastValueFrom(next.handle()))
  }),
)
```

Dois efeitos colaterais desejados: atomicidade (handler que lança desfaz tudo) e
a conexão fica presa àquela requisição, o que torna a variável de sessão abaixo
confiável.

### Camada 2 — triggers de tenant no MySQL (a barreira real na escrita)

`@mnvma_tenant_id` é conferida por triggers em toda tabela com `tenant_id`.
Gravar linha de outra conta aborta no banco, mesmo que o bug esteja na aplicação:

```sql
CREATE TRIGGER `trg_customers_tenant_insert` BEFORE INSERT ON `customers`
FOR EACH ROW
BEGIN
  IF @mnvma_system_scope IS NULL OR @mnvma_system_scope <> 1 THEN
    IF @mnvma_tenant_id IS NOT NULL AND NEW.tenant_id <> @mnvma_tenant_id THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'MNVMA: tenant_id nao confere com o contexto da sessao';
    END IF;
  END IF;
END
```

`@mnvma_system_scope = 1` libera a trava, e só o `SystemScope.run()` liga essa
flag: login (procura o e-mail antes de saber o tenant), refresh, webhook do
Mercado Pago, jobs e Super Admin. Cada chamada exige um motivo e vira log — se
aparecer no log algo fora dessa lista, é bug.

> **O que essa arquitetura não dá.** No PostgreSQL o RLS faria o banco recusar
> também a *leitura* de outro tenant. No MySQL não existe equivalente: a leitura
> é garantida pela Camada 1 e provada pela Camada 3. Se um dia isso não bastar —
> auditoria, cliente grande exigindo garantia formal — o reforço é servir cada
> tabela por uma VIEW filtrada com `WITH CHECK OPTION` e dar ao usuário da
> aplicação acesso só às views, nunca às tabelas.

### Camada 3 — a suíte de isolamento

Para cada endpoint: o tenant B tenta ler, editar e apagar um recurso do tenant A
e recebe **404** (não 403 — 403 confirmaria que o recurso existe). Roda em todo
PR e bloqueia merge. Está em `test/tenant-isolation.e2e-spec.ts`.

Com MySQL essa suíte deixa de ser "boa prática" e passa a ser a única prova
automática de que a Camada 1 está sendo respeitada em todo lugar.

### Índices e constraints

- Índice composto sempre começando pelo tenant: `@Index(['tenantId', 'startsAt'])`
- Unicidade sempre com o tenant junto — nunca CPF único global.
- **O MySQL não tem índice parcial** (`UNIQUE ... WHERE deleted_at IS NULL`). O
  contorno é uma coluna gerada que entra na chave:

```sql
`deleted_marker` datetime(6) GENERATED ALWAYS AS
  (ifnull(`deleted_at`, '1970-01-01 00:00:00.000000')) STORED,
UNIQUE KEY `uq_customers_tenant_cpf` (`tenant_id`, `cpf`, `deleted_marker`)
```

Registros ativos compartilham o mesmo marcador e colidem entre si; os excluídos
têm marcador distinto, então um CPF apagado pode ser recadastrado.

### Tipo de conta

`Tenant.type` é `INDIVIDUAL` ou `COMPANY`. Mesma estrutura, módulos liberados por
tipo:

```ts
const MODULES: Record<TenantType, Module[]> = {
  INDIVIDUAL: ['customers','shifts','availability','services','finance','reports'],
  COMPANY:    ['customers','caregivers','schedules','shifts','contracts',
               'occurrences','substitutions','teams','documents','finance',
               'reports','profitability','users'],
}
```

Na conta individual, o próprio dono é criado como `Caregiver` com
`isOwner = true`. Migrar Individual → Empresa vira apenas mudar `tenant.type`,
criar papéis e liberar módulos — **nenhum dado muda de tabela** (requisito §18 do
planejamento de produto). É por isso que se modela assim desde o dia 1.

---

## 5. Modelo de dados (entities TypeORM)

Todo modelo de negócio herda de `TenantBaseEntity`.

```ts
// common/entities/base.entity.ts
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date

  @DeleteDateColumn({ type: 'datetime', precision: 6 })   // soft delete nativo do TypeORM
  deletedAt?: Date
}

export abstract class TenantBaseEntity extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 36 })
  tenantId: string

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant
}
```

Transformer de dinheiro — `decimal` volta como string no mysql2, e
`parseFloat` em dinheiro é como se abre buraco no financeiro:

```ts
// common/transformers/decimal.transformer.ts
export const DecimalTransformer: ValueTransformer = {
  to:   (v?: string | number | null) => v ?? null,
  from: (v?: string | null) => (v === null || v === undefined ? null : v), // mantém string
}
export const MoneyColumn = () =>
  Column({ type: 'decimal', precision: 12, scale: 2, transformer: DecimalTransformer })
```

Somas e margens são calculadas **em SQL** (`SUM`, `numeric`) ou com `Decimal.js`
no Node — nunca com `number` do JavaScript.

### Entidades

```ts
export enum TenantType   { INDIVIDUAL = 'INDIVIDUAL', COMPANY = 'COMPANY' }
export enum TenantStatus { TRIAL='TRIAL', ACTIVE='ACTIVE', PAST_DUE='PAST_DUE', SUSPENDED='SUSPENDED', CANCELED='CANCELED' }
export enum UserRole     { SUPER_ADMIN='SUPER_ADMIN', OWNER='OWNER', ADMIN='ADMIN', MANAGER='MANAGER', COORDINATOR='COORDINATOR', FINANCE='FINANCE', CAREGIVER='CAREGIVER' }
export enum ShiftStatus  { PLANNED='PLANNED', CONFIRMED='CONFIRMED', IN_PROGRESS='IN_PROGRESS', COMPLETED='COMPLETED', CANCELED='CANCELED', NO_SHOW='NO_SHOW' }
export enum ReceivableStatus { FORECAST='FORECAST', PENDING='PENDING', PAID='PAID', OVERDUE='OVERDUE', CANCELED='CANCELED' }
export enum PayableStatus    { PENDING='PENDING', PAID='PAID', OVERDUE='OVERDUE', CANCELED='CANCELED' }
export enum SubStatus        { TRIAL='TRIAL', ACTIVE='ACTIVE', PAST_DUE='PAST_DUE', SUSPENDED='SUSPENDED', CANCELED='CANCELED' }

@Entity('tenants')                       // sem tenantId: é a raiz
export class Tenant extends BaseEntity {
  @Column() name: string
  @Column({ type: 'enum', enum: TenantType }) type: TenantType
  @Column({ nullable: true }) document?: string          // CPF ou CNPJ
  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.TRIAL }) status: TenantStatus
  @Column({ type: 'datetime', precision: 6, nullable: true }) trialEndsAt?: Date
  @Column({ default: 'America/Sao_Paulo' }) timezone: string

  @OneToMany(() => User, u => u.tenant) users: User[]
  @OneToOne(() => Subscription, s => s.tenant) subscription?: Subscription
}

@Entity('users')
@Index(['tenantId', 'email'], { unique: true, where: '"deleted_at" IS NULL' })
export class User extends TenantBaseEntity {
  @Column() name: string
  @Column() email: string
  @Column({ select: false }) passwordHash: string        // nunca vem por padrão
  @Column({ type: 'enum', enum: UserRole }) role: UserRole
  @Column({ type: 'varchar', length: 36, nullable: true }) caregiverId?: string
  @Column({ default: true }) isActive: boolean
  @Column({ type: 'datetime', precision: 6, nullable: true }) lastLoginAt?: Date
}

@Entity('customers')
@Index(['tenantId', 'cpf'], { unique: true, where: '"cpf" IS NOT NULL AND "deleted_at" IS NULL' })
@Index(['tenantId', 'name'])
export class Customer extends TenantBaseEntity {
  @Column() name: string
  @Column({ nullable: true }) cpf?: string
  @Column({ type: 'date', nullable: true }) birthDate?: string
  @Column({ nullable: true }) phone?: string
  @Column({ nullable: true }) email?: string
  @Column({ type: 'json', nullable: true }) address?: Address
  @Column({ type: 'text', nullable: true }) notes?: string
  @Column({ default: true }) isActive: boolean

  @OneToMany(() => CustomerResponsible, r => r.customer, { cascade: ['insert','update'] })
  responsibles: CustomerResponsible[]
}

@Entity('customer_responsibles')
@Index(['tenantId', 'customerId'])
export class CustomerResponsible extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 }) customerId: string
  @ManyToOne(() => Customer, c => c.responsibles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' }) customer: Customer

  @Column() name: string
  @Column({ nullable: true }) relationship?: string
  @Column({ nullable: true }) phone?: string
  @Column({ nullable: true }) email?: string
  @Column({ default: false }) isPrimary: boolean
  @Column({ default: false }) isFinancial: boolean
  @Column({ default: false }) isEmergency: boolean
}

@Entity('caregivers')
@Index(['tenantId', 'cpf'], { unique: true, where: '"cpf" IS NOT NULL AND "deleted_at" IS NULL' })
export class Caregiver extends TenantBaseEntity {
  @Column() name: string
  @Column({ nullable: true }) cpf?: string
  @Column({ nullable: true }) phone?: string
  @Column({ nullable: true }) email?: string
  @Column({ type: 'date', nullable: true }) birthDate?: string
  @Column({ nullable: true }) contractType?: string      // CLT, PJ, autônomo, diarista
  @MoneyColumn() @Column({ nullable: true }) hourlyRate?: string
  @MoneyColumn() @Column({ nullable: true }) shiftRate?: string
  @Column({ default: false }) isOwner: boolean           // conta individual
  @Column({ default: true }) isActive: boolean

  @OneToMany(() => CaregiverAvailability, a => a.caregiver) availabilities: CaregiverAvailability[]
  @OneToMany(() => CaregiverDocument, d => d.caregiver) documents: CaregiverDocument[]
}

@Entity('caregiver_availabilities')
@Index(['tenantId', 'caregiverId'])
export class CaregiverAvailability extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 }) caregiverId: string
  @ManyToOne(() => Caregiver, c => c.availabilities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caregiver_id' }) caregiver: Caregiver

  @Column({ type: 'smallint', nullable: true }) weekday?: number   // 0-6 recorrente
  @Column({ type: 'time', nullable: true }) startTime?: string     // "07:00"
  @Column({ type: 'time', nullable: true }) endTime?: string       // "19:00"
  @Column({ type: 'datetime', precision: 6, nullable: true }) blockedFrom?: Date   // indisponibilidade pontual
  @Column({ type: 'datetime', precision: 6, nullable: true }) blockedTo?: Date
  @Column({ nullable: true }) reason?: string
}

@Entity('services')
@Index(['tenantId', 'code'], { unique: true, where: '"code" IS NOT NULL AND "deleted_at" IS NULL' })
export class Service extends TenantBaseEntity {
  @Column() name: string
  @Column({ nullable: true }) code?: string
  @Column({ default: 'PLANTAO' }) unit: string           // PLANTAO | HORA | DIA
  @MoneyColumn() salePrice: string
  @MoneyColumn() @Column({ nullable: true }) caregiverCost?: string
  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true }) hours?: string
  @Column({ default: true }) isActive: boolean
}

@Entity('contracts')
@Index(['tenantId', 'number'], { unique: true, where: '"deleted_at" IS NULL' })
export class Contract extends TenantBaseEntity {
  @Column() number: string
  @Column({ type: 'varchar', length: 36 }) customerId: string
  @Column({ type: 'varchar', length: 36, nullable: true }) serviceId?: string
  @Column({ type: 'date' }) startDate: string
  @Column({ type: 'date', nullable: true }) endDate?: string
  @MoneyColumn() amount: string
  @Column() frequency: string                            // MONTHLY | WEEKLY | ONE_OFF
  @Column({ nullable: true }) paymentMethod?: string
  @Column({ type: 'smallint', nullable: true }) billingDay?: number
  @Column({ default: 'ACTIVE' }) status: string
}

@Entity('shifts')
@Index(['tenantId', 'startsAt'])
@Index(['tenantId', 'caregiverId', 'startsAt'])
@Index(['tenantId', 'customerId', 'startsAt'])
export class Shift extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 }) customerId: string
  @ManyToOne(() => Customer) @JoinColumn({ name: 'customer_id' }) customer: Customer

  @Column({ type: 'varchar', length: 36, nullable: true }) caregiverId?: string
  @ManyToOne(() => Caregiver) @JoinColumn({ name: 'caregiver_id' }) caregiver?: Caregiver

  @Column({ type: 'varchar', length: 36, nullable: true }) serviceId?: string
  @Column({ type: 'varchar', length: 36, nullable: true }) contractId?: string

  @Column({ type: 'datetime', precision: 6 }) startsAt: Date        // sempre UTC no banco
  @Column({ type: 'datetime', precision: 6 }) endsAt: Date

  @MoneyColumn() chargeAmount: string                    // cobrado do cliente
  @MoneyColumn() caregiverCost: string                   // pago ao cuidador
  @MoneyColumn() @Column({ default: 0 }) otherCosts: string

  @Column({ type: 'enum', enum: ShiftStatus, default: ShiftStatus.PLANNED }) status: ShiftStatus
  @Column({ type: 'datetime', precision: 6, nullable: true }) checkInAt?: Date
  @Column({ type: 'datetime', precision: 6, nullable: true }) checkOutAt?: Date
  @Column({ type: 'text', nullable: true }) notes?: string
}

@Entity('account_receivables')
@Index(['tenantId', 'dueDate', 'status'])
export class AccountReceivable extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36 }) customerId: string
  @Column({ type: 'varchar', length: 36, nullable: true }) shiftId?: string
  @Column({ type: 'varchar', length: 36, nullable: true }) contractId?: string
  @Column({ length: 7 }) competence: string              // "2026-08"
  @MoneyColumn() amount: string
  @Column({ type: 'date' }) dueDate: string
  @Column({ type: 'datetime', precision: 6, nullable: true }) paidAt?: Date
  @MoneyColumn() @Column({ nullable: true }) paidAmount?: string
  @Column({ type: 'enum', enum: ReceivableStatus, default: ReceivableStatus.FORECAST }) status: ReceivableStatus
  @Column({ nullable: true }) externalRef?: string       // id do pagamento no MP (Fluxo B)
}

@Entity('account_payables')
@Index(['tenantId', 'dueDate', 'status'])
export class AccountPayable extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 36, nullable: true }) caregiverId?: string
  @Column({ nullable: true }) supplier?: string
  @Column() category: string
  @Column({ type: 'varchar', length: 36, nullable: true }) shiftId?: string
  @Column({ nullable: true }) description?: string
  @MoneyColumn() amount: string
  @Column({ type: 'date' }) dueDate: string
  @Column({ type: 'datetime', precision: 6, nullable: true }) paidAt?: Date
  @Column({ type: 'enum', enum: PayableStatus, default: PayableStatus.PENDING }) status: PayableStatus
}
```

### Billing do SaaS (tabelas globais, **sem** `tenantId` e **sem** RLS)

```ts
@Entity('plans')
export class Plan extends BaseEntity {
  @Column({ unique: true }) code: string                 // individual_free, company_start...
  @Column() name: string
  @Column({ type: 'enum', enum: TenantType }) tenantType: TenantType
  @Column({ type: 'int' }) priceCents: number
  @Column({ default: 'months' }) interval: string
  @Column({ type: 'int', default: 1 }) intervalCount: number
  @Column({ type: 'int', default: 14 }) trialDays: number
  @Column({ type: 'int', nullable: true }) maxCustomers?: number      // null = ilimitado
  @Column({ type: 'int', nullable: true }) maxCaregivers?: number
  @Column({ type: 'int', nullable: true }) maxShiftsPerMonth?: number
  @Column({ type: 'json', default: {} }) features: Record<string, unknown>
  @Column({ nullable: true }) mpPreapprovalPlanId?: string            // plano no Mercado Pago
  @Column({ default: true }) isActive: boolean
}

@Entity('subscriptions')
export class Subscription extends BaseEntity {
  @Column({ type: 'varchar', length: 36, unique: true }) tenantId: string
  @OneToOne(() => Tenant, t => t.subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' }) tenant: Tenant

  @Column({ type: 'varchar', length: 36 }) planId: string
  @ManyToOne(() => Plan) @JoinColumn({ name: 'plan_id' }) plan: Plan

  @Column({ type: 'enum', enum: SubStatus, default: SubStatus.TRIAL }) status: SubStatus
  @Column({ default: 'mercadopago' }) provider: string
  @Column({ unique: true, nullable: true }) mpPreapprovalId?: string
  @Column({ nullable: true }) mpPayerId?: string
  @Column({ type: 'datetime', precision: 6, nullable: true }) currentPeriodEnd?: Date
  @Column({ type: 'datetime', precision: 6, nullable: true }) nextChargeAt?: Date
  @Column({ type: 'datetime', precision: 6, nullable: true }) canceledAt?: Date
  @Column({ type: 'datetime', precision: 6, nullable: true }) graceUntil?: Date   // tolerância antes de suspender

  @OneToMany(() => SubscriptionPayment, p => p.subscription) payments: SubscriptionPayment[]
}

@Entity('subscription_payments')
@Index(['subscriptionId'])
export class SubscriptionPayment extends BaseEntity {
  @Column({ type: 'varchar', length: 36 }) subscriptionId: string
  @ManyToOne(() => Subscription, s => s.payments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' }) subscription: Subscription

  @Column({ unique: true }) mpPaymentId: string
  @Column({ type: 'int' }) amountCents: number
  @Column() status: string                               // approved, rejected, refunded...
  @Column({ type: 'datetime', precision: 6, nullable: true }) paidAt?: Date
  @Column({ type: 'json' }) raw: Record<string, unknown>
}

@Entity('webhook_events')
@Index(['provider', 'eventId', 'type'], { unique: true })   // idempotência
export class WebhookEvent extends BaseEntity {
  @Column() provider: string
  @Column() eventId: string
  @Column() type: string
  @Column({ type: 'json' }) payload: Record<string, unknown>
  @Column({ default: false }) signatureOk: boolean
  @Column({ type: 'datetime', precision: 6, nullable: true }) processedAt?: Date
  @Column({ type: 'text', nullable: true }) error?: string
}

@Entity('audit_logs')
@Index(['tenantId', 'createdAt'])
export class AuditLog extends BaseEntity {
  @Column({ type: 'varchar', length: 36, nullable: true }) tenantId?: string
  @Column({ type: 'varchar', length: 36, nullable: true }) userId?: string
  @Column() action: string                               // shift.update, receivable.pay...
  @Column() entity: string
  @Column({ type: 'varchar', length: 36 }) entityId: string
  @Column({ type: 'json', nullable: true }) before?: Record<string, unknown>
  @Column({ type: 'json', nullable: true }) after?: Record<string, unknown>
  @Column({ nullable: true }) ip?: string
}
```

Já implementadas depois deste documento, com a mesma base e as mesmas travas:
`CaregiverDocument`, `Occurrence`, `ShiftSubstitution`, `Contract`, `Invitation`,
`AccountReceivable`, `AccountPayable`, `CaregiverAvailability`, `RefreshToken`.
A escala não virou entidade: a grade é uma consulta sobre `shifts`, e materializá-la
criaria um segundo lugar para a mesma verdade ficar desatualizada.

Faltam: `Notification`, `Revenue`/`Expense` avulsos fora do fluxo de plantão.

### Regras de dados inegociáveis

- **Dinheiro é `decimal(12,2)`**, lido como string, somado em SQL ou `Decimal.js`.
  `float` em financeiro é bug garantido.
- **Datas em `datetime(6)` guardando UTC** (conexão com `timezone: 'Z'`); conversão para `America/Sao_Paulo` só na
  borda. Plantão 19h→07h atravessa o dia: por isso `startsAt`/`endsAt` são
  timestamps completos, e não data + hora soltas.
- **Soft delete** (`@DeleteDateColumn`) em tudo que tem histórico financeiro.
  Nunca `DELETE` físico em plantão pago. Lembrete: índices únicos precisam do
  a coluna gerada `deleted_marker` na chave, senão um registro apagado bloqueia
  o cadastro de um novo com o mesmo documento.

---

## 6. Regra central: plantão gera financeiro

Requisito §9 do planejamento de produto. Como o request inteiro já roda dentro de
uma transação (seção 4), o service usa o `manager` do contexto:

```ts
// shifts.service.ts
async complete(shiftId: string) {
  const manager = RequestContext.get().manager      // mesma transação do request

  const shift = await this.shifts.findOne({ where: { id: shiftId } })
  if (!shift) throw new NotFoundException()

  shift.status = ShiftStatus.COMPLETED
  await manager.save(shift)

  await manager.upsert(AccountReceivable, {
    tenantId: shift.tenantId,
    customerId: shift.customerId,
    shiftId: shift.id,
    amount: shift.chargeAmount,
    competence: toCompetence(shift.startsAt),
    dueDate: this.dueDateFor(shift),
    status: ReceivableStatus.PENDING,
  }, { conflictPaths: ['shiftId'], skipUpdateIfNoValuesChanged: true })

  // conta individual: o dono é o próprio cuidador — não gera despesa com ele mesmo
  if (shift.caregiverId && !(await this.isOwner(shift.caregiverId))) {
    await manager.upsert(AccountPayable, { /* caregiverCost */ },
      { conflictPaths: ['shiftId'] })
  }

  await this.audit('shift.complete', shift)
  return shift
}
```

Margem **não** é coluna: é derivada
(`chargeAmount - caregiverCost - otherCosts`) e calculada em query. Coluna
calculada armazenada é fonte garantida de inconsistência quando alguém edita o
valor depois.

Relatório de rentabilidade (§10) com QueryBuilder:

```ts
this.shifts.qb('s')
  .select('s.customer_id', 'customerId')
  .addSelect('SUM(s.charge_amount)', 'revenue')
  .addSelect('SUM(s.caregiver_cost + s.other_costs)', 'cost')
  .addSelect('SUM(s.charge_amount - s.caregiver_cost - s.other_costs)', 'result')
  .andWhere('s.status = :st', { st: ShiftStatus.COMPLETED })
  .andWhere('s.starts_at BETWEEN :from AND :to', { from, to })
  .groupBy('s.customer_id')
  .getRawMany()
```

---

## 7. Autenticação e permissões

### Fluxo de sessão

```text
POST /auth/register  → cria Tenant + User(OWNER) + Subscription(TRIAL) + Caregiver(isOwner)
POST /auth/login     → access token (JWT, 15 min, no corpo)
                     + refresh token (cookie httpOnly, Secure, SameSite=None, 30 dias)
POST /auth/refresh   → rotaciona o refresh (reuso detectado = roubo → revoga a família)
POST /auth/logout    → revoga o refresh
```

Cookie com `SameSite=None; Secure; Domain=.mnvma.com.br`, porque painel (`app.`)
e API (`api.`) são hosts diferentes. Por isso o CORS precisa de
`credentials: true` e origem explícita — nunca `*`.

Payload do access token:

```json
{ "sub": "user-uuid", "tid": "tenant-uuid", "role": "OWNER",
  "tt": "COMPANY", "cgid": "caregiver-uuid", "exp": 1234567890 }
```

O `tid` do token é o que alimenta `@mnvma_tenant_id` no MySQL. O frontend
**nunca** envia `tenantId` — se enviasse, seria só trocar o valor para ler dados
alheios.

### RBAC

Papéis do §12 traduzidos em permissões granulares (`customers:read`,
`finance:write`, `caregivers:manage`, ...):

```ts
@RequirePermission('finance:write')
@Post('receivables/:id/pay')
pay(@Param('id') id: string) { ... }
```

O papel `CAREGIVER` recebe um guard extra: só enxerga registros onde
`caregiverId === token.cgid`. Isso é o Portal do Cuidador (§13) sem app separado.

### Limite de plano

```ts
@RequirePlanLimit('customers')
@Post('customers')
create() { ... }
// 402 Payment Required + { limit, current, upgradeUrl } quando estourar
```

O frontend usa esse 402 para abrir o modal de upgrade.

---

## 8. Contrato da API

Padrões fixos:

- Base: `https://api.mnvma.com.br/v1`
- Lista: `GET /v1/customers?page=1&perPage=25&q=maria&status=active&sort=-createdAt`
- Resposta de lista: `{ "data": [...], "meta": { "page", "perPage", "total", "totalPages" } }`
- Erro: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": { "cpf": "CPF inválido" } } }`
- Datas em ISO 8601 com offset: `2026-08-25T07:00:00-03:00`
- Dinheiro como string: `"300.00"`
- `Idempotency-Key` obrigatório em `POST` financeiro e de billing

### Endpoints principais

```text
AUTH
POST   /v1/auth/register
POST   /v1/auth/login
POST   /v1/auth/refresh
POST   /v1/auth/logout
POST   /v1/auth/forgot-password        { email } → 204 SEMPRE (não revela se a conta existe)
GET    /v1/auth/reset-password/:token   (público — prévia com e-mail mascarado)
POST   /v1/auth/reset-password         { token, password } → revoga TODAS as sessões
POST   /v1/auth/change-password        { currentPassword, password } → renova só a sessão atual
GET    /v1/auth/me                     → user + tenant + plano + limites + permissões

OPERAÇÃO
GET    /v1/customers
POST   /v1/customers
GET    /v1/customers/:id
PATCH  /v1/customers/:id
DELETE /v1/customers/:id
GET    /v1/customers/:id/responsibles
POST   /v1/customers/:id/responsibles

GET    /v1/caregivers                  (empresa)
POST   /v1/caregivers
GET    /v1/caregivers/:id/availability
PUT    /v1/caregivers/:id/availability
POST   /v1/caregivers/:id/blocks       (indisponibilidade temporária)
GET    /v1/caregivers/:id/documents
POST   /v1/caregivers/:id/documents
GET    /v1/documents?caregiverId=&type=&status=
GET    /v1/documents/expiring?days=30  (inclui o que já venceu — é o mais urgente)
PATCH  /v1/documents/:id
DELETE /v1/documents/:id

GET    /v1/services
POST   /v1/services

GET    /v1/shifts?from=&to=&caregiverId=&customerId=&status=
POST   /v1/shifts
POST   /v1/shifts/bulk                 (gerar escala recorrente)
PATCH  /v1/shifts/:id
POST   /v1/shifts/:id/status           { status }
POST   /v1/shifts/:id/check-in
POST   /v1/shifts/:id/check-out
POST   /v1/shifts/:id/substitute       { caregiverId, reason }
GET    /v1/shifts/:id/substitutions    (histórico de trocas do plantão)
GET    /v1/shifts/:id/candidates       (cuidadores disponíveis)

GET    /v1/schedules?from=&to=         (grade: uma linha por cuidador + "sem cuidador")
POST   /v1/schedules/copy-week         { sourceWeekStart, targetWeekStart }

GET    /v1/contracts
POST   /v1/contracts
GET    /v1/contracts/:id
PATCH  /v1/contracts/:id
POST   /v1/contracts/:id/status        { status, reason }
GET    /v1/contracts/:id/billings      (o que já foi cobrado deste contrato)
POST   /v1/contracts/generate-billing  { competence, dryRun } → rodada do mês
POST   /v1/contracts/:id/generate-billing
DELETE /v1/contracts/:id

GET    /v1/occurrences?from=&to=&severity=&customerId=&caregiverId=
POST   /v1/occurrences
GET    /v1/occurrences/open-critical   (o que a coordenação precisa ver hoje)
PATCH  /v1/occurrences/:id
POST   /v1/occurrences/:id/resolve     { resolution }
POST   /v1/occurrences/:id/reopen

EQUIPE E CONVITES
GET    /v1/users?role=&status=
GET    /v1/users/:id
PATCH  /v1/users/:id                   { name, role, caregiverId, isActive }
DELETE /v1/users/:id
GET    /v1/users/invites?situation=pending
POST   /v1/users/invites               { email, name, role, caregiverId }
                                       → devolve o link UMA vez; o banco só tem o hash
POST   /v1/users/invites/:id/resend    (gera token novo e mata o anterior)
DELETE /v1/users/invites/:id           (cancela)

GET    /v1/invites/:token              (público — prévia antes de pedir a senha)
POST   /v1/invites/accept              { token, password, name } → sessão pronta

FINANCEIRO
GET    /v1/finance/receivables?status=&from=&to=
POST   /v1/finance/receivables
POST   /v1/finance/receivables/:id/pay
GET    /v1/finance/payables
POST   /v1/finance/payables/:id/pay
GET    /v1/finance/cashflow?from=&to=&groupBy=day|week|month
GET    /v1/finance/summary?period=month

DASHBOARD E RELATÓRIOS
GET    /v1/dashboard                   (responde conforme tenant.type)
GET    /v1/reports/shifts?from=&to=
GET    /v1/reports/hours
GET    /v1/reports/profitability?by=customer|service|caregiver|contract
GET    /v1/reports/:name/export?format=csv|pdf

BILLING  (ver 03-mercado-pago.md)
GET    /v1/billing/plans
GET    /v1/billing/subscription
POST   /v1/billing/subscribe           { planId } → { checkoutUrl }
POST   /v1/billing/change-plan
POST   /v1/billing/cancel
GET    /v1/billing/payments

WEBHOOKS (público, sem JWT, sem contexto de tenant)
POST   /v1/webhooks/mercadopago

SUPER ADMIN (MNVMA Core — via SystemScope)
GET    /v1/admin/metrics               (MRR, churn, trials, inadimplentes)
GET    /v1/admin/tenants
GET    /v1/admin/tenants/:id
POST   /v1/admin/tenants/:id/suspend
POST   /v1/admin/tenants/:id/reactivate
POST   /v1/admin/tenants/:id/impersonate
GET    /v1/admin/plans
PUT    /v1/admin/plans/:id             (limites configuráveis — §19)
```

> `GET /invites/:token` e `POST /invites/accept` são públicas: quem aceita ainda
> não tem sessão, e o tenant vem do próprio convite, via `SystemScope`. As duas
> devolvem **404 igual** para token inexistente, expirado, cancelado ou já
> aceito — distinguir os casos entregaria de graça a informação de que aquele
> link um dia existiu.
>
> Rotas `/webhooks/*` e `/admin/*` **não** passam pelo `TenantContextInterceptor`:
> a primeira não tem tenant no momento da chamada (descobre pelo
> `external_reference`), a segunda precisa cruzar tenants. Ambas usam
> `SystemScope`.

---

## 9. Jobs agendados

Cron em processo (`@nestjs/schedule`), **não** fila com Redis. A fila entra
quando existir trabalho que precise de retentativa individual e paralelismo —
cobrança do Mercado Pago, no Sprint 7. Para "varra as contas uma vez por dia",
Redis seria mais infraestrutura para pagar, monitorar e restaurar sem nada em
troca.

`JOBS_ENABLED=false` desliga tudo, para o dia em que os jobs tiverem um worker
próprio.

### O que já roda

| Job | Frequência | O que faz |
|---|---|---|
| `trial.varredura` | Diário 09h | Trial vencido → `EXPIRED` (+ assinatura `SUSPENDED`); avisa em 3 dias e em 1 dia |
| `documentos.vencendo` | Diário 08h | Digest do que vence em ≤ `DOCUMENT_ALERT_DAYS` e do que já venceu |
| `seguranca.limpeza` | Diário 03h | Apaga refresh token e link de senha mortos há 30 dias; `job_runs` com mais de 90 |

Rodar na mão: `npm run job -- trial | documentos | limpeza`. A trava continua
valendo — não repete o efeito nem manda o e-mail duas vezes.

### Ainda no roadmap

| Job | Frequência | O que faz |
|---|---|---|
| `billing:sync-subscriptions` | 1×/h | Reconcilia com o Mercado Pago (rede de segurança do webhook) |
| `billing:dunning` | Diário 10h | `PAST_DUE` → lembretes → suspensão após a carência |
| `finance:mark-overdue` | Diário 00h05 | A receber/a pagar vencidos viram `OVERDUE` |
| `contracts:generate-billing` | Diário 01h | Gera contas a receber dos contratos recorrentes |
| `shifts:uncovered-alert` | 3×/dia | Alerta plantão sem cuidador nas próximas 48h |
| `shifts:reminder` | Horário | Push/e-mail de plantão próximo |
| `webhooks:retry` | 5 min | Reprocessa `WebhookEvent` com erro |

### A trava

Jobs rodam **fora** do request, então não têm `@mnvma_tenant_id` definida. Cada
processador usa `SystemScope.runAsTenant(tenantId, ...)` para a conta que está
processando, ou `SystemScope.run(...)` quando precisa varrer todas.

Contra duplicação entre instâncias existe a tabela `job_runs`, com chave única
`(job, run_key)` — `run_key` é a janela (`2026-08-26` para diário). Quem
consegue inserir, roda; quem colide, sai de lado. É trava de banco de propósito:
booleano em memória resolve dentro de um processo e não resolve nada entre dois
contêineres. Execução que fica `RUNNING` por mais de uma hora é considerada
processo morto e pode ser retomada, senão um `kill -9` desligaria o job até
alguém apagar a linha na mão.

Tudo com timezone `America/Sao_Paulo`.

---

## 9.1 E-mail

Uma porta de saída só (`MailService`) com transporte trocado por `MAIL_PROVIDER`:

| Provider | Quando | O que faz |
|---|---|---|
| `log` (padrão) | Dev e teste | Escreve destinatário, assunto e **os links** no terminal. Nada sai da máquina — dá para aceitar convite e redefinir senha sem conta em provedor nenhum. |
| `resend` | Produção | POST na API HTTP do Resend. Sem SDK: é um JSON, e o `fetch` do Node 20 dá conta. |

Duas garantias das quais o resto da aplicação depende:

1. **Não lança.** E-mail é efeito colateral. Convite gravado com sucesso não
   pode virar 500 porque o provedor piscou — quem chama recebe
   `delivered: false` e decide. O convite, por exemplo, devolve `inviteUrl` para
   mandar por WhatsApp, e a tela muda de tom quando o envio falha.
2. **Não bloqueia para sempre.** Timeout de 10 s no transporte.

Todo template tem versão em `text` além do `html`: cliente antigo, leitor de
tela e filtro de spam leem o texto, e convite que chega em branco é usuário que
nunca entra. Tudo em CSS inline e tabela — Gmail e Outlook descartam `<style>`
de cabeçalho — e sem imagem externa, que vem bloqueada por padrão.

Em produção com `MAIL_PROVIDER=log` a API sobe assim mesmo e grita no log: a
conta ainda funciona (o convite mostra o link na tela), mas redefinição de senha
depende do envio.

---

## 10. Segurança

- Senha com **Argon2id**; nunca bcrypt novo, nunca MD5/SHA.
- Rate limit: `10/min` no login por IP+e-mail, `120/min` geral por token.
- CORS com allowlist explícita (`app.`, `staging.`, `localhost:5173`).
- Helmet, `trust proxy` correto atrás do load balancer.
- Usuário do banco com o mínimo necessário: sem `SUPER`, sem `FILE`, sem
  `PROCESS`. O módulo `admin` (Super Admin) usa credencial própria.
- Uploads: URL assinada com expiração de 5 min, `Content-Type` conferido **pelos
  bytes** e tamanho validado, chave montada pelo servidor sempre começando pelo
  tenant, download também por URL assinada e sempre como `attachment`.
  Guardando no próprio servidor (`STORAGE_DRIVER=local`), o diretório fica
  **fora da raiz servida** e nenhuma rota estática o expõe: o único caminho até
  o byte é o link assinado. Com `s3`, o bucket é **privado**.
- LGPD (o sistema guarda dado de saúde indireto):
  - `AuditLog` de leitura em entidades sensíveis
  - `GET /v1/tenants/me/export` — exportação completa em JSON/CSV
  - `DELETE /v1/tenants/me` — anonimização em 30 dias, com retenção fiscal
  - Retenção de log: 12 meses
- Segredos só em variáveis de ambiente do provedor; `.env` nunca versionado.
- Dependabot + `npm audit` no CI.

---

## 11. Variáveis de ambiente

```bash
# .env.example — mnvma-api
NODE_ENV=production
PORT=3000
APP_URL=https://app.mnvma.com.br
API_URL=https://api.mnvma.com.br

DATABASE_URL=mysql://sa:masterkey@localhost:3306/cuidador
DATABASE_SSL=false
REDIS_URL=redis://default:pass@host:6379

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
COOKIE_DOMAIN=.mnvma.com.br

CORS_ORIGINS=https://app.mnvma.com.br,https://staging.mnvma.com.br

# Mercado Pago (ver 03)
MP_ACCESS_TOKEN=
MP_PUBLIC_KEY=
MP_WEBHOOK_SECRET=
MP_BACK_URL=https://app.mnvma.com.br/billing/retorno
MP_NOTIFICATION_URL=https://api.mnvma.com.br/v1/webhooks/mercadopago

# Arquivos — hoje no volume do próprio servidor. Caminho ABSOLUTO fora de
# desenvolvimento, senão a API não sobe; e o backup tem que cobrir este diretório.
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=/data/uploads
STORAGE_URL_TTL=300
# Trocar para `s3` no dia em que o volume apertar — nenhum módulo muda.
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=mnvma-documents
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

SMTP_URL=
MAIL_FROM="MNVMA <nao-responda@mnvma.com.br>"

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
SENTRY_DSN=
```

---

## 12. Deploy

**Railway** (recomendado para começar): MySQL, Redis e API no mesmo projeto,
rede interna, deploy por push, custo baixo. Render e Fly.io servem igualmente.

```dockerfile
# Dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["sh","-c","npx typeorm -d dist/data-source.js migration:run && node dist/main.js"]
```

```json
// package.json (scripts de migration)
{
  "typeorm": "typeorm-ts-node-commonjs -d src/data-source.ts",
  "migration:generate": "npm run typeorm -- migration:generate",
  "migration:run": "typeorm -d dist/data-source.js migration:run",
  "migration:revert": "typeorm -d dist/data-source.js migration:revert"
}
```

Pipeline (GitHub Actions): `lint → test → build → checa migration pendente →
deploy`. `migration:run` no start; `synchronize` jamais.

Operação:
- Health check `GET /health` (banco + redis)
- Sentry para erros, log estruturado com `request-id`
- Backup diário do MySQL com **restore testado** (backup não testado não é
  backup)

---

## 13. Testes

| Tipo | Alvo | Ferramenta |
|---|---|---|
| Unitário | Cálculo de margem, geração de recorrência, dunning | Jest |
| Integração | Endpoints com MySQL de teste | Supertest + Testcontainers |
| **Isolamento de tenant** | Tenant B acessa dado do tenant A → 404; e INSERT direto com tenant_id alheio é barrado pelo trigger | Suíte dedicada, obrigatória em todo endpoint |
| Migrations | `migration:run` + `migration:revert` do zero em CI | Testcontainers |
| Webhook | Assinatura válida, inválida, duplicada, fora de ordem | Payloads fixos gravados |

A suíte de isolamento roda em todo PR e bloqueia merge. Sem Row Level Security,
ela é a única prova automática de que a Camada 1 está sendo respeitada — se
alguém injetar `Repository<T>` cru num service novo, é aqui que aparece.

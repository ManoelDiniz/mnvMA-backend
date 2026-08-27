# MNVMA API

Backend do **MNVMA Care** — SaaS de gestão para cuidadores independentes e
empresas de cuidadores.

NestJS · TypeORM · MySQL 8 · JWT · multi-tenant

> Planejamento completo em [`docs/mnvma/`](./docs/mnvma/) — os documentos da
> plataforma inteira moram aqui, inclusive os que descrevem o painel.
> O frontend é um projeto separado: [`mnvMA-Frontend`](https://github.com/ManoelDiniz/mnvMA-Frontend).

---

## Como rodar

### 1. Banco

Já existe um MySQL em `localhost`? Use o seu. Senão, suba o do compose:

```bash
docker compose up -d mysql
```

Crie o banco (se ainda não existir):

```sql
CREATE DATABASE cuidador
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
```

### 2. Variáveis

```bash
cp .env.example .env
```

Confira a `DATABASE_URL` — o padrão é o que combinamos:

```
mysql://sa:masterkey@localhost:3306/cuidador
```

Gere segredos de verdade para o JWT:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 3. Subir

```bash
npm install
npm run migration:run     # cria o schema e os triggers de tenant
npm run seed              # popula o catálogo de planos
npm run start:dev
```

- API: <http://localhost:3000/v1>
- Swagger: <http://localhost:3000/docs>
- Health: <http://localhost:3000/v1/health>

### 4. Primeiro cadastro

```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"João","email":"joao@teste.com","password":"senha12345","accountType":"INDIVIDUAL"}'
```

---

## Multi-tenant: como o isolamento funciona aqui

Cada conta (cuidador ou empresa) é um `tenant`. Toda tabela de negócio tem
`tenant_id`, e **nenhum service pode escrever `where tenant_id` na mão** — isso
é responsabilidade de três camadas:

| Camada | O que protege | Onde |
|---|---|---|
| `TenantScopedRepository` | Leitura e escrita, sempre filtradas | `src/common/database/` |
| Triggers do MySQL | Escrita, no nível do banco | migration inicial |
| Suíte de isolamento | Prova que as duas acima funcionam | `test/tenant-isolation.e2e-spec.ts` |

### Por que não é Row Level Security

O plano original usava PostgreSQL, onde o próprio banco recusa a linha de outro
tenant. **O MySQL não tem RLS**, então o isolamento de *leitura* passou a
depender da aplicação. Para compensar:

- A leitura só acontece via `TenantScopedRepository`, que injeta o filtro
  automaticamente e estoura se não houver contexto de tenant. Injetar
  `Repository<T>` cru num service é proibido por convenção — e a suíte de
  isolamento pega quem esquecer.
- A escrita é conferida pelo banco: `@mnvma_tenant_id` é definida no início da
  transação de cada requisição e comparada por triggers `BEFORE INSERT/UPDATE`
  em toda tabela com `tenant_id`. Gravar linha de outra conta aborta com
  SQLSTATE 45000.
- O `SystemScope` é o único caminho para operações cross-tenant (login,
  webhook, jobs, Super Admin). Ele liga `@mnvma_system_scope` e registra o
  motivo no log.

Se um dia isso não bastar (auditoria, cliente exigindo garantia formal), o
caminho de reforço no MySQL é servir cada tabela por uma VIEW filtrada com
`WITH CHECK OPTION` e dar ao usuário da aplicação acesso só às views.

---

## Estrutura

```text
src/
├── common/            # base compartilhada
│   ├── context/       # RequestContext (AsyncLocalStorage)
│   ├── database/      # TenantScopedRepository, SystemScope, dinheiro
│   ├── decorators/    # @Public @RequirePermission @CurrentUser
│   ├── entities/      # BaseEntity, TenantBaseEntity
│   ├── enums/         # papéis, tipo e status de conta
│   ├── filters/       # formato único de erro
│   ├── guards/        # JWT, permissões, status da conta
│   ├── interceptors/  # transação + tenant por requisição
│   ├── permissions/   # papel → permissões, módulos por tipo de conta
│   └── utils/         # CPF/CNPJ
├── config/            # env validado com Zod (falha no boot se faltar algo)
├── database/
│   ├── migrations/    # fonte da verdade do schema
│   └── seeds/
└── modules/
    ├── auth/          # registro, login, refresh rotativo, senha, /me
    ├── billing/       # planos e assinaturas (Mercado Pago — Sprint 7)
    ├── caregivers/    # equipe, valores, disponibilidade
    ├── customers/     # CRUD de referência: copie o padrão daqui
    ├── finance/       # a receber, a pagar, fluxo de caixa
    │   └── shift-billing.service.ts   ← a regra central (§9)
    ├── health/
    ├── jobs/          # cron + trava distribuída em `job_runs`
    ├── mail/          # transporte trocável (log | Resend) e templates
    ├── reports/       # rentabilidade e operação
    ├── services/      # catálogo, com margem derivada
    ├── shifts/        # plantões, máquina de estados, escala em lote
    ├── tenants/
    └── users/
```

---

## Convenções que não são negociáveis

1. **`synchronize` nunca.** Schema muda por migration, revisada à mão.
   `migration:generate` serve de rascunho, não de verdade.
2. **Dinheiro é `decimal(12,2)`** e trafega como string. `float` em financeiro
   perde centavos — use `sumMoney`/`toCents` de `common/database`.
3. **Datas em UTC** (`datetime(6)`, conexão com `timezone: 'Z'`). Conversão para
   `America/Sao_Paulo` só na borda. Plantão 19h→07h atravessa o dia: por isso
   `startsAt`/`endsAt` são timestamps completos, não data + hora.
4. **Soft delete** em tudo que tem histórico financeiro. As chaves únicas
   incluem a coluna gerada `deleted_marker` porque o MySQL não tem índice
   parcial.
5. **404, nunca 403**, para recurso de outro tenant. 403 confirmaria que existe.
6. **Autenticação por padrão.** Abrir rota exige `@Public()` explícito.
7. **Suspensão bloqueia escrita, nunca leitura.** Quem atrasou o pagamento
   continua enxergando e exportando o próprio histórico.
8. **Valor é copiado, não referenciado.** O plantão guarda os próprios valores;
   corrigir a tabela de preços em março não pode reescrever o faturamento de
   janeiro.
9. **Margem nunca é coluna.** É derivada na leitura — coluna calculada fica
   errada assim que alguém edita o valor de origem.

---

## Scripts

| Comando | O quê |
|---|---|
| `npm run start:dev` | API com reload |
| `npm run migration:run` | Aplica migrations pendentes |
| `npm run migration:revert` | Desfaz a última |
| `npm run migration:generate -- src/database/migrations/NomeDaMudanca` | Rascunho a partir das entities |
| `npm run seed` | Popula planos (idempotente) |
| `npm run job -- trial\|documentos\|limpeza` | Roda um job agendado na hora (a trava continua valendo) |
| `npm test` | Unitários |
| `npm run test:e2e` | Integração + **isolamento de tenant** |
| `npm run lint` | ESLint |

---

## Estado atual

Sprints 0 a 5 do roadmap ([`04-roadmap-execucao.md`](../docs/mnvma/04-roadmap-execucao.md)):

- [x] Fundação: config validada, logging, erro padronizado, health, Swagger
- [x] Multi-tenant: contexto por requisição, repositório escopado, triggers
- [x] Auth: registro, login, refresh rotativo com detecção de reuso, `/me`
- [x] Senha: esqueci / redefinir / trocar, com token hasheado e sessões revogadas
- [x] RBAC: 7 papéis, permissões granulares, módulos por tipo de conta
- [x] Guard de status da conta (trial / suspensa / cancelada)
- [x] Clientes e responsáveis (CRUD de referência)
- [x] Serviços com margem e valor/hora derivados
- [x] Cuidadores (CRUD; o titular da conta não pode ser removido)
- [x] Plantões: máquina de estados, conflito de agenda, escala em lote
- [x] **Plantão concluído gera conta a receber e conta a pagar** (§9)
- [x] Financeiro: baixa, resumo previsto × realizado, fluxo de caixa
- [x] Disponibilidade: grade semanal orienta, bloqueio impede de escalar
- [x] `GET /shifts/:id/candidates` — base da substituição
- [x] Relatórios: rentabilidade por cliente/cuidador/serviço e panorama operacional
- [x] E-mail transacional; em dev os links saem no terminal (`MAIL_PROVIDER=log`)
- [x] Jobs diários: fim de trial, documentos vencendo e limpeza de token morto
- [ ] Escalas em grade, contratos, ocorrências (Sprint 6)
- [ ] Mercado Pago (Sprint 7)

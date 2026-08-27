# MNVMA — Visão Geral Técnica

> Documento mestre da arquitetura. O planejamento de produto continua em
> [`planejamento_saas_cuidadores.md`](./planejamento_saas_cuidadores.md).
> Este documento define **como** construir, **onde** publicar e **como cobrar**.

---

## 1. Nomenclatura do projeto

Marca da plataforma: **MNVMA**.

| Peça | Nome | Público | Domínio sugerido |
|---|---|---|---|
| Plataforma / marca | **MNVMA** | — | `mnvma.com.br` |
| Painel do assinante (cuidador e empresa) | **MNVMA Care** | Cuidador independente, empresa, equipe | `app.mnvma.com.br` |
| Painel do dono do SaaS (Super Admin) | **MNVMA Core** | Você | `core.mnvma.com.br` |
| API | **MNVMA API** | Interno | `api.mnvma.com.br` |
| Site de vendas (landing + preços) | **MNVMA** | Visitantes | `mnvma.com.br` |

**Decisão:** o painel se chama **MNVMA Care**. É o nome exibido no cabeçalho, no
manifest do PWA, no ícone instalado no celular e nos e-mails transacionais.

O **MNVMA Core** (Super Admin) **não** é um app separado no início: é uma rota
protegida dentro do mesmo frontend (`/core/*`), liberada apenas para usuários com
`role = SUPER_ADMIN`, e o menu nem existe para os demais. Separar em outro deploy
só quando houver equipe de suporte usando o painel diariamente.

> **Construído.** O Core existe: painel de métricas, lista e ficha das contas,
> suspender/reativar com motivo obrigatório e auditoria, e a administração de
> cupons. No backend são as rotas `/v1/admin/*`, protegidas pelo
> `SuperAdminGuard` — que confere o **papel**, e não uma permissão: o titular de
> cada conta cliente também tem todas as permissões, dentro da conta dele.
>
> O papel `SUPER_ADMIN` não é criado por nenhuma rota, e isso é proposital: o dia
> em que existir um endpoint que promove alguém a Super Admin é o dia em que uma
> falha de permissão em qualquer canto vira acesso a todas as contas de todos os
> clientes. A promoção é manual, no banco.

---

## 2. Separação em dois repositórios

O backend e o frontend são **projetos independentes, repositórios independentes e
deploys independentes**. Nada de monorepo, nada de servidor renderizando HTML.

```text
mnvma-api          → backend  (Node + NestJS + TypeORM + MySQL 8)
                     publicado em Railway / Render / Fly.io
                     https://api.mnvma.com.br

mnvma-care         → frontend (React + Vite + TypeScript + PWA)
                     publicado em Vercel / Netlify / Cloudflare Pages
                     https://app.mnvma.com.br
```

O único contrato entre eles é **HTTP + JSON + JWT**. O frontend nunca acessa o
banco, nunca guarda `ACCESS_TOKEN` do Mercado Pago, nunca calcula regra de
negócio de dinheiro. O backend nunca serve HTML.

### Por que essa divisão

- **Publicação em lugares diferentes** (requisito): o frontend vira arquivo
  estático em CDN global, o backend fica perto do banco.
- **PWA de verdade**: build estático + service worker é muito mais simples de
  cachear e instalar do que uma app com SSR.
- **Escala separada**: pico de acesso ao painel não derruba os webhooks do
  Mercado Pago.
- **Deploy independente**: corrigir um botão não exige subir a API.

### O que atravessa a fronteira

| Item | Onde vive | Observação |
|---|---|---|
| Regras de negócio | Backend | Cálculo de margem, status de plantão, limites de plano |
| Autenticação | Backend emite, frontend guarda | JWT de acesso (memória) + refresh (cookie httpOnly) |
| `tenant_id` | Backend, dentro do JWT | **Nunca** enviado pelo frontend como parâmetro |
| Chaves do Mercado Pago | Backend (env) | `ACCESS_TOKEN` jamais chega ao browser |
| `PUBLIC_KEY` do Mercado Pago | Frontend (env de build) | Só para tokenizar cartão via Brick |
| Uploads de documentos | Backend gera URL assinada | Frontend faz PUT direto no storage |

---

## 3. Stack escolhida

### Backend — `mnvma-api`

| Camada | Escolha | Motivo |
|---|---|---|
| Runtime | Node.js 22 LTS | Mesma linguagem do front, ecossistema maduro |
| Framework | NestJS | Módulos, DI, guards e interceptors — encaixa perfeito em multi-tenant e permissões |
| ORM | **TypeORM 0.3** | Entities com decorator (casa com o NestJS), migrations versionadas, QueryBuilder forte para os relatórios |
| Banco | MySQL 8 | Relacional, JSON, `utf8mb4_0900_ai_ci` (busca ignora acento e caixa) |
| Cache / filas | Redis + BullMQ | Jobs de cobrança recorrente, notificações, retry de webhook |
| Auth | JWT (access 15min + refresh 30d) + Argon2 | Refresh rotativo em cookie httpOnly |
| Validação | Zod ou class-validator | Contrato de entrada explícito |
| Arquivos | S3 compatível (Cloudflare R2 / Backblaze B2) | Documentos de cuidadores e clientes |
| Docs | Swagger (`/docs`) | Contrato para o frontend |
| Logs | Pino + request-id | Auditoria e rastreio de webhook |

### Frontend — `mnvma-care`

| Camada | Escolha | Motivo |
|---|---|---|
| Build | Vite 6 | Build estático rápido, deploy em qualquer CDN |
| UI | React 19 + TypeScript | Ecossistema, contratação fácil |
| Roteamento | React Router 7 (modo SPA) | Sem servidor, sem SSR |
| Estado servidor | TanStack Query | Cache, revalidação, retry, offline |
| Estado local | Zustand | Sessão, tema, tenant ativo |
| Formulários | React Hook Form + Zod | Mesmo schema do backend |
| Estilo | Tailwind CSS + shadcn/ui | Velocidade e consistência |
| PWA | `vite-plugin-pwa` (Workbox) | Instalável, offline, update automático |
| Offline | IndexedDB (Dexie) | Fila de escrita e cache de agenda |
| Gráficos | Recharts | Dashboard e rentabilidade |
| Datas | date-fns + `America/Sao_Paulo` | Plantão que vira o dia (19h→07h) |

**Por que Vite/SPA e não Next.js:** o produto é um painel autenticado, atrás de
login, sem necessidade de SEO nem SSR. SPA estática é mais barata, mais simples
de hospedar em qualquer CDN e casa melhor com service worker. O site de vendas
público (`mnvma.com.br`), esse sim, pode ser Next.js ou até uma landing estática
separada — é um terceiro projeto, opcional e independente.

---

## 4. Desenho macro

```text
        ┌───────────────────────────────┐
        │   mnvma-care  (PWA estático)  │  CDN global
        │   app.mnvma.com.br            │
        │   React + Vite + Workbox      │
        └──────────────┬────────────────┘
                       │ HTTPS + JWT (Bearer)
                       │ CORS restrito
                       ▼
        ┌───────────────────────────────┐
        │   mnvma-api  (NestJS)         │
        │   api.mnvma.com.br            │
        │  ┌─────────────────────────┐  │
        │  │ Auth · Tenant · RBAC    │  │
        │  │ Operação · Financeiro   │  │
        │  │ Billing (Mercado Pago)  │  │
        │  │ Webhooks · Jobs (Bull)  │  │
        │  └─────────────────────────┘  │
        └───┬──────────┬────────────┬───┘
            │          │            │
            ▼          ▼            ▼
        MySQL 8     Redis      S3 / R2
                                 (documentos)
            ▲
            │ webhooks assinados (x-signature)
            │
     ┌──────┴────────────────┐
     │    Mercado Pago       │
     │  Assinaturas + Pix    │
     └───────────────────────┘
```

---

## 5. Dois fluxos de dinheiro — não confundir

Este é o ponto mais importante do projeto. Existem **dois** dinheiros diferentes:

### Fluxo A — MNVMA cobra o assinante (obrigatório, Fase 4)

O cuidador ou a empresa paga a mensalidade do sistema para **você**.

```text
Cuidador/Empresa ──R$ 49/mês──▶ Mercado Pago ──▶ Conta MNVMA
```

Implementação: **Assinaturas (Preapproval) do Mercado Pago**, com plano
recorrente, trial, cobrança automática, retentativa e suspensão.
Detalhado em [`03-mercado-pago.md`](./03-mercado-pago.md).

### Fluxo B — o assinante cobra os clientes dele (opcional, Fase 5)

A empresa de cuidadores cobra a família do idoso. Esse dinheiro **não é seu**.

```text
Família ──R$ 6.500──▶ Mercado Pago da Empresa ──▶ Conta da Empresa
                              │
                              └──▶ webhook ──▶ MNVMA baixa a Conta a Receber
```

Implementação: **OAuth do Mercado Pago** — cada tenant conecta a própria conta
Mercado Pago e o MNVMA emite Pix/link em nome dele. Você pode cobrar uma taxa
por transação (`application_fee`) mais tarde. **Isso não entra no MVP.**

No MVP, "Conta a Receber" é só um registro contábil com baixa manual. O Fluxo B
transforma esse registro numa cobrança real.

---

## 6. Ambientes

| Ambiente | API | Painel | Banco | Mercado Pago |
|---|---|---|---|---|
| Local | `localhost:3000` | `localhost:5173` | MySQL local (`cuidador`) | Credenciais de **teste** |
| Staging | `api-staging.mnvma.com.br` | `staging.mnvma.com.br` | Instância separada | Credenciais de **teste** + usuários de teste |
| Produção | `api.mnvma.com.br` | `app.mnvma.com.br` | Instância com backup diário | Credenciais de **produção** |

Regra: **nunca** apontar staging para o banco de produção, e nunca usar
credencial de produção do Mercado Pago fora de produção.

---

## 7. Ordem de construção

Ordem pensada para ter algo vendável cedo, sem retrabalho de fundação.

| Sprint | Backend | Frontend | Entregável |
|---|---|---|---|
| 0 | Repo, Docker, TypeORM + 1ª migration, CI | Repo, Vite, Tailwind, PWA base | Deploy "hello" nos dois ambientes |
| 1 | Auth, Tenant, User, RBAC | Login, cadastro, escolha de tipo de conta | Entrar e sair |
| 2 | Customer, Responsible, Service | CRUDs, listas com filtro | Cadastrar cliente |
| 3 | Shift, Availability, Agenda | Calendário dia/semana/mês | Agendar plantão |
| 4 | AccountReceivable/Payable, geração automática do plantão | Financeiro, fluxo de caixa | Plantão vira dinheiro |
| 5 | Dashboard, relatórios | Dashboard individual | **MVP Individual pronto** |
| 6 | Caregiver, Schedule, Contract, margem | Escalas, painel empresa | **MVP Empresarial** |
| 7 | Plan, Subscription, Mercado Pago, webhooks | Tela de planos, checkout, status | **Cobrança rodando** |
| 8 | Super Admin, métricas, suspensão | MNVMA Core | **SaaS completo** |
| 9 | Offline, push, check-in | Service worker avançado | PWA completo |

Detalhe de cada lado:
- Backend: [`01-backend.md`](./01-backend.md)
- Frontend PWA: [`02-frontend-pwa.md`](./02-frontend-pwa.md)
- Mercado Pago: [`03-mercado-pago.md`](./03-mercado-pago.md)
- Execução e checklists: [`04-roadmap-execucao.md`](./04-roadmap-execucao.md)

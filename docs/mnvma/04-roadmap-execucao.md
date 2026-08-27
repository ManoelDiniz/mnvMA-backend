# MNVMA — Execução

Como sair de zero até um SaaS cobrando. Cada sprint tem entregável testável nos
dois repositórios.

---

## 1. Sprint 0 — Fundação (semana 1)

### `mnvma-api`
- [x] `nest new mnvma-api`, TypeScript estrito, ESLint + Prettier
- [x] `docker-compose.yml` com MySQL 8 e Redis (opcional — o MySQL local serve)
- [x] TypeORM configurado: `data-source.ts`, `synchronize: false`, `SnakeNamingStrategy`
- [x] `BaseEntity` / `TenantBaseEntity`, `MoneyColumn`, `RequestContext` (AsyncLocalStorage)
- [x] Primeira migration: `tenants`, `users`, `plans`, `subscriptions`, `caregivers`, `customers`
- [x] Triggers de tenant na migration (substituem o RLS que o MySQL não tem)
- [x] `HttpExceptionFilter` com o formato único de erro, Swagger em `/docs`
- [x] `GET /health`, Pino com `request-id`
- [ ] Deploy no Railway respondendo em `api-staging.mnvma.com.br` — falta só publicar

### `mnvma-care`
- [x] `npm create vite@latest mnvma-care -- --template react-ts`
- [x] Tailwind 4 com tokens do MNVMA e tema claro/escuro sem piscar
- [x] `vite-plugin-pwa` com o manifest de **MNVMA Care**, ícones 192/512/maskable
- [x] Shell: sidebar (desktop) + bottom bar (mobile), tema claro/escuro
- [x] `client.ts` (fetch) com fila de refresh, tratamento de 401/402 e erros tipados
- [ ] Deploy na Vercel em `staging.mnvma.com.br` — `vercel.json` pronto, falta publicar
- [ ] **Verificar instalação real num Android e num iPhone** ← precisa de aparelho

**Pronto quando:** dá para instalar o app no celular, ele abre em tela cheia com
o ícone do MNVMA e mostra uma tela chamando `GET /health` da API em staging.

---

## 2. Sprint 1 — Autenticação e tenant (semana 2)

- [x] `POST /auth/register` criando Tenant + User(OWNER) + Subscription(TRIAL) + Caregiver(isOwner)
- [x] Login com Argon2id, access token + refresh rotativo com detecção de reuso
- [x] `TenantContextInterceptor` com `@mnvma_tenant_id` e transação por request
- [x] `TenantScopedRepository` + triggers de escrita nas tabelas existentes
- [x] `PermissionsGuard` com o mapa de papéis do §12 + guard de status da conta
- [x] `GET /auth/me` devolvendo tenant, permissões e módulos
- [x] Esqueci/redefinir/trocar senha, com token hasheado e revogação de sessões
- [x] Front: entrar, criar conta com escolha de tipo, esqueci a senha e redefinir
- [x] Front: menu montado a partir das permissões de `/auth/me`
- [x] Suíte de isolamento de tenant escrita — [ ] falta ligar no CI bloqueando merge

**Pronto quando:** dois tenants coexistem e nenhum enxerga nada do outro, provado
por teste automatizado.

---

## 3. Sprint 2 a 5 — MVP Individual (semanas 3 a 8)

| Sprint | Entrega | Situação |
|---|---|---|
| 2 | Clientes, responsáveis e serviços com margem | **Pronto** |
| 3 | Agenda, plantões, conflito de horário, escala em lote, disponibilidade e bloqueios | **Pronto** |
| 4 | Contas a receber e a pagar, baixa, fluxo de caixa, **plantão gerando financeiro** | **Pronto** |
| 5 | Dashboard com dados reais, relatórios operacionais e rentabilidade com CSV | **Pronto** |

**Pronto quando:** um cuidador real consegue usar por um mês e responder
*"quanto eu trabalhei e quanto eu ganhei?"* sem planilha.

Marco recomendado: **colocar 3 a 5 cuidadores reais usando de graça** antes de
escrever qualquer linha do módulo empresarial. Feedback aqui vale mais que
qualquer funcionalidade nova.

---

## 4. Sprint 6 — MVP Empresarial (semanas 9 a 12)

O backend inteiro está de pé e coberto por teste de ponta a ponta. O que falta
é tela: nenhuma dessas funcionalidades existe ainda no `mnvma-care`, e enquanto
não existir, uma empresa não consegue usar nada disso.

### `mnvma-api` — pronto

- [x] Cuidadores: CRUD completo (antecipado — sem ele a empresa não montava plantão)
- [x] Documentos do cuidador com controle de validade e alerta do que vence
- [x] Escalas em grade (`GET /schedules`) e repetição de semana (`POST /schedules/copy-week`)
- [x] Plantão empresarial com custo, cobrança e margem separados
- [x] Contratos com geração de cobrança e três camadas de idempotência
- [x] Substituições de cuidador com histórico e ocorrências que não somem
- [x] Usuários, convites por token com hash e permissões por papel
- [x] Relatório de rentabilidade por cliente, serviço e cuidador
- [ ] Rentabilidade **por contrato** — falta o recorte no relatório

### `mnvma-care`

- [x] Tela de equipe: lista de acessos, convite, reenvio, cancelamento
- [x] Página pública de aceite do convite (`/convite/:token`)
- [x] Contratos, com a prévia da rodada de cobrança antes de disparar
- [x] Documentos do cuidador, abrindo no que está vencendo ou vencido
- [x] Grade de escala por semana, com repetição da semana inteira
- [x] Ocorrências: registro, encerramento com resolução e reabertura
- [ ] Arrastar plantão de um cuidador para outro dentro da grade
- [ ] Substituição de cuidador na tela do plantão
- [ ] Dashboard empresarial
- [ ] **Passar as telas novas num navegador de verdade** ← rodaram tsc, lint,
      smoke de renderização e o contrato com a API; ninguém clicou ainda

**Pronto quando:** uma empresa com 10 cuidadores fecha o mês e responde
*"quanto vendi, quanto custou e quanto sobrou?"*.

---

## 4.1 Sprint 6.5 — Operação sem babá

O que faltava para a plataforma passar um fim de semana sem ninguém olhando.
Antes disto, esquecer a senha significava pedir a alguém com acesso ao banco, o
convite só chegava se quem convidou copiasse o link na mão, e `trialEndsAt` era
uma data que ninguém lia — a conta seguia escrevendo depois do prazo.

- [x] `MailService` com transporte trocável (`log` em dev, Resend em produção),
      que nunca lança e nunca segura o request
- [x] Templates em PT-BR com versão em texto: convite, redefinição de senha,
      senha alterada, boas-vindas, fim de teste, documentos vencendo
- [x] Convite sai por e-mail — e a tela muda de tom quando o envio falha, porque
      o link continua sendo o plano B
- [x] Esqueci a senha ponta a ponta: link com validade de 1 h, uso único, banco
      só com o hash, resposta igual para e-mail que existe e que não existe
- [x] Trocar a senha estando logado, derrubando as outras sessões e mantendo a
      própria
- [x] Regra de senha unificada — quem entra por convite não fica com senha mais
      fraca que quem se cadastrou sozinho
- [x] Cron com trava distribuída em `job_runs`: duas instâncias não mandam o
      mesmo e-mail duas vezes
- [x] Job de trial: encerra o vencido e avisa em 3 dias e em 1 dia
- [x] Job de documentos: digest diário do que vence e do que já venceu
- [x] Job de limpeza: token morto não fica esperando um vazamento de dump
- [x] `npm run job -- <nome>` para rodar na mão, com a trava valendo
- [x] Zero erro de lint na API: os 10 de `src/` corrigidos de verdade (o
      transformador de dinheiro estava duplicado em cinco DTOs e virou um só);
      os dos testes e2e vieram de `any` do supertest e ganharam exceção
      explicada no `eslint.config.mjs`
- [ ] **Abrir as telas de senha num navegador de verdade** ← passaram por tsc,
      lint, smoke de renderização e e2e da API; ninguém clicou ainda

### O que continua faltando para produção

Levantado na auditoria e ainda aberto — em ordem de quanto dói. O módulo
`billing`, que liderava esta lista, saiu dela no Sprint 7: falta só ligar as
credenciais de produção.

| Lacuna | Por que importa | Onde |
|---|---|---|
| Arquivo do documento não é guardado | A validade é controlada, mas o PDF do COREN não sobe: falta bucket (R2/S3) e URL assinada | Sprint 6 |
| Módulo `tenants` só tem entity | Sem tela nem rota para a conta editar os próprios dados | Sprint 8 |
| Impersonação | O suporte não consegue ver o que o cliente vê | Sprint 8 — desenho próprio |
| Substituição de cuidador sem tela | O backend guarda o histórico; a operação não consegue registrar | Sprint 6 |
| Dashboard empresarial | A empresa não tem o panorama que o individual tem | Sprint 6 |
| Rentabilidade por contrato | Falta o recorte no relatório | Sprint 6 |
| Suíte de isolamento fora do CI | O teste existe e passa, mas nada bloqueia o merge | Sprint 0 |

---

## 5. Sprint 7 — Cobrança (semanas 13 e 14)

Detalhe completo em [`03-mercado-pago.md`](./03-mercado-pago.md).

- [x] Job de fim de trial e transição `TRIAL` → `EXPIRED` (feito no 6.5)
- [x] Seed dos planos e espelho no Mercado Pago (`npm run seed:mp`, com `--dry`)
- [x] `POST /billing/subscribe` devolvendo o `init_point` do checkout
- [x] Webhook com validação de assinatura HMAC, idempotência e processamento
      fora do request
- [x] Máquina de estados: TRIAL → ACTIVE → PAST_DUE → SUSPENDED → CANCELED
- [x] Job de dunning com a régua D+3 / D+5 / D+7 / D+37
- [x] Job de reconciliação horária — a rede embaixo do webhook perdido
- [x] `PlanLimitGuard` devolvendo 402 com os dados de upgrade
- [x] Front: planos, retorno do checkout, assinatura com extrato, cancelamento
      e a caixa de upgrade no 402
- [x] Suíte e2e cobrindo os nove cenários da seção 9 do documento do Mercado Pago
- [ ] Criar a aplicação e os planos na conta REAL do Mercado Pago e preencher
      `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` no ambiente ← precisa da conta
- [ ] Teste com cartão real de R$ 1,00 e estorno ← depende do item acima

**Pronto quando:** você recebe dinheiro de verdade e a conta ativa sozinha.

### Cupons de desconto

Detalhe em [`03-mercado-pago.md` §9.1](./03-mercado-pago.md).

- [x] Percentual de 1% a 100%, por um número definido de faturas
- [x] Uma vez por conta, garantido por chave única no banco
- [x] Cupom nominal: só os e-mails ou contas da lista resgatam
- [x] Teto global de resgates, com trava contra corrida
- [x] Janela de resgate, restrição por tipo de conta e "só primeira assinatura"
- [x] Prévia (`/billing/coupons/preview`) com a mesma validação do resgate
- [x] Valor descontado enviado ao provedor, e valor cheio restabelecido quando
      as faturas com desconto acabam
- [x] **Cupom de 100% = cortesia**: ativa sem checkout e sem cartão, com prazo;
      avisos em D-3 e D-1 e encerramento pelo job
- [x] Administração em `/v1/admin/coupons`, só para `SUPER_ADMIN` — o primeiro
      pedaço do MNVMA Core
- [x] Suíte e2e com 20 cenários, incluindo a cortesia vencendo
- [x] Tela de administração de cupons, dentro do MNVMA Core

### Como ficou, e por quê

Duas decisões que valem para quem for mexer nisso depois:

- **Sem Redis.** O documento previa fila com broker para o webhook. Na prática o
  que ele precisa é responder 200 rápido e não perder nada — e a durabilidade
  veio do banco: o evento é gravado em `webhook_events` antes de qualquer coisa,
  processado em segundo plano e, se falhar, recolhido pelo `billing.sincronizacao`
  de hora em hora. Fila com broker entra quando houver trabalho que precise de
  paralelismo real, não antes.
- **Cortesia não é suspensão.** Quando um cupom de 100% acaba, a conta vai para
  `EXPIRED`, não para `SUSPENDED`. As duas bloqueiam a escrita do mesmo jeito, e
  a diferença é só a frase que o cliente lê — que é justamente o ponto: ninguém
  deixou de pagar nada.
- **Trial não tem limite de plano.** A conta nasce apontando para o primeiro
  plano do catálogo, que é o gratuito — o mais apertado. Cobrar os limites dele
  durante o teste quebraria a promessa de "14 dias com tudo liberado" no quinto
  cliente cadastrado. O `PlanLimitGuard` ignora conta em `TRIAL`.

---

## 6. Sprint 8 — MNVMA Core (semana 15)

O painel do dono do SaaS. Não é um app separado: é a rota `/core/*` dentro do
mesmo frontend, atrás de um guard de **papel** (`SUPER_ADMIN`) — permissão não
serve aqui, porque o titular de cada conta cliente também tem todas elas dentro
da conta dele.

- [x] Métricas: contas por situação, individuais, empresas, MRR, inadimplentes,
      cortesias, novas no mês, cancelamentos e testes terminando
- [x] Lista de contas com busca, filtro por situação e tipo, e paginação —
      filtros na URL, para o número do painel virar link
- [x] Detalhe da conta: assinatura, uso, pessoas, cobranças, cupons e histórico
- [x] Suspender e reativar, com **motivo obrigatório** e registro em
      `admin_actions` (quem fez, quando, por quê)
- [x] Tela de cupons: criar, listar, tornar nominal e ver quem resgatou
- [x] Acesso cross-tenant sempre via `SystemScope`, com motivo logado
- [ ] **Impersonar** — deixado de fora de propósito (ver abaixo)
- [ ] Editor de planos e limites (§19: limites configuráveis)
- [ ] Tela da própria conta do assinante (módulo `tenants`)

### Por que a impersonação ficou de fora

É a funcionalidade mais perigosa do produto inteiro: um token que abre a conta
de um cliente. Fazê-la junto com o resto do Core, no embalo, seria a pior forma
de construí-la. Ela precisa de decisões próprias, e cada uma tem consequência:

- token de vida curta e escopo separado, que **não** possa virar refresh;
- faixa permanente na tela dizendo em nome de quem se está agindo;
- bloqueio de escrita durante a impersonação, ou registro de cada gravação feita
  nela — dado clínico alterado "por outra pessoa" é um problema jurídico, não de
  produto;
- registro de início e fim, e aviso ao titular da conta.

A base já está pronta: `admin_actions` existe para receber esse rastro.

### Como ficou

- **Reativar não presenteia.** A conta volta para `ACTIVE` só se houver período
  concedido de verdade — assinatura no provedor ou cortesia valendo. Sem isso,
  volta ao teste (se ainda houver prazo) ou a "precisa assinar". `currentPeriodEnd`
  sozinho não prova nada: numa assinatura em teste ele guarda o fim do teste.
- **Suspensão manual também preserva a leitura.** Mesmo por fraude ou abuso, o
  cliente continua consultando e exportando o histórico dele. Trancar alguém
  para fora dos próprios dados não recupera nada e destrói qualquer reversão.
- **MRR já com os cupons descontados.** É o que será cobrado no próximo ciclo,
  não o preço de tabela — a diferença aparece justamente durante uma campanha de
  desconto, que é quando o número mais importa.

---

## 7. Sprint 9 — PWA completo (semana 16+)

- [ ] Cache offline da agenda dos próximos 7 dias e dos clientes
- [ ] Fila de escrita offline (check-in, check-out, ocorrência) com Background Sync
- [ ] Web Push com VAPID: plantão sem cuidador, plantão próximo, conta vencendo
- [ ] Check-in / check-out com hora e, depois, GPS e foto
- [ ] Página `/instalar` com instruções por plataforma
- [ ] Lighthouse PWA ≥ 90 travado no CI

---

## 8. Definition of Done (vale para toda tarefa)

1. Endpoint documentado no Swagger, com DTO validado
2. Teste de isolamento de tenant escrito
3. Migration gerada e revertível (`migration:revert` testado)
4. Erro tratado no padrão único da API
5. Front cobrindo os cinco estados: carregando, vazio, erro, offline, sem permissão
6. Testado no celular de verdade, não só no simulador do navegador
7. Sem `console.log`, sem `any`, sem `synchronize: true`
8. Sem segredo commitado

---

## 9. Riscos e como cortar cada um

| Risco | Impacto | Mitigação |
|---|---|---|
| Vazamento entre tenants | Fim do produto | Repositório escopado + triggers de escrita no MySQL + suíte de teste bloqueando merge |
| Construir empresarial antes de validar individual | Meses jogados fora | Individual em produção com usuários reais antes do sprint 6 |
| Cobrança quebrada em silêncio | Receita evaporando sem ninguém ver | Webhook validado + job de reconciliação horária + alerta no Sentry |
| Fuso e plantão que vira o dia | Relatório e pagamento errados | `datetime(6)` em UTC + conexão `timezone: 'Z'`, conversão só na borda, testes com 19h→07h |
| Dinheiro em `float` | Divergência de centavos no financeiro | `decimal(12,2)` lido como string e soma em SQL |
| PWA travado em versão antiga | Usuário nunca recebe correção | `sw.js` com `no-cache` no CDN + prompt de atualização |
| Escopo infinito (marketplace, WhatsApp, app nativo) | Nada fica pronto | Fases 5+ ficam congeladas até o MRR existir |
| Backup que nunca foi restaurado | Perda de dados sem volta | Restore testado em staging uma vez por mês |

---

## 10. Custo mensal estimado (início)

| Item | Estimativa |
|---|---|
| Railway (API + MySQL + Redis) | US$ 10–25 |
| Vercel (frontend) | US$ 0 (Hobby) → US$ 20 (Pro) |
| Cloudflare R2 (documentos) | US$ 0–5 |
| E-mail transacional (Resend/SES) | US$ 0–20 |
| Domínio `.com.br` | ~R$ 40/ano |
| Sentry | US$ 0 (free) |
| **Total** | **≈ US$ 15–70/mês** |

Mercado Pago não cobra mensalidade: fica com um percentual por transação
aprovada, que varia conforme o meio de pagamento e o prazo de liberação.
Confirme as taxas vigentes antes de fechar o preço dos planos — elas entram
direto na sua margem.

Uma assinatura `company_start` (R$ 149) já cobre toda a infraestrutura inicial.

---

## 11. Primeiro comando

```bash
# backend
npx @nestjs/cli new mnvma-api
cd mnvma-api
npm i @nestjs/typeorm typeorm mysql2 typeorm-naming-strategies \
      @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt \
      @node-rs/argon2 class-validator class-transformer \
      @nestjs/bullmq bullmq ioredis \
      @nestjs/swagger nestjs-pino pino-http

# frontend
npm create vite@latest mnvma-care -- --template react-ts
cd mnvma-care
npm i react-router-dom @tanstack/react-query axios zustand \
      react-hook-form zod @hookform/resolvers date-fns dexie recharts
npm i -D tailwindcss @tailwindcss/vite vite-plugin-pwa workbox-window
```

---

## 12. Índice dos documentos

| Documento | Conteúdo |
|---|---|
| [`planejamento_saas_cuidadores.md`](./planejamento_saas_cuidadores.md) | Produto: telas, campos, regras de negócio |
| [`00-visao-geral-tecnica.md`](./00-visao-geral-tecnica.md) | Nomes, repositórios, stack, os dois fluxos de dinheiro |
| [`01-backend.md`](./01-backend.md) | MNVMA API: NestJS + TypeORM, multi-tenant, entities, endpoints |
| [`02-frontend-pwa.md`](./02-frontend-pwa.md) | MNVMA Care: React + Vite, PWA, offline, telas |
| [`03-mercado-pago.md`](./03-mercado-pago.md) | Assinaturas, webhooks, dunning, Pix |
| `04-roadmap-execucao.md` | Este documento |

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
- [x] Arquivo do documento anexado de verdade: `POST /documents/:id/file`,
      download por URL assinada, tipo conferido pelos bytes e chave montada pelo
      servidor — **guardado no volume do próprio servidor** (ver §4.2)
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
- [x] Anexar, trocar, baixar e remover o arquivo na linha do documento — com o
      formato e o tamanho recusados **antes** da subida, e o link de download
      pedido no clique, porque o da lista já expirou (ver §4.2)
- [x] Grade de escala por semana, com repetição da semana inteira
- [x] Ocorrências: registro, encerramento com resolução e reabertura
- [ ] Arrastar plantão de um cuidador para outro dentro da grade
- [x] Substituição de cuidador na tela do plantão: candidatos com o motivo de
      quem não pode, escalar à força com a marca ficando no motivo, e o
      histórico de trocas do plantão
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
| Módulo `tenants` só tem entity | Sem tela nem rota para a conta editar os próprios dados | Sprint 8 |
| Impersonação | O suporte não consegue ver o que o cliente vê | Sprint 8 — desenho próprio |
| Dashboard empresarial | A empresa não tem o panorama que o individual tem | Sprint 6 |
| Rentabilidade por contrato | Falta o recorte no relatório | Sprint 6 |
| Suíte de isolamento não bloqueia merge | Roda a cada PR desde 27/08, mas proteger a branch exige GitHub Pro | §6.1 |

Esta tabela lista o que falta **no produto**. O que falta em volta dele — CI,
observabilidade, LGPD, backup e as obrigações de cobrar no Brasil — está no
[§6.1](#61-sprint-85--governança-o-que-falta-para-abrir-a-porta), e é o que
impede de abrir a porta.

---

## 4.2 Onde os arquivos ficam

**Decisão: o disco do próprio servidor, por enquanto.** `STORAGE_DRIVER=local`
em produção. O plano original previa bucket S3/R2 desde o primeiro dia; o driver
`s3` está escrito, testado e continua no repositório — mas abrir conta em
provedor de nuvem para guardar alguns PDFs de COREN, antes de existir o primeiro
assinante pagante, é custo e superfície de configuração comprados cedo demais.

Trocar depois é uma variável de ambiente: nenhum módulo menciona driver. Quem
grava chama `StorageService`, e o que muda é só onde o byte cai.

O que **não** muda com essa escolha, e é o motivo de ela ser segura:

- a chave é montada pelo servidor e sempre começa pelo tenant;
- o tipo é conferido pelos bytes, não pelo cabeçalho do navegador;
- o download é por **URL assinada com HMAC** e validade de 5 minutos, servida
  por rota própria, sempre como `attachment` e com `nosniff` — não há diretório
  estático exposto.

O que passa a ser responsabilidade da operação, e não do código:

| Obrigação | Por quê |
|---|---|
| `STORAGE_LOCAL_DIR` absoluto, num **volume persistente** | Caminho relativo mora dentro da aplicação e some no deploy seguinte. A API se recusa a subir assim fora de desenvolvimento, e o `Dockerfile` já cria `/data/uploads` com o dono certo |
| **Backup do diretório junto com o dump do MySQL** | O banco guarda a chave, não o arquivo. Dump restaurado sozinho devolve links que apontam para o nada |
| Olho no espaço em disco | Um bucket cresce sozinho; um volume enche. É o gatilho para virar a chave do `s3` |

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

## 6.1 Sprint 8.5 — Governança: o que falta para abrir a porta

Levantado numa auditoria do código contra estes documentos. O que está aqui não
é funcionalidade que ficou para depois: é o conjunto de coisas que **os
documentos tratam como pressuposto** e que nenhum sprint jamais recebeu como
tarefa. Cada uma delas aparece citada em algum lugar como se já existisse.

Nada disto aparece para o cliente. Todas aparecem no dia em que der errado.

### Verificação automática — nada bloqueia um merge hoje

Não existe `.github/` em nenhum dos dois repositórios. Ao mesmo tempo, três
documentos falam do pipeline como se ele estivesse de pé: a suíte de isolamento
"bloqueando merge" (§2), o Lighthouse "travado no CI" (§7), o
`lint → test → build → migration → deploy` de [`01-backend.md`](./01-backend.md).
O primeiro risco da tabela do §9 — vazamento entre tenants — é mitigado por um
teste que existe, passa, e que ninguém é obrigado a rodar.

- [x] `mnvma-api`: lint (sem `--fix`), `tsc`, unitários, build — e um job com
      MySQL 8.4 que roda migrations em banco limpo, popula os planos e executa
      **as 7 suítes e2e**, isolamento de tenant incluído
- [x] `mnvma-care`: lint, `tsc`, vitest e build de produção (que é onde o
      service worker é gerado — PWA que não compila não atualiza em aparelho
      nenhum)
- [x] `migration:revert` seguido de `migration:run` a cada PR — o item 3 da
      Definition of Done, que ninguém era obrigado a cumprir. `down()` é o
      método exercitado só no pior dia possível
- [x] `npm audit` e Dependabot semanal nos dois repositórios, com major de
      framework ignorado (é decisão, não manutenção)
- [ ] **Branch protegida exigindo o CI verde** ← **bloqueado pelo plano do
      GitHub**, não por configuração que falta. Sem isto o pipeline informa e o
      merge passa igual.

      Tentado pela API, nos dois repositórios, com token de `Administration:
      read and write`. As duas formas devolvem o mesmo 403:

      ```
      PUT  /repos/.../branches/main/protection  → 403
      POST /repos/.../rulesets                  → 403
      "Upgrade to GitHub Pro or make this repository public to enable
       this feature."
      ```

      Proteção de branch — clássica ou ruleset — não existe em repositório
      **privado** na conta gratuita. As saídas, em ordem de preço:

      | Saída | Custo | O que muda |
      |---|---|---|
      | GitHub Pro | US$ 4/mês | liga os comandos abaixo, sem mais nada a fazer |
      | Tornar público | zero | não: o schema, as regras de cobrança e a régua de dunning ficam abertos |
      | Disciplina + hook local | zero | `pre-push` recusando `main` força o fluxo de PR, mas **não** sabe se o CI passou |

      Até que uma delas aconteça, o vermelho do CI continua sendo informação, e
      o §9 continua com o primeiro risco mitigado só por hábito.

      O comando abaixo exige os checks e **não** exige aprovação em PR — num
      projeto de uma pessoa só, exigir review trancaria o dono para fora do
      próprio repositório, porque ninguém pode aprovar o próprio PR.
      `enforce_admins: false` é a saída de emergência: o titular ainda
      consegue empurrar direto no dia em que precisar.

      ```bash
      gh api -X PUT repos/ManoelDiniz/mnvMA-backend/branches/main/protection \
        --input - <<'JSON'
      {
        "required_status_checks": {
          "strict": true,
          "contexts": [
            "Lint, tipos, unitários e build",
            "e2e — isolamento de tenant e migrations"
          ]
        },
        "enforce_admins": false,
        "required_pull_request_reviews": null,
        "restrictions": null
      }
      JSON

      gh api -X PUT repos/ManoelDiniz/mnvMA-Frontend/branches/main/protection \
        --input - <<'JSON'
      {
        "required_status_checks": {
          "strict": true,
          "contexts": ["Lint, tipos, testes e build"]
        },
        "enforce_admins": false,
        "required_pull_request_reviews": null,
        "restrictions": null
      }
      JSON
      ```

      O `npm audit` ficou fora dos checks obrigatórios de propósito: ele
      informa, e uma vulnerabilidade em dependência de build não deve travar
      correção de bug em produção.

      A partir daí o fluxo passa a ser branch → PR → CI verde → merge. É o
      preço de o vermelho significar alguma coisa.

**Verificado localmente antes de subir**, contra um MySQL descartável: as 10
migrations aplicam em banco vazio, o catálogo popula, a última migration volta e
reaplica, e as **87 asserções e2e passam**. O que não dá para verificar daqui é
o runner do GitHub — a versão do MySQL lá é 8.4, a daqui é 8.0.

### Por que não há checagem de drift de schema

A ideia óbvia — `migration:generate` num banco recém-migrado, falhar se ele
gerar alguma coisa — foi testada e **descartada**. O schema deste projeto é
escrito à mão, com nomes próprios de constraint (`fk_users_tenant`) e colunas
geradas que as entities não declaram (`deleted_marker`, que substitui o índice
parcial que o MySQL não tem). O gerador do TypeORM não sabe nada disso: ele
propõe dropar **todas** as foreign keys para recriá-las com nomes de hash, 376
linhas de diferença num banco que está inteiramente correto.

Seria um passo vermelho em todo PR — e o risco real não é o incômodo, é alguém
resolver "consertar o CI" aplicando o que ele gerou.

### Observabilidade — `SENTRY_DSN` existe e não é lido por ninguém

A variável está declarada em `config/env.ts` desde o começo. O pacote nunca foi
instalado. Hoje, um erro em produção aparece no log de quem for procurar — e a
régua de dunning, o webhook do Mercado Pago e os jobs noturnos rodam sem
ninguém olhando, que era justamente o ponto do Sprint 6.5.

- [ ] Sentry no backend, com `request-id` e tenant no escopo (nunca dado pessoal)
- [ ] Sentry no frontend, com o release amarrado ao build
- [ ] Alerta de webhook com erro e de evento órfão — pendência aberta no §11 de
      [`03-mercado-pago.md`](./03-mercado-pago.md)
- [ ] Alerta de job que não rodou: `job_runs` sabe quando foi a última vez
- [ ] Um canal que apite de verdade (e-mail serve) — painel que ninguém abre não
      é alerta

### LGPD — especificada em detalhe e órfã

[`01-backend.md` §10](./01-backend.md) define quatro obrigações concretas.
Nenhuma delas foi para sprint nenhum, e nenhuma existe no código: não há
`AuditLog`, não há exportação, não há anonimização. **O sistema guarda dado de
saúde de idoso.** Isto não é dívida técnica; é condição de operar.

- [ ] `AuditLog` de leitura em entidade sensível
- [ ] `GET /v1/tenants/me/export` — exportação completa em JSON/CSV
- [ ] `DELETE /v1/tenants/me` — anonimização em 30 dias, com retenção fiscal
- [ ] Retenção de log de 12 meses, aplicada por job
- [ ] Consentimento registrado no cadastro, com data e versão do texto aceito
- [ ] Encarregado (DPO) nomeado e canal do titular publicado

Depende do módulo `tenants`, que hoje só tem entity — o mesmo módulo que a nota
fiscal vai precisar. Fazer os dois juntos.

### Backup — só existe como linha na tabela de riscos

O §9 diz "restore testado em staging uma vez por mês". Não há tarefa, não há
runbook, não há quem. E desde o §4.2 o backup deixou de ser só o banco.

- [ ] Backup diário do MySQL, com retenção definida
- [ ] Backup do diretório de uploads **na mesma janela** do dump — restaurar um
      sem o outro devolve links apontando para o nada
- [ ] Restore testado em staging, com a data do último teste anotada
- [ ] Runbook de restauração escrito antes de precisar dele

### Obrigações de cobrar dinheiro no Brasil

Duas delas já estão no checklist de go-live de
[`03-mercado-pago.md` §11](./03-mercado-pago.md), escondidas dentro do documento
do provedor. São bloqueio jurídico, não item de backlog — e o Sprint 7 está a
uma variável de ambiente de começar a cobrar.

- [ ] Termos de uso e política de privacidade publicados e linkados no checkout
- [ ] Processo de nota fiscal definido (emissão manual no começo é aceitável)
- [ ] Dados fiscais do assinante no cadastro — depende do módulo `tenants`
- [ ] Política de reembolso e o **direito de arrependimento de 7 dias** (CDC),
      que tem efeito direto no `billing`: cancelamento na primeira semana
- [ ] Contrato de assinatura com a regra de reajuste

### Como o cliente chega

O roadmap leva o produto até "recebo dinheiro de verdade" e nunca diz como
alguém encontra o `/criar-conta`. Não é escopo de engenharia, mas sem isso os
outros quinze sprints não são cobrados de ninguém.

- [ ] Site público com preços — hoje só existe o app
- [ ] Página `/instalar` com instruções por plataforma (prevista no Sprint 9)
- [ ] Canal de suporte com endereço publicado
- [ ] Um aparelho Android e um iPhone para o QA que três sprints já pedem

**Pronto quando:** um merge quebrado não passa, um erro em produção chega a
alguém, um titular consegue pedir os próprios dados, e um restore já foi feito
uma vez — antes de precisar.

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
| Vazamento entre tenants | Fim do produto | Repositório escopado + triggers de escrita no MySQL + suíte e2e rodando a cada PR (§6.1) — falta proteger a branch para o vermelho realmente impedir o merge |
| Construir empresarial antes de validar individual | Meses jogados fora | Individual em produção com usuários reais antes do sprint 6 |
| Cobrança quebrada em silêncio | Receita evaporando sem ninguém ver | Webhook validado + job de reconciliação horária + alerta no Sentry |
| Fuso e plantão que vira o dia | Relatório e pagamento errados | `datetime(6)` em UTC + conexão `timezone: 'Z'`, conversão só na borda, testes com 19h→07h |
| Dinheiro em `float` | Divergência de centavos no financeiro | `decimal(12,2)` lido como string e soma em SQL |
| PWA travado em versão antiga | Usuário nunca recebe correção | `sw.js` com `no-cache` no CDN + prompt de atualização |
| Escopo infinito (marketplace, WhatsApp, app nativo) | Nada fica pronto | Fases 5+ ficam congeladas até o MRR existir |
| Backup que nunca foi restaurado | Perda de dados sem volta | Restore testado em staging uma vez por mês — **dump do MySQL e o diretório de uploads juntos**, já que os documentos moram no volume do servidor (§4.2) |

---

## 10. Custo mensal estimado (início)

| Item | Estimativa |
|---|---|
| Railway (API + MySQL + Redis) | US$ 10–25 |
| Vercel (frontend) | US$ 0 (Hobby) → US$ 20 (Pro) |
| Documentos | US$ 0 — volume do servidor (R2 entra quando o volume apertar) |
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

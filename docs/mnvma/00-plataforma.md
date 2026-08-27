# MNVMA

> Este documento e os demais desta pasta descrevem a plataforma inteira — os
> dois repositórios. Eles moram no repositório do backend porque precisam morar
> em algum lugar versionado, e a maior parte deles é sobre backend e negócio.
> O painel fica em [`mnvMA-Frontend`](https://github.com/ManoelDiniz/mnvMA-Frontend).

SaaS de gestão para **cuidadores independentes** e **empresas de cuidadores**.

Clientes, agenda, plantões, escalas, contratos, financeiro e rentabilidade — com
a mesma plataforma atendendo os dois modelos de conta e permitindo que o
cuidador que cresce migre de um para o outro sem perder histórico.

---

## Os dois projetos

São repositórios e deploys **independentes**, publicados em lugares diferentes.
O contrato entre eles é só HTTP + JSON + JWT.

| Projeto | O quê | Stack | Onde vai |
|---|---|---|---|
| [`mnvma-api`](https://github.com/ManoelDiniz/mnvMA-backend) | Backend, regras de negócio, cobrança | NestJS · TypeORM · MySQL 8 | Railway / Render / Fly.io |
| [`mnvma-care`](https://github.com/ManoelDiniz/mnvMA-Frontend) | Painel PWA, instalável no celular | React 19 · Vite · Tailwind 4 | Vercel / Netlify / Cloudflare Pages |

O painel se chama **MNVMA Care**. O painel do dono do SaaS é o **MNVMA Core**,
uma área protegida dentro do mesmo frontend.

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [`planejamento_saas_cuidadores.md`](./planejamento_saas_cuidadores.md) | Produto: telas, campos, regras de negócio |
| [`docs/mnvma/00-visao-geral-tecnica.md`](./00-visao-geral-tecnica.md) | Nomes, repositórios, stack, os dois fluxos de dinheiro |
| [`docs/mnvma/01-backend.md`](./01-backend.md) | Multi-tenant, entidades, endpoints, jobs, segurança |
| [`docs/mnvma/02-frontend-pwa.md`](./02-frontend-pwa.md) | PWA, offline, telas por sprint, identidade visual |
| [`docs/mnvma/03-mercado-pago.md`](./03-mercado-pago.md) | Assinaturas, webhooks, dunning, Pix |
| [`docs/mnvma/04-roadmap-execucao.md`](./04-roadmap-execucao.md) | Sprints, riscos, custo, o que já está pronto |

---

## Rodando localmente

Precisa de Node 20+ e um MySQL 8 em `localhost`.

```bash
# 1. Backend
cd mnvma-api
cp .env.example .env          # DATABASE_URL já aponta para mysql://sa@localhost/cuidador
npm install
npm run migration:run         # cria o schema e as travas de tenant
npm run seed                  # popula o catálogo de planos
npm run start:dev             # http://localhost:3000/v1  ·  Swagger em /docs

# Jobs agendados rodam sozinhos às 3h, 8h, 9h e de hora em hora. Para disparar
# na hora: trial, documentos, limpeza, cobranca, cobranca-sync
npm run job -- trial

# Cobrança: sem MP_ACCESS_TOKEN a API sobe normal e a tela de planos avisa que o
# checkout não está disponível. Com as credenciais no .env, espelhe os planos na
# conta do Mercado Pago (--dry mostra o que faria, sem criar nada):
npm run seed:mp -- --dry

# 2. Painel (outro terminal)
cd mnvma-care
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173
```

---

## Onde está o dinheiro

Existem **dois** dinheiros no produto, e confundi-los é o erro mais caro possível:

```text
Fluxo A  (obrigatório, Sprint 7)
Cuidador/Empresa ──mensalidade──▶ Mercado Pago ──▶ conta do MNVMA
   Assinaturas recorrentes (preapproval). Este dinheiro é seu.

Fluxo B  (opcional, depois do MVP)
Família do idoso ──cobrança──▶ Mercado Pago do assinante ──▶ conta dele
   Pix/link emitido em nome do tenant via OAuth. Este dinheiro NÃO é seu.
```

Detalhes, armadilhas e checklist de go-live em
[`docs/mnvma/03-mercado-pago.md`](./03-mercado-pago.md).

---

## O que já funciona

- Cadastro de conta individual e empresarial, com trial de 14 dias
- Login, sessão com refresh rotativo e detecção de token roubado
- Esqueci a senha por e-mail: link de 1 hora, uso único, banco só com o hash
- 7 papéis com permissões granulares e módulos por tipo de conta
- Isolamento entre contas: repositório escopado + travas no MySQL + testes
- Bloqueio de escrita (nunca de leitura) quando a conta não está em dia
- Clientes, responsáveis, serviços e equipe de cuidadores
- Agenda em mês/semana/dia, com detecção de conflito de horário e escala em lote
- **Plantão concluído vira conta a receber e conta a pagar automaticamente** —
  é daí que a rentabilidade sai sozinha, sem digitar o mesmo número duas vezes
- Financeiro com baixa, previsto × realizado e fluxo de caixa
- Disponibilidade do cuidador e sugestão de quem pode cobrir um plantão
- Relatórios de rentabilidade e operação, com exportação para Excel
- PWA instalável, com tema claro/escuro e aviso de atualização
- E-mail transacional com transporte trocável — em desenvolvimento os links
  aparecem no terminal, sem conta em provedor nenhum
- Jobs que rodam sozinhos, com trava para não duplicar entre instâncias: fim do
  teste, documentos vencendo, limpeza de token morto, cobrança em atraso e
  reconciliação da assinatura

Do módulo empresarial, com tela e tudo:

- Equipe por convite: o convite sai por e-mail, o link vale poucos dias, o
  servidor guarda só o hash, reenviar mata o link anterior e o usuário só nasce
  quando alguém aceita
- Contratos com cobrança recorrente — a rodada do mês mostra a prévia antes de
  gravar, e rodar duas vezes não cobra duas vezes
- Escala em grade por semana, com a linha do que ficou descoberto em primeiro
  lugar, e repetição da semana inteira em um clique
- Documentos do cuidador com alerta do que vence — COREN e atestado vencidos são
  risco trabalhista no dia em que acontece um incidente
- Ocorrências que não somem: encerrar é registrar como foi resolvido

E a cobrança (Fluxo A) inteira:

- Tela de planos com o preço, os limites e o motivo de um plano não caber no uso
  atual — 40 cuidadores não entram no plano de 10, e a tela diz isso
- Checkout no Mercado Pago, e a volta dele esperando a confirmação
- **A conta só ativa pelo webhook, com assinatura HMAC conferida** — a URL de
  retorno do navegador não libera nada, senão qualquer um a montaria
- Cobrança recusada começa o dunning: avisos em D+3 e D+5, somente leitura no
  D+7, cancelamento no D+37 — e o pagamento que entra desfaz tudo sozinho
- Suspensão bloqueia escrita e nunca leitura: quem atrasou continua consultando
  e exportando o próprio histórico, e continua conseguindo pagar
- Cancelar mantém a conta funcionando até o fim do período já pago
- Limite de plano estourado devolve 402 com os dados do upgrade, e o painel abre
  o convite para mudar de plano em vez de um erro seco
- Extrato das cobranças na tela, com o motivo da recusa traduzido
- **Cupons de desconto**: percentual por N faturas, uma vez por conta, com teto
  de resgates, janela de validade e a opção de serem nominais — só os e-mails da
  lista usam. O valor descontado vai para o provedor e volta ao cheio sozinho
  quando as faturas com desconto acabam
- **Cupom de 100% não pede cartão**: a conta é liberada na hora, sem checkout, e
  vale até o prazo combinado. O sistema avisa três dias antes, um dia antes, e
  encerra na data — como fim de teste, sem falar em inadimplência

E o **MNVMA Core**, o painel do dono do SaaS — rota `/core/*` no mesmo app,
visível só para `SUPER_ADMIN`:

- Receita recorrente já com os cupons descontados, contas por situação,
  inadimplentes, testes terminando e eventos do provedor que ficaram parados
- Lista de contas com busca e filtros, e a ficha de cada cliente: assinatura,
  uso, pessoas, cobranças e cupons
- Suspender e reativar com motivo obrigatório, tudo registrado em
  `admin_actions` — quem fez, quando e por quê
- Criação e acompanhamento de cupons, incluindo os nominais

Falta tela para as substituições de cuidador (o backend já guarda o histórico) e
para o dashboard empresarial.

Verificado por 151 checagens de API ponta a ponta, mais as suítes e2e de
isolamento, de convites, de redefinição de senha, de cobrança, de cupons e do
MNVMA Core — cobrindo webhook falsificado, reenvio duplicado, evento fora de
ordem, evento órfão, conta suspensa que ainda precisa conseguir pagar, desconto
que precisa acabar na fatura certa, cortesia que precisa vencer e o painel do
dono do SaaS recusando o titular de uma conta cliente.

Próximo passo no [roadmap](./04-roadmap-execucao.md): criar a
aplicação na conta real do Mercado Pago, rodar `npm run seed:mp` e fazer o teste
de R$ 1,00 com estorno. O código está pronto; falta a conta.

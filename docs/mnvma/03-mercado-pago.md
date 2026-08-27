# MNVMA — Integração com o Mercado Pago

Toda a integração vive no backend (`mnvma-api`), nos módulos `billing/` e
`webhooks/`. O frontend só redireciona e mostra status.

> **Nota de manutenção:** o Mercado Pago muda campos e nomes de recurso com
> frequência. Os endpoints e payloads abaixo refletem o modelo atual da API de
> Assinaturas (Preapproval). Antes de codificar, confirme cada campo na
> documentação oficial e valide no ambiente de teste — o desenho do fluxo, dos
> estados e do webhook continua válido independentemente de detalhes de campo.

---

## 1. O que estamos cobrando

Recapitulando a seção 5 do documento de visão — são dois dinheiros distintos:

| | Fluxo A — mensalidade do MNVMA | Fluxo B — cobrança do assinante ao cliente dele |
|---|---|---|
| Quem paga | Cuidador / Empresa | Família do idoso |
| Quem recebe | **Você** | O assinante |
| Recurso do MP | **Assinaturas (Preapproval)** | Pix / Checkout via OAuth do assinante |
| Fase | 4 — obrigatório | 5 — opcional |
| Recorrência | Automática no cartão | Manual ou por contrato |

**Este documento trata majoritariamente do Fluxo A.** O Fluxo B está na seção 10.

---

## 2. Preparação da conta

1. Conta Mercado Pago **empresarial** no CNPJ da MNVMA (ou CPF, no começo).
2. Painel de desenvolvedores → **Suas integrações** → criar a aplicação
   `MNVMA SaaS`, modelo de negócio "Assinaturas / Pagamentos online".
3. Anotar os dois conjuntos de credenciais:

| Credencial | Onde vive | Pode vazar? |
|---|---|---|
| `PUBLIC_KEY` (teste e produção) | Frontend, `VITE_MP_PUBLIC_KEY` | Sim, é pública |
| `ACCESS_TOKEN` (teste e produção) | Backend, `MP_ACCESS_TOKEN` | **Nunca.** Dá acesso total à conta |
| Assinatura secreta do webhook | Backend, `MP_WEBHOOK_SECRET` | Nunca |
| `CLIENT_ID` / `CLIENT_SECRET` (OAuth) | Backend, só no Fluxo B | Nunca |

4. Configurar a **URL de notificação** na aplicação:
   `https://api.mnvma.com.br/v1/webhooks/mercadopago`, marcando os eventos de
   pagamento e de assinatura.
5. Criar **usuários de teste** (vendedor e comprador). O comprador de teste
   precisa ser diferente da conta vendedora — o Mercado Pago recusa autopagamento.

SDK: `npm i mercadopago` (SDK oficial Node). Alternativa perfeitamente válida é
chamar a API REST direto com `fetch` — menos mágica, menos surpresa em upgrade.
Recomendo um `MercadoPagoClient` próprio, fino, com `Idempotency-Key`, timeout,
retry com backoff e log de todo request/response (sem o token).

---

## 3. Modelagem dos planos

Cada `Plan` do MNVMA vira um **plano de assinatura** no Mercado Pago
(`preapproval_plan`) e guarda o id retornado em `plan.mpPreapprovalPlanId`.

```text
MNVMA                                Mercado Pago
─────────────────────────────────    ─────────────────────────────────
individual_free   R$    0            (não vai para o MP — só controle interno)
individual_pro    R$  49,90/mês  →   preapproval_plan  2c938084...
company_start     R$ 149,00/mês  →   preapproval_plan  2c938084...
company_pro       R$ 349,00/mês  →   preapproval_plan  2c938084...
company_business  R$ 799,00/mês  →   preapproval_plan  2c938084...
company_enterprise                   sob consulta — cobrança manual/boleto
```

Criação (script de seed, uma vez por ambiente):

```http
POST https://api.mercadopago.com/preapproval_plan
Authorization: Bearer {MP_ACCESS_TOKEN}
Content-Type: application/json

{
  "reason": "MNVMA Care — Individual Pro",
  "auto_recurring": {
    "frequency": 1,
    "frequency_type": "months",
    "transaction_amount": 49.90,
    "currency_id": "BRL",
    "free_trial": { "frequency": 14, "frequency_type": "days" }
  },
  "back_url": "https://app.mnvma.com.br/billing/retorno",
  "payment_methods_allowed": {
    "payment_types": [{ "id": "credit_card" }, { "id": "debit_card" }]
  }
}
```

Regras importantes:

- **Recorrência automática exige cartão.** Pix e boleto não sustentam débito
  recorrente em assinatura. Se você quiser vender para quem não tem cartão, o
  caminho é gerar uma cobrança Pix mensal e conciliar o pagamento — trate isso
  como um provider interno `manual_pix`, com o mesmo modelo `Subscription`.
- Mudança de preço de um plano existente afeta assinantes ativos. Prática segura:
  criar um plano novo e migrar quem aceitar, mantendo o antigo como legado
  (`plan.isActive = false`, mas assinaturas continuam).
- O plano `individual_free` não existe no Mercado Pago. É só `Subscription` com
  `status = ACTIVE` e `plan.priceCents = 0`.

---

## 4. Fluxo de assinatura

```text
1. Usuário abre /planos no MNVMA Care
2. Front: GET /v1/billing/plans           → planos + limites + preço
3. Usuário escolhe → POST /v1/billing/subscribe { planId }
4. API cria preapproval no Mercado Pago com external_reference = subscription.id
5. API devolve { checkoutUrl: init_point }
6. Front redireciona (window.location.href) para o Mercado Pago
7. Usuário paga no ambiente do MP
8. MP redireciona para APP_URL/billing/retorno?preapproval_id=...
9. EM PARALELO: MP chama o webhook → API ativa a assinatura   ← fonte da verdade
10. Front faz polling em GET /v1/billing/subscription até virar ACTIVE
```

**A ativação acontece pelo webhook, nunca pelo retorno do navegador.** O
`back_url` só existe para dar boa experiência: o usuário pode fechar o navegador
antes de voltar, ou voltar antes do webhook chegar. Quem manda é o webhook.

### `POST /v1/billing/subscribe`

```ts
// billing.service.ts (esboço)
async subscribe(tenantId: string, planId: string, user: User) {
  const plan = await this.plans.findOneOrFail({ where: { id: planId } })
  const sub  = await this.subscriptions.findOneOrFail({ where: { tenantId } })

  const body = {
    preapproval_plan_id: plan.mpPreapprovalPlanId,
    reason: `MNVMA Care — ${plan.name}`,
    external_reference: sub.id,               // ← a ponte MP ↔ MNVMA
    payer_email: user.email,
    back_url: `${process.env.APP_URL}/billing/retorno`,
    status: 'pending',
  }

  const mp = await this.mpClient.post('/preapproval', body, {
    idempotencyKey: `sub-${sub.id}-${plan.id}`,
  })

  sub.mpPreapprovalId = mp.id
  sub.planId = plan.id
  await this.subscriptions.save(sub)

  return { checkoutUrl: mp.init_point }
}
```

`external_reference` é o que permite achar a assinatura quando o webhook chegar.
Sem ele, você recebe um id do Mercado Pago e não sabe de quem é.

### Consulta e alterações

```http
GET  /preapproval/{id}                 → estado atual
PUT  /preapproval/{id}  { "status": "paused" }      → pausar
PUT  /preapproval/{id}  { "status": "cancelled" }   → cancelar
PUT  /preapproval/{id}  { "auto_recurring": { "transaction_amount": 349.00 } }  → mudar valor
```

Estados no Mercado Pago: `pending` → `authorized` → `paused` / `cancelled`.

---

## 5. Webhooks

Rota **pública**, sem JWT e sem contexto de tenant (o tenant é descoberto pelo
`external_reference`). Precisa de quatro coisas: validar assinatura, responder
rápido, ser idempotente e sobreviver a evento fora de ordem.

### 5.1 Validação da assinatura

O Mercado Pago envia os headers `x-signature` (formato `ts=...,v1=...`) e
`x-request-id`. A verificação monta um manifesto e compara o HMAC-SHA256:

```ts
// webhooks/mercadopago.signature.ts
export function verifyMpSignature(req: Request, secret: string): boolean {
  const signature = req.header('x-signature') ?? ''
  const requestId = req.header('x-request-id') ?? ''
  const dataId    = String(req.query['data.id'] ?? req.query.id ?? '')

  const parts = Object.fromEntries(
    signature.split(',').map(p => p.split('=').map(s => s.trim()) as [string, string]),
  )
  const ts = parts.ts, v1 = parts.v1
  if (!ts || !v1) return false

  // janela de 5 minutos contra replay
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex')

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
}
```

Assinatura inválida → grava `WebhookEvent` com `signatureOk = false` e responde
**401**. Nunca processar payload não verificado: qualquer um pode fazer POST
nessa URL e "ativar" a própria assinatura.

### 5.2 Recepção

```ts
@Public()
@Post('mercadopago')
@HttpCode(200)
async receive(@Req() req: Request, @Body() body: MpNotification) {
  const ok = verifyMpSignature(req, process.env.MP_WEBHOOK_SECRET!)

  const event = await this.events.upsertReturning({          // idempotência
    provider: 'mercadopago',
    eventId: String(body.data?.id ?? body.id),
    type: body.type ?? body.topic,
    payload: body,
    signatureOk: ok,
  })

  if (!ok) throw new UnauthorizedException()
  if (event.processedAt) return { received: true }           // duplicado, ignora

  await this.queue.add('mp-webhook', { eventId: event.id })  // processa fora do request
  return { received: true }
}
```

Responder **200 em menos de 500ms** e processar fora do request. Timeout faz o
Mercado Pago reenviar, e reenvio somado a processamento lento vira cobrança
duplicada no seu banco.

Idempotência garantida pelo índice único `(provider, eventId, type)` da entity
`WebhookEvent`.

> **Como ficou de verdade — sem Redis.** O esboço acima usa fila com broker. Na
> implementação, a durabilidade veio do banco: `webhook_events` guarda o evento
> antes de qualquer processamento, o `WebhookQueue` (fila em processo) roda o
> trabalho depois do 200, e o job `billing.sincronizacao` varre de hora em hora
> tudo que ficou com `processed_at` nulo — inclusive o que morreu junto com o
> processo. O ganho de um broker aqui seria paralelismo e retentativa com
> backoff, nenhum dos dois necessário no volume de um SaaS começando; o custo
> seria um serviço a mais para pagar, monitorar e restaurar. Quando o volume
> pedir, a troca é local: só o `WebhookQueue` muda.

### 5.3 Tipos que interessam

| `type` | Quando | O que fazer |
|---|---|---|
| `subscription_preapproval` | Assinatura criada, autorizada, pausada ou cancelada | Buscar `GET /preapproval/{id}` e sincronizar `Subscription.status` |
| `subscription_authorized_payment` | Cobrança recorrente processada | Registrar `SubscriptionPayment`, empurrar `currentPeriodEnd` |
| `payment` | Qualquer pagamento avulso | Buscar `GET /v1/payments/{id}`; no Fluxo B, baixar `AccountReceivable` |
| `subscription_preapproval_plan` | Plano alterado | Sincronizar `Plan` |

**Sempre reconsultar a API.** O corpo do webhook diz "algo mudou no recurso X" —
o estado confiável vem do `GET`. Isso também resolve evento fora de ordem: se
chegar `paused` depois de `authorized`, a consulta devolve o estado real.

### 5.4 Processamento

```ts
// jobs/mp-webhook.processor.ts
async process({ eventId }: { eventId: string }) {
  const event = await this.events.findOneOrFail({ where: { id: eventId } })

  switch (event.type) {
    case 'subscription_preapproval': {
      const mp  = await this.mpClient.get(`/preapproval/${event.eventId}`)
      const sub = await this.subscriptions.findOne({
        where: [{ id: mp.external_reference }, { mpPreapprovalId: mp.id }],
      })
      if (!sub) return this.flagOrphan(event, mp)

      sub.status = MP_TO_MNVMA[mp.status]              // authorized→ACTIVE, paused→PAST_DUE...
      sub.mpPreapprovalId = mp.id
      sub.mpPayerId = String(mp.payer_id ?? '')
      sub.nextChargeAt = mp.next_payment_date ? new Date(mp.next_payment_date) : null
      await this.subscriptions.save(sub)
      await this.tenants.syncStatusFromSubscription(sub)   // libera ou bloqueia o painel
      break
    }

    case 'subscription_authorized_payment': {
      const pay = await this.mpClient.get(`/authorized_payments/${event.eventId}`)
      await this.registerPayment(pay)
      if (pay.status === 'approved') await this.markPaid(pay)
      if (pay.status === 'rejected') await this.startDunning(pay)
      break
    }
  }

  event.processedAt = new Date()
  await this.events.save(event)
}
```

Evento órfão (não achou assinatura) não pode ser descartado em silêncio: grava
com erro, alerta no Sentry e aparece no MNVMA Core para conferência manual.

---

## 6. Estados da assinatura e da conta

```text
        cadastro
           │
           ▼
        TRIAL ──── 14 dias ────▶ assinou? ── não ──▶ EXPIRED (somente leitura)
           │                        │
           │ assinou                sim
           ▼                        ▼
        ACTIVE ◀──── pagamento aprovado ────┐
           │                                │
           │ pagamento recusado             │ pagou
           ▼                                │
       PAST_DUE ── 7 dias de carência ──────┘
           │
           │ não pagou
           ▼
       SUSPENDED ──── 30 dias ────▶ CANCELED (dados retidos 90 dias)
           │
           └── reativou ──▶ ACTIVE
```

Efeito de cada estado no painel:

| Status | Login | Leitura | Escrita | Aviso na tela |
|---|---|---|---|---|
| `TRIAL` | Sim | Sim | Sim | Contador de dias restantes |
| `ACTIVE` | Sim | Sim | Sim | Nenhum |
| `PAST_DUE` | Sim | Sim | Sim | Faixa vermelha + link de pagamento |
| `SUSPENDED` | Sim | Sim | **Não** | Tela de reativação |
| `CANCELED` | Sim | Só exportação | Não | Exportar dados / reativar |

Suspenso **nunca** perde dados nem perde acesso de leitura. Quem pagou nove meses
e atrasou um não pode ser trancado para fora do próprio histórico — além de
injusto, isso destrói a chance de reconquistar o cliente.

### Dunning (job `billing:dunning`)

| Dia | Ação |
|---|---|
| D+0 | Pagamento recusado → `PAST_DUE`, e-mail "não conseguimos processar" + faixa no app |
| D+1 | Mercado Pago tenta de novo automaticamente |
| D+3 | 2º e-mail + push |
| D+5 | 3º e-mail: "sua conta será suspensa em 2 dias" |
| D+7 | `SUSPENDED`, escrita bloqueada |
| D+37 | `CANCELED`, agenda cancelamento no Mercado Pago |

---

## 7. Trial

Trial controlado **do lado do MNVMA** (`tenant.trialEndsAt`), não do Mercado
Pago. Motivo: você quer conceder, estender e conversar com o cliente sobre trial
sem depender do provedor. O `free_trial` do plano no MP é usado apenas quando a
pessoa assina já dentro do período — para não cobrar duas vezes pelo mesmo mês.

- 14 dias, sem pedir cartão no cadastro (menos atrito, mais conversão).
- Avisos em D-3 e D-1 (`billing:trial-ending`).
- Fim do trial sem assinatura → `EXPIRED`: leitura e exportação liberadas,
  escrita bloqueada. Dados preservados.

---

## 8. Upgrade, downgrade e cancelamento

| Ação | Implementação |
|---|---|
| Upgrade | `PUT /preapproval/{id}` com o novo valor; aplica imediatamente e cobra proporcional no próximo ciclo |
| Downgrade | Agenda para o fim do período vigente; valida antes se o uso atual cabe nos limites do plano menor (ex.: 40 cuidadores não cabem no START) |
| Cancelamento | `PUT /preapproval/{id} { status: "cancelled" }`; conta segue `ACTIVE` até `currentPeriodEnd`, depois `CANCELED` |
| Reativação | Nova assinatura, reaproveitando o mesmo `Subscription` |

Antes de qualquer downgrade, `GET /v1/billing/plans` já devolve, por plano, se o
uso atual cabe — assim o frontend desabilita a opção com a explicação certa.

---

## 9. Testes

Nunca testar com dinheiro real nem com a conta de produção.

1. Credenciais de **teste** em dev e staging.
2. Usuários de teste (vendedor e comprador) criados no painel.
3. Cartões de teste do Mercado Pago para Brasil; o **nome do titular** controla o
   resultado da autorização (`APRO` aprova, `OTHE` recusa, e há códigos
   específicos para fundos insuficientes, CVV inválido etc.). Confirme a lista
   vigente na documentação — ela muda.
4. Webhook local: `ngrok http 3000` e apontar a URL de notificação da aplicação
   de teste para o túnel.
5. Cenários que **precisam** de teste automatizado:
   - Assinatura aprovada → `ACTIVE`
   - Assinatura recusada → continua `TRIAL`/`PAST_DUE`, sem liberar o painel
   - Webhook duplicado → processa uma vez só
   - Webhook com assinatura inválida → 401 e nada muda no banco
   - Webhook fora de ordem (`cancelled` antes de `authorized`) → estado final correto
   - Recorrência recusada → dunning começa
   - Cancelamento → acesso até o fim do período
   - Webhook órfão → registrado e alertado, sem quebrar

---

## 9.1 Cupons de desconto

Desconto percentual sobre a mensalidade, por um número definido de faturas.
Vive em `billing/coupons.service.ts`; a administração é do dono do SaaS
(`/v1/admin/coupons`, só `SUPER_ADMIN`).

### O modelo

| Tabela | O que guarda |
|---|---|
| `coupons` | O cupom: percentual, por quantas faturas, janela de resgate, teto |
| `coupon_targets` | Quem pode usar. **Vazio = cupom aberto**; com linha, vira nominal |
| `coupon_redemptions` | O uso por conta, com o benefício **congelado** no resgate |

Duas datas que parecem a mesma e não são:

- `expiresAt` fecha a **janela de resgate** — até quando dá para digitar o código.
- `maxInvoices` é a **duração do benefício** — por quantas faturas ele vale.

Um cupom "50% nas 3 primeiras faturas, resgatável até 31/12" é
`discountPercent: 50, maxInvoices: 3, expiresAt: 2026-12-31`.

### As regras, e por que cada uma existe

| Regra | Onde mora | Por que |
|---|---|---|
| Uma vez por conta | Chave única `(coupon_id, tenant_id)` | É o banco recusando a segunda linha, não um `if` que um caminho novo pode esquecer |
| Teto global (`maxRedemptions`) | `SELECT … FOR UPDATE` na linha do cupom | Sem a trava, duas contas pegam o último lugar de uma campanha de cem ao mesmo tempo |
| Nominal (`coupon_targets`) | E-mail ou conta | A campanha costuma vir antes do cadastro: você manda o código para dez pessoas que ainda não têm conta |
| Só primeira assinatura | `firstSubscriptionOnly` | Sem isso, "50% nos 3 primeiros meses" vira desconto perpétuo: cancela e reassina a cada três meses |
| Tipo de conta | `tenantType` | Campanha de plano empresarial não deve valer para conta individual |
| Piso de R$ 1,00 | `VALOR_MINIMO_CENTAVOS` | 99% sobre R$ 49,90 daria R$ 0,50, abaixo do que o cartão aceita — melhor recusar com explicação do que falhar no checkout |
| Benefício congelado | Cópias em `coupon_redemptions` | Corrigir o cupom depois não pode mudar o que foi combinado com quem já resgatou |

### O desconto no provedor

A assinatura recorrente do Mercado Pago tem **valor fixo**. "50% nas 3
primeiras faturas" é, na prática:

1. criar o `preapproval` com `auto_recurring.transaction_amount` já descontado —
   **sem** `preapproval_plan_id`, que carrega o preço cheio e cobraria sem
   desconto;
2. contar as faturas aprovadas no webhook (`consumirFatura`);
3. na última, `PUT /preapproval/{id}` com o valor cheio.

Esquecer o passo 3 é dar desconto para sempre sem ninguém perceber — por isso
ele tem teste (`test/coupons.e2e-spec.ts`) e log de erro próprio quando a
chamada ao provedor falha.

### Cupom de 100% — cortesia

É um **caminho diferente**, não uma variação do checkout: com desconto total não
existe valor a cobrar, e o provedor sequer aceita assinatura de R$ 0. Então:

- não há checkout, não há cartão, não há webhook;
- a conta vira `ACTIVE` na hora, com `currentPeriodEnd` no fim dos ciclos;
- `maxInvoices` passa a significar **meses de cortesia**;
- o job `billing.sincronizacao` avisa em D-3 e D-1 e encerra na data;
- ao encerrar, a conta vai para **`EXPIRED`**, não `SUSPENDED` — ninguém deixou
  de pagar, e a mensagem que o cliente lê não pode sugerir inadimplência.

Quem converte para plano pago antes do fim tem a cortesia encerrada na hora da
ativação: não se continua de graça depois de começar a pagar.

### Rotas

| Rota | Quem |
|---|---|
| `POST /v1/billing/coupons/preview` | Assinante — confere o código sem gastá-lo |
| `POST /v1/billing/subscribe` com `couponCode` | Assinante — resgata ao contratar |
| `GET/POST/PATCH/DELETE /v1/admin/coupons` | `SUPER_ADMIN` |
| `POST /v1/admin/coupons/:id/targets` | `SUPER_ADMIN` — lista de quem pode usar |
| `GET /v1/admin/coupons/:id/redemptions` | `SUPER_ADMIN` — quem resgatou |

A prévia usa **a mesma validação** do resgate. É isso que impede a tela de
prometer um desconto que a assinatura vai recusar meio segundo depois.

### Armadilhas

| Armadilha | Consequência | Prevenção |
|---|---|---|
| Mandar `preapproval_plan_id` junto com cupom | Cobra o valor cheio e o cliente vê o desconto na tela | O corpo usa `auto_recurring` explícito quando há cupom |
| Esquecer de voltar ao valor cheio | Desconto eterno, invisível no extrato | Teste e2e + log de erro na falha |
| Resgatar antes do checkout dar certo | Cupom gasto por quem desistiu | Resgate nasce `PENDING` e só vale na ativação; retomar o checkout reaproveita a mesma linha |
| Contar o teto sem travar a linha | Campanha de 100 vira 101 | `SELECT … FOR UPDATE` antes de gravar |
| Cortesia sem prazo | Conta de graça para sempre | `endsAt` obrigatório e job horário conferindo |
| Cortesia encerrada como inadimplência | Cliente acusado de não pagar o que nunca foi cobrado | Conta vai para `EXPIRED` |

---

## 10. Fluxo B — o assinante cobrando os clientes dele (Fase 5)

Só depois do MVP funcionando e vendendo. Duas peças:

### 10.1 Conectar a conta do assinante (OAuth)

```text
Empresa clica "Conectar Mercado Pago" no MNVMA Care
        ↓
Redirect: https://auth.mercadopago.com/authorization
          ?client_id=...&response_type=code&platform_id=mp
          &state=<tenantId assinado>&redirect_uri=https://api.mnvma.com.br/v1/billing/mp/callback
        ↓
Callback com ?code=... → POST /oauth/token
        ↓
Guarda access_token + refresh_token DO TENANT, criptografados (AES-256-GCM,
chave em env, jamais em claro no banco). Renova pelo refresh antes de expirar.
```

`state` assinado é obrigatório — sem isso, dá para conectar a conta Mercado Pago
de uma vítima a outro tenant.

### 10.2 Emitir cobrança Pix da Conta a Receber

```http
POST https://api.mercadopago.com/v1/payments
Authorization: Bearer {access_token DO TENANT}
X-Idempotency-Key: {receivable.id}

{
  "transaction_amount": 6500.00,
  "description": "Cuidados — competência 08/2026",
  "payment_method_id": "pix",
  "external_reference": "{receivable.id}",
  "notification_url": "https://api.mnvma.com.br/v1/webhooks/mercadopago",
  "date_of_expiration": "2026-09-05T23:59:59.000-03:00",
  "payer": { "email": "familia@exemplo.com", "first_name": "Maria",
             "identification": { "type": "CPF", "number": "12345678909" } }
}
```

A resposta traz o QR Code em
`point_of_interaction.transaction_data.qr_code` (copia e cola) e
`qr_code_base64` (imagem). O MNVMA mostra os dois e envia por e-mail/WhatsApp ao
responsável financeiro do cliente.

Quando o webhook `payment` chegar com `status: approved`, o backend acha o
`AccountReceivable` pelo `external_reference` e faz a baixa automática —
substituindo a baixa manual do MVP.

### 10.3 Monetização adicional (opcional, bem depois)

Com o modelo de marketplace, é possível reter uma taxa por transação
(`application_fee`) sobre a cobrança que o assinante emite. Exige habilitação de
marketplace na conta e informação clara nos termos de uso. **Não é MVP e não é
prioridade** — o MRR da assinatura vem primeiro.

---

## 11. Checklist de go-live

O código está pronto; o que resta depende da conta real no Mercado Pago.

- [ ] Credenciais de **produção** nas variáveis do provedor (nunca no repositório)
- [ ] `MP_WEBHOOK_SECRET` de produção configurado e a validação testada com payload real
      — a API se recusa a subir em produção com `MP_ACCESS_TOKEN` e sem este segredo
- [ ] URL de notificação em produção apontando para `api.mnvma.com.br`
- [ ] Planos criados na conta de produção: `npm run seed:mp` grava o
      `mpPreapprovalPlanId` de cada um (use `-- --dry` antes para conferir)
- [ ] Teste ponta a ponta com **cartão real e valor de R$ 1,00**, seguido de estorno
- [x] Job de reconciliação rodando de hora em hora (`billing.sincronizacao`) —
      rede de segurança se um webhook se perder
- [ ] Alerta no Sentry para webhook com erro e para evento órfão — hoje o órfão
      sai como `logger.error` com o id do recurso; falta plugar o Sentry
- [ ] Painel MNVMA Core mostrando MRR e inadimplentes conferindo com o extrato do MP
- [x] E-mails transacionais de cobrança escritos: assinatura ativada, cobrança
      recusada (com o motivo traduzido), atraso, conta suspensa e cancelamento
- [ ] Termos de uso e política de privacidade publicados e linkados no checkout
- [ ] Nota fiscal: definir o processo (emissão manual no começo é aceitável; automatizar depois)

### O que já está implementado

| Peça | Onde |
|---|---|
| Cliente HTTP com timeout, `Idempotency-Key` e retentativa | `billing/mercadopago/mercadopago.client.ts` |
| Validação da assinatura HMAC | `billing/mercadopago/mercadopago.signature.ts` |
| Rota pública do webhook | `billing/webhooks.controller.ts` |
| Processamento e idempotência | `billing/webhook-processor.service.ts` |
| Assinar, trocar de plano, cancelar, sincronizar | `billing/billing.service.ts` |
| Estado da assinatura → estado da conta | `billing/subscription-status.service.ts` |
| 402 com dados de upgrade | `billing/plan-limit.guard.ts` |
| Dunning e reconciliação | `jobs/dunning.job.ts`, `jobs/billing-sync.job.ts` |
| Telas | `mnvma-care/src/features/billing/` |
| Cenários da seção 9 | `mnvma-api/test/billing.e2e-spec.ts` |

---

## 12. Armadilhas conhecidas

| Armadilha | Consequência | Prevenção |
|---|---|---|
| Ativar conta pelo `back_url` | Qualquer um monta a URL de retorno e usa de graça | Ativar **só** pelo webhook validado |
| Não validar `x-signature` | Endpoint público vira botão de "assinatura grátis" | HMAC + janela de tempo + `timingSafeEqual` |
| Webhook sem idempotência | Reenvio duplica pagamento e período | Índice único `(provider, eventId, type)` |
| Processar dentro do request | Timeout → reenvio → efeito em cascata | Responder 200 e processar na fila |
| Confiar no corpo do webhook | Estado desatualizado ou fora de ordem | Sempre `GET` no recurso |
| Valor em `float` | Centavos somem em soma e comparação | `numeric(12,2)` / centavos inteiros |
| `ACCESS_TOKEN` no frontend | Acesso total à conta vazado no bundle | Só `PUBLIC_KEY` no front |
| Achar que Pix faz recorrência | Assinatura nunca cobra sozinha | Recorrência = cartão; Pix = cobrança mensal gerada |
| Testar em produção | Cobrança real em cliente real | Credenciais de teste + usuários de teste |
| Suspender cortando o login | Cliente irritado e sem como pagar | Suspensão bloqueia escrita, nunca leitura |

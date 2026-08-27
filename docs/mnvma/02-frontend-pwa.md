# MNVMA Care — Planejamento do Frontend (PWA)

Repositório: `mnvma-care` · Deploy: Vercel / Netlify / Cloudflare Pages · Domínio: `app.mnvma.com.br`

O painel se chama **MNVMA Care**. É o que aparece no ícone instalado no celular.

---

## 1. Princípios

1. **É um app de celular que também roda no desktop.** O cuidador usa em pé, na
   rua, com uma mão, muitas vezes sem sinal. Mobile-first não é estilo, é o caso
   de uso real.
2. **Instalável.** Requisito explícito: a pessoa adiciona à tela inicial e abre
   como aplicativo, sem barra de navegador.
3. **Funciona offline no essencial.** Ver a agenda do dia, ver dados do cliente e
   registrar check-in precisam funcionar sem rede.
4. **Zero regra de negócio no cliente.** Valor, margem e limite de plano vêm
   calculados da API. O front só exibe e coleta.
5. **Build 100% estático.** Nenhum servidor Node em produção no frontend.

---

## 2. Estrutura de pastas

```text
mnvma-care/
├── public/
│   ├── icons/                 # 192, 512, maskable, apple-touch-icon
│   ├── screenshots/           # exigidos para o prompt rico de instalação
│   └── offline.html
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── router.tsx         # rotas + lazy loading por módulo
│   │   ├── providers.tsx      # QueryClient, Auth, Theme, Toast
│   │   └── guards.tsx         # RequireAuth, RequireRole, RequireModule, RequirePlan
│   ├── shared/
│   │   ├── api/               # client HTTP, interceptors, tipos gerados do Swagger
│   │   ├── ui/                # shadcn/ui + componentes MNVMA
│   │   ├── hooks/             # useOnline, useInstallPrompt, useSyncQueue
│   │   ├── lib/               # datas, moeda, máscara CPF/telefone
│   │   └── offline/           # Dexie, fila de mutações
│   ├── features/
│   │   ├── auth/
│   │   ├── onboarding/        # tipo de conta, primeiros passos
│   │   ├── dashboard/
│   │   ├── customers/
│   │   ├── caregivers/
│   │   ├── agenda/
│   │   ├── shifts/
│   │   ├── schedules/
│   │   ├── services/
│   │   ├── contracts/
│   │   ├── finance/
│   │   ├── reports/
│   │   ├── documents/
│   │   ├── settings/
│   │   ├── billing/           # planos, checkout Mercado Pago, faturas
│   │   └── core/              # MNVMA Core (Super Admin)
│   └── styles/
├── vite.config.ts
├── .env.example
└── index.html
```

Cada `feature/` é autocontida: `pages/`, `components/`, `api.ts`, `schema.ts`,
`types.ts`. Import cruzado entre features é proibido — o que for compartilhado
sobe para `shared/`.

---

## 3. Navegação

### Individual (§4 do planejamento de produto)

```text
Início · Agenda (Minha Agenda, Plantões, Disponibilidade) · Clientes ·
Financeiro (A Receber, A Pagar, Receitas, Despesas, Fluxo de Caixa) ·
Relatórios · Perfil
```

### Empresa (§5)

```text
Dashboard · Operação (Clientes, Cuidadores, Escalas, Plantões, Serviços,
Disponibilidade, Ocorrências, Substituições) · Gestão (Contratos, Equipes,
Documentos) · Financeiro · Relatórios · Administração
```

O menu é **gerado a partir de `/v1/auth/me`** (tipo de conta + permissões). Um
item some se a permissão não existe. Nada é decidido por constante no código.

### Layout responsivo

| Largura | Navegação |
|---|---|
| < 768px | Bottom tab bar com 5 itens (Início, Agenda, Clientes, Financeiro, Mais) + FAB "novo plantão" |
| ≥ 768px | Sidebar recolhível |

Em telefone, listas viram **cards**, não tabelas com scroll horizontal. Tabela
densa só a partir de tablet.

---

## 4. Camada de API

```ts
// shared/api/client.ts
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,   // https://api.mnvma.com.br/v1
  withCredentials: true,                    // cookie de refresh
})

api.interceptors.request.use((cfg) => {
  const token = useAuth.getState().accessToken   // memória, nunca localStorage
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(undefined, async (error) => {
  if (error.response?.status === 401 && !error.config._retry) {
    error.config._retry = true
    await useAuth.getState().refresh()          // fila única: 1 refresh por vez
    return api(error.config)
  }
  if (error.response?.status === 402) openUpgradeModal(error.response.data)
  if (error.response?.status === 403 && error.response.data?.code === 'TENANT_SUSPENDED')
    redirect('/billing/suspenso')
  return Promise.reject(error)
})
```

**Onde guardar o token:** access token em memória (Zustand, sem persistir),
refresh em cookie `httpOnly` emitido pela API. `localStorage` com JWT é
vulnerável a XSS — e o app manipula dado pessoal de saúde.

Consequência prática: ao abrir o PWA, o app não tem access token; ele chama
`POST /auth/refresh` na inicialização e mostra um splash até resolver.

Tipos: gerados do Swagger com `openapi-typescript` num script `npm run api:types`.
Assim o contrato do backend não se perde no caminho.

---

## 5. PWA — configuração

### 5.1 Plugin

```ts
// vite.config.ts
VitePWA({
  registerType: 'prompt',           // usuário decide atualizar; evita recarregar no meio de um formulário
  injectRegister: 'auto',
  manifest: {
    id: '/',
    name: 'MNVMA Care',
    short_name: 'MNVMA',
    description: 'Gestão de clientes, plantões, escalas e financeiro para cuidadores.',
    lang: 'pt-BR',
    dir: 'ltr',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    orientation: 'portrait-primary',
    background_color: '#0B1220',
    theme_color: '#0B1220',
    categories: ['business', 'productivity', 'medical'],
    icons: [
      { src: '/icons/icon-192.png',     sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png',     sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      { src: '/screenshots/mobile-agenda.png',  sizes: '1080x1920', type: 'image/png', form_factor: 'narrow' },
      { src: '/screenshots/desktop-dash.png',   sizes: '1920x1080', type: 'image/png', form_factor: 'wide' },
    ],
    shortcuts: [
      { name: 'Novo plantão',  url: '/plantoes/novo' },
      { name: 'Minha agenda',  url: '/agenda' },
      { name: 'A receber',     url: '/financeiro/receber' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api/],
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      { // GETs de leitura: rede primeiro, cache como rede de segurança
        urlPattern: ({ url }) => url.origin === API_ORIGIN && /\/(customers|services|caregivers)/.test(url.pathname),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'mnvma-api-cache',
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 },
          cacheableResponse: { statuses: [200] },
        },
      },
      { // agenda: precisa abrir instantâneo e revalidar
        urlPattern: ({ url }) => url.origin === API_ORIGIN && url.pathname.includes('/shifts'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'mnvma-shifts', expiration: { maxEntries: 200 } },
      },
      { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/, handler: 'CacheFirst',
        options: { cacheName: 'fonts', expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 } } },
    ],
  },
})
```

**Nunca cachear:** `/auth/*`, `/billing/*`, `/webhooks/*` e qualquer `POST`.
Dado financeiro e de sessão não pode vir de cache velho.

### 5.2 Offline

Três níveis:

| Nível | Comportamento |
|---|---|
| Shell | HTML/CSS/JS sempre em cache — o app abre sem rede |
| Leitura | Agenda dos próximos 7 dias, clientes e serviços em IndexedDB, com carimbo "atualizado há X" |
| Escrita | Fila de mutações no IndexedDB, reenviada com Background Sync quando a rede volta |

```ts
// shared/offline/queue.ts
type QueuedMutation = {
  id: string                 // uuid gerado no cliente = Idempotency-Key
  url: string
  method: 'POST' | 'PATCH'
  body: unknown
  createdAt: number
  tries: number
}
```

O `id` da fila vira o header `Idempotency-Key` da requisição — o backend dedupe.
É o que impede um check-in reenviado três vezes de virar três registros.

Escritas permitidas offline no MVP: **check-in, check-out, ocorrência e
observação de plantão**. Criar plantão, editar valor e qualquer coisa financeira
exigem rede — conflito de dinheiro offline não vale o risco.

A UI mostra sempre o estado: banner "Você está offline — 3 alterações
aguardando envio" e um ícone por item pendente.

### 5.3 Instalação

- Interceptar `beforeinstallprompt`, guardar o evento e mostrar um banner
  discreto ("Instale o MNVMA Care no seu celular") depois do 2º login — não no
  primeiro segundo.
- **iOS não dispara `beforeinstallprompt`.** Detectar Safari iOS e mostrar
  instrução ilustrada: Compartilhar → Adicionar à Tela de Início.
- Página `/instalar` com o passo a passo por plataforma, linkada no menu Perfil.
- Detectar `display-mode: standalone` para esconder o banner de quem já instalou.

### 5.4 Atualização de versão

Com `registerType: 'prompt'`, quando há build novo aparece um toast
"Nova versão disponível — Atualizar". Ao aceitar: `updateSW(true)`. Nunca
recarregar sozinho: o usuário pode estar no meio do cadastro de um cliente.

### 5.5 Push (Fase 3)

Web Push com VAPID. Assinatura enviada para `POST /v1/notifications/subscribe`.
Usos: plantão sem cuidador, plantão em 1h, conta vencendo, documento vencendo.
No iOS, push em PWA só funciona **depois de instalado** — o pedido de permissão
tem que vir depois da instalação, não antes.

---

## 6. Telas por sprint

### Sprint 1 — Fundação
- Login, cadastro, esqueci a senha
- Onboarding: escolha do tipo de conta (Individual / Empresa)
- Shell do app: navegação, tema claro/escuro, avatar, sair

### Sprint 2 — Cadastros
- Clientes: lista com busca, formulário, detalhe com abas (Dados, Responsáveis, Plantões, Financeiro)
- Serviços: lista + formulário com valor de venda, custo e margem calculada ao vivo

### Sprint 3 — Agenda
- Calendário mês / semana / dia (`@fullcalendar/react` ou grade própria)
- Criação rápida de plantão (bottom sheet no celular)
- Disponibilidade: grade semanal + bloqueios por período
- Detalhe do plantão com mudança de status

### Sprint 4 — Financeiro
- A Receber / A Pagar: lista com filtro de período e status, chips de total
- Baixa de pagamento (modal com data e valor)
- Fluxo de caixa com gráfico e filtros Hoje/Semana/Mês/Ano/Personalizado

### Sprint 5 — Dashboard e relatórios
- Dashboard individual: próximo plantão em destaque, cards do mês, resultado
- Relatórios com exportação CSV/PDF

### Sprint 6 — Empresa
- [x] Equipe: acessos, papéis e convites (`/equipe`)
- [x] Aceite do convite, página pública em `/convite/:token` — fora dos dois
      guards, porque quem já está logado em outra conta também precisa abrir
- [x] Contratos: lista, cadastro, situação e rodada de cobrança com prévia
- [x] Escala em grade (cuidador × dia), com a linha "Sem cuidador" em primeiro
      lugar e repetição da semana inteira
- [x] Documentos da equipe (`/documentos`), abrindo no que precisa de atenção
- [x] Ocorrências (`/ocorrencias`): registro, encerramento e reabertura
- [ ] Arrastar plantão de um cuidador para outro dentro da grade
- [ ] Cuidadores: perfil com abas (Documentos, Disponibilidade, Escalas, Plantões, Pagamentos, Ocorrências)
- [ ] Plantão empresarial com bloco de rentabilidade (cobrado, custo, margem, %)
- [ ] Substituição: lista de candidatos disponíveis

> O link do convite aparece **uma vez só**, na resposta de criar ou reenviar — o
> servidor guarda apenas o hash do token. Enquanto não existe envio de e-mail, é
> a caixa de "copiar link" que faz o convite chegar; por isso ela ocupa espaço na
> tela e diz, com todas as letras, que não vai aparecer de novo.

### Sprint 7 — Billing
- Tela de Planos com comparativo
- Botão assinar → redirect para o Mercado Pago
- Retorno `/billing/retorno` com estado de processamento
- Assinatura: plano atual, próxima cobrança, histórico, cancelar
- Faixas de aviso: trial acabando, pagamento atrasado, conta suspensa

### Sprint 8 — MNVMA Core
- Métricas (contas ativas, individuais, empresas, trial, MRR, inadimplentes, cancelamentos)
- Lista de tenants com filtro, detalhe, suspender/reativar, impersonar
- Editor de planos e limites

---

## 7. Estados que não podem faltar

Todo módulo de lista precisa dos cinco estados desenhados:

1. **Carregando** — skeleton, nunca spinner de tela cheia
2. **Vazio** — ilustração + texto + botão de ação primária
3. **Erro** — mensagem clara + "Tentar novamente"
4. **Offline** — dado em cache + selo "atualizado há X min"
5. **Sem permissão** — item nem aparece; se acessado por URL, tela explicativa

E os estados de conta: `TRIAL` (contador de dias), `PAST_DUE` (faixa vermelha
com link de pagamento), `SUSPENDED` (só leitura + tela de reativação).

---

## 8. Identidade visual

```text
Nome no manifest:  MNVMA Care
Marca no header:   MNVMA · Care
Tom:               profissional, calmo, alto contraste, tipografia grande
```

| Token | Valor | Uso |
|---|---|---|
| `--brand` | `#1D4ED8` | Ações primárias |
| `--bg` | `#0B1220` (dark) / `#F8FAFC` (light) | Fundo |
| `--success` | `#16A34A` | Recebido, concluído |
| `--warning` | `#D97706` | Pendente, trial acabando |
| `--danger` | `#DC2626` | Vencido, falta, suspenso |
| `--muted` | `#64748B` | Texto secundário |

Regras: fonte base 16px (o público não é jovem em média), alvo de toque mínimo
44×44px, contraste AA, `safe-area-inset` respeitado em iPhone com notch, e
**valores monetários sempre em `pt-BR`** com `Intl.NumberFormat`.

Semântica de status (cor + rótulo, nunca só cor):

```text
Planejado ▪ cinza      Confirmado ▪ azul     Em andamento ▪ âmbar
Concluído ▪ verde      Cancelado ▪ cinza     Falta ▪ vermelho
```

---

## 9. Variáveis de ambiente

```bash
# .env.example — mnvma-care
VITE_API_URL=https://api.mnvma.com.br/v1
VITE_APP_NAME="MNVMA Care"
VITE_MP_PUBLIC_KEY=            # só a PUBLIC KEY, nunca o access token
VITE_VAPID_PUBLIC_KEY=
VITE_SENTRY_DSN=
VITE_ENV=production
```

Tudo com prefixo `VITE_` vai para o bundle e é **público**. Qualquer segredo aqui
é um segredo vazado.

---

## 10. Deploy

**Vercel** (ou Netlify / Cloudflare Pages — os três servem, é build estático):

```json
// vercel.json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/sw.js",
      "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }] },
    { "source": "/manifest.webmanifest",
      "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
  ]
}
```

`sw.js` **nunca** pode ser cacheado pelo CDN — senão o usuário fica preso numa
versão antiga para sempre. Esse é o erro clássico de PWA em produção.

Checklist de deploy:
- HTTPS obrigatório (service worker não roda sem)
- Domínio `app.mnvma.com.br` apontado, com `www` redirecionando
- CORS da API liberado para essa origem exata
- Preview por PR automático
- Lighthouse PWA ≥ 90 no CI (`@lhci/cli`), bloqueando merge se cair

---

## 11. Qualidade

| Item | Ferramenta |
|---|---|
| Lint/format | ESLint + Prettier |
| Componentes | Vitest + Testing Library |
| E2E | Playwright — login, criar cliente, criar plantão, baixar recebimento, assinar plano |
| Offline | Teste Playwright com `context.setOffline(true)` validando a fila |
| Acessibilidade | `axe-core` no E2E |
| Bundle | `rollup-plugin-visualizer`, orçamento de 250KB gzip na rota inicial |

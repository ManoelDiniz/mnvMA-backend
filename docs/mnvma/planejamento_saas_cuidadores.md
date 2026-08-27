# SaaS de Gestão para Cuidadores

## 1. Visão do produto

Plataforma SaaS para dois públicos:

1. **Cuidador Independente** — profissional que trabalha por conta própria e precisa organizar clientes, agenda, plantões e financeiro.
2. **Empresa de Cuidadores** — empresa que administra vários cuidadores, clientes, escalas, plantões e operações financeiras.

A mesma plataforma atende os dois modelos, mas a experiência, permissões e funcionalidades são adaptadas ao tipo de conta.

## 2. Proposta de valor

### Cuidador Independente

> Organize seus clientes, plantões, agenda e dinheiro em um só lugar.

Recursos principais:
- Clientes e responsáveis
- Agenda e plantões
- Disponibilidade
- Serviços
- Contas a receber e a pagar
- Receitas e despesas
- Fluxo de caixa
- Relatórios

### Empresa

> Gerencie cuidadores, clientes, escalas, plantões e financeiro em um só lugar.

Recursos principais:
- Clientes e responsáveis
- Cuidadores
- Escalas
- Plantões
- Disponibilidade
- Serviços
- Contratos
- Substituições
- Ocorrências
- Contas a receber e a pagar
- Receitas e despesas
- Rentabilidade
- Usuários e permissões
- Relatórios

## 3. Tipo de conta

No cadastro inicial:

```text
TIPO DE CONTA

○ Cuidador Independente
○ Empresa
```

O tipo de conta determina a experiência e os módulos disponíveis.

---

# 4. Cuidador Independente

Estrutura:

```text
CUIDADOR
├── Clientes
├── Agenda
├── Plantões
├── Disponibilidade
├── Serviços
├── Contas a Receber
├── Contas a Pagar
├── Receitas
├── Despesas
└── Relatórios
```

## Dashboard individual

Indicadores:
- Próximo plantão
- Plantões no mês
- Horas trabalhadas
- A receber
- Recebido
- Despesas
- Resultado

Exemplo:

```text
Olá, João

PRÓXIMO PLANTÃO
Maria da Silva
25/08 — 07:00 → 19:00

ESTE MÊS
18 plantões
216 horas

R$ 4.800 a receber
R$ 3.900 recebidos
R$ 650 despesas

Resultado: R$ 3.250
```

## Menu individual

```text
INÍCIO

AGENDA
├── Minha Agenda
├── Plantões
└── Disponibilidade

CLIENTES
└── Meus Clientes

FINANCEIRO
├── Contas a Receber
├── Contas a Pagar
├── Receitas
├── Despesas
└── Fluxo de Caixa

RELATÓRIOS
PERFIL
```

## Clientes

Campos:
- Nome
- CPF
- Data de nascimento
- Telefone
- E-mail
- Endereço
- Cidade/Estado
- Observações
- Status

### Responsáveis

Um cliente pode possuir vários responsáveis:
- Nome
- Parentesco
- Telefone
- E-mail
- Responsável principal
- Responsável financeiro
- Contato de emergência

## Agenda

Visualizações:
- Dia
- Semana
- Mês

Ações:
- Criar plantão
- Editar
- Cancelar
- Visualizar cliente
- Visualizar valores

## Disponibilidade

O cuidador informa os horários em que pode trabalhar.

Também deve ser possível registrar indisponibilidade temporária, por exemplo:

```text
15/09/2026 → 20/09/2026
Motivo: Viagem
```

## Plantões

Campos:
- Cliente
- Cuidador
- Serviço
- Data
- Hora inicial
- Hora final
- Valor
- Status
- Observação

Status:
- Planejado
- Confirmado
- Em andamento
- Concluído
- Cancelado
- Falta

## Financeiro individual

### Contas a receber

- Cliente
- Serviço
- Plantão
- Competência
- Valor
- Vencimento
- Recebimento
- Status

### Contas a pagar

- Categoria
- Descrição
- Valor
- Vencimento
- Pagamento
- Status

Categorias podem incluir transporte, alimentação, material, cursos, equipamentos, impostos e outros.

## Relatórios individuais

- Plantões
- Horas trabalhadas
- Clientes atendidos
- Receitas
- Despesas
- Contas recebidas
- Contas pendentes
- Contas vencidas
- Resultado
- Rentabilidade por cliente

---

# 5. Empresa de Cuidadores

Estrutura:

```text
EMPRESA
├── Clientes
├── Responsáveis
├── Cuidadores
├── Equipes
├── Serviços
├── Escalas
├── Plantões
├── Contratos
├── Ocorrências
├── Substituições
├── Documentos
├── Contas a Receber
├── Contas a Pagar
├── Receitas
├── Despesas
└── Relatórios
```

## Dashboard empresarial

### Operação
- Clientes ativos
- Cuidadores ativos
- Plantões hoje
- Plantões da semana
- Plantões sem cuidador
- Plantões confirmados
- Plantões pendentes
- Substituições

### Financeiro
- A receber
- Recebido
- A pagar
- Pago
- Receita do mês
- Despesas do mês
- Resultado
- Inadimplência

## Menu empresarial

```text
DASHBOARD

OPERAÇÃO
├── Clientes
├── Cuidadores
├── Escalas
├── Plantões
├── Serviços
├── Disponibilidade
├── Ocorrências
└── Substituições

GESTÃO
├── Contratos
├── Equipes
└── Documentos

FINANCEIRO
├── Contas a Receber
├── Contas a Pagar
├── Receitas
├── Despesas
└── Fluxo de Caixa

RELATÓRIOS
├── Financeiro
├── Clientes
├── Cuidadores
├── Plantões
├── Escalas
└── Rentabilidade

ADMINISTRAÇÃO
├── Usuários
├── Permissões
├── Empresa
└── Configurações
```

## Cuidadores empresariais

Cadastro:
- Nome
- CPF
- Telefone
- E-mail
- Endereço
- Data de nascimento
- Tipo de contratação
- Valor/hora
- Valor do plantão
- Status

Documentos:
- Documentos pessoais
- Certificados
- Cursos
- Contratos
- Comprovantes

Controlar validade e situação dos documentos.

## Perfil do cuidador

Abas:
- Perfil
- Documentos
- Disponibilidade
- Escalas
- Plantões
- Pagamentos
- Ocorrências

## Escalas

Visualização por dia, semana e mês, com filtros por cliente, cuidador, serviço e status.

Exemplo:

```text
             SEG    TER    QUA    QUI    SEX
07-19        JOÃO   JOÃO   ANA    ANA    CARLOS
19-07        ANA    CARLOS JOÃO   JOÃO   ANA
```

## Plantão empresarial

Cada plantão deve separar:
- Valor cobrado do cliente
- Valor pago ao cuidador
- Outros custos
- Margem

Exemplo:

```text
Valor cobrado: R$ 300
Valor do cuidador: R$ 180
Outros custos: R$ 20
Resultado: R$ 100
Margem: 33,3%
```

## Substituição

Quando um cuidador não puder realizar o plantão, o sistema deve permitir procurar profissionais disponíveis.

Critérios futuros:
- Disponibilidade
- Distância
- Experiência
- Histórico com o cliente
- Avaliação
- Valor
- Carga horária

## Check-in e check-out

Segunda fase. Registrar início e fim do plantão e calcular horas trabalhadas.

Possibilidades futuras:
- GPS
- Foto
- Assinatura
- Confirmação do responsável

## Ocorrências

Tipos:
- Falta
- Atraso
- Problema com cliente
- Problema com familiar
- Substituição
- Incidente
- Outros

Campos:
- Data
- Cliente
- Cuidador
- Plantão
- Tipo
- Descrição
- Responsável
- Status
- Anexos

---

# 6. Serviços

Exemplos:
- Cuidador 12h
- Cuidador 24h
- Cuidador diurno
- Cuidador noturno
- Acompanhante
- Atendimento eventual

Dados:
- Nome
- Código
- Unidade
- Valor de venda
- Valor do profissional
- Margem estimada
- Horas
- Status

---

# 7. Contratos

Campos:
- Número
- Cliente
- Serviço
- Data inicial
- Data final
- Valor
- Frequência
- Forma de pagamento
- Status

O contrato poderá gerar automaticamente cobranças recorrentes.

---

# 8. Financeiro

## Contas a receber

Campos:
- Cliente
- Contrato
- Plantão
- Serviço
- Competência
- Valor
- Vencimento
- Data de recebimento
- Status

Status:
- Previsto
- Pendente
- Recebido
- Vencido
- Cancelado

## Contas a pagar

Campos:
- Cuidador
- Fornecedor
- Categoria
- Plantão
- Valor
- Vencimento
- Data de pagamento
- Status

Categorias:
- Pagamento de cuidador
- Transporte
- Alimentação
- Material
- Impostos
- Aluguel
- Sistema
- Contabilidade
- Marketing
- Outros

## Fluxo de caixa

```text
Receitas
R$ 85.400

Despesas
R$ 52.800

Saldo
R$ 32.600
```

Filtros:
- Hoje
- Semana
- Mês
- Ano
- Período personalizado

---

# 9. Integração operação + financeiro

Regra central do sistema:

```text
PLANTÃO
   │
   ├── Valor cobrado → CONTA A RECEBER
   │
   └── Valor do cuidador → CONTA A PAGAR
```

Exemplo:

```text
Receita: R$ 300
Custo: R$ 180
Margem: R$ 120
```

Isso permite medir automaticamente a rentabilidade.

---

# 10. Rentabilidade

Relatório principal para empresas:

```text
CLIENTE        RECEITA      CUSTO       RESULTADO
--------------------------------------------------
Maria          R$ 6.500     R$ 4.200     R$ 2.300
João           R$ 5.800     R$ 4.000     R$ 1.800
Carlos         R$ 8.000     R$ 6.200     R$ 1.800
```

Permitir análise por:
- Cliente
- Serviço
- Cuidador
- Contrato
- Período

---

# 11. Relatórios

## Operacionais
- Plantões realizados
- Plantões cancelados
- Plantões descobertos
- Faltas
- Atrasos
- Substituições
- Horas trabalhadas

## Cuidadores
- Plantões
- Horas
- Valor a pagar
- Clientes atendidos
- Faltas
- Avaliação

## Clientes
- Atendimentos
- Plantões
- Valor contratado
- Valor recebido
- Pendências
- Rentabilidade

## Financeiros
- Receitas
- Despesas
- Contas a pagar
- Contas a receber
- Fluxo de caixa
- Inadimplência
- Resultado

---

# 12. Usuários e permissões

## Administrador
Acesso total.

## Gerente
- Clientes
- Cuidadores
- Escalas
- Plantões
- Financeiro
- Relatórios

## Coordenador
- Clientes
- Cuidadores
- Escalas
- Plantões
- Disponibilidade
- Substituições
- Ocorrências

## Financeiro
- Contas a receber
- Contas a pagar
- Receitas
- Despesas
- Fluxo de caixa
- Relatórios financeiros

## Cuidador
Acesso apenas aos próprios dados:
- Perfil
- Disponibilidade
- Escala
- Plantões
- Check-in
- Check-out
- Ocorrências
- Pagamentos

---

# 13. Portais futuros

## Portal do cuidador

- Minha agenda
- Meus plantões
- Disponibilidade
- Pagamentos
- Documentos
- Ocorrências
- Perfil

## Portal do cliente/responsável

- Escala
- Cuidador
- Atendimentos
- Ocorrências
- Documentos
- Cobranças
- Pagamentos
- Avaliação

---

# 14. Avaliação

Após o atendimento:

```text
COMO FOI O ATENDIMENTO?

★★★★★

Comentário:
________________________
```

Indicadores:
- Média
- Avaliações positivas
- Reclamações
- Histórico

---

# 15. Documentos

## Cuidador
- Documentos pessoais
- Certificados
- Cursos
- Contratos
- Comprovantes

## Cliente
- Documentos
- Contratos
- Autorizações
- Outros

Controlar validade, status e responsável.

---

# 16. Notificações

Alertas:
- Plantão sem cuidador
- Plantão próximo
- Falta
- Substituição
- Documento vencendo
- Conta a pagar vencendo
- Conta a receber vencendo
- Cliente inadimplente
- Contrato próximo do vencimento

Canais futuros:
- Sistema
- E-mail
- WhatsApp
- Push

---

# 17. Multi-tenant

A plataforma deve separar completamente os dados de cada conta.

```text
SAAS
│
├── EMPRESA A
│   ├── Clientes
│   ├── Cuidadores
│   ├── Escalas
│   └── Financeiro
│
├── EMPRESA B
│   ├── Clientes
│   ├── Cuidadores
│   ├── Escalas
│   └── Financeiro
│
└── INDIVIDUAIS
    ├── Cuidador A
    ├── Cuidador B
    └── Cuidador C
```

Todas as entidades devem possuir vínculo com o tenant, por exemplo `tenant_id`.

O backend deve impedir acesso cruzado entre contas.

---

# 18. Migração Individual → Empresarial

Um cuidador independente pode crescer e passar a administrar outros profissionais.

Exemplo:

```text
ANTES
João
8 clientes
1 profissional

DEPOIS
Empresa do João
15 cuidadores
80 clientes
```

A migração deve preservar:
- Clientes
- Histórico
- Plantões
- Receitas
- Despesas
- Documentos
- Contratos

E liberar:
- Cuidadores
- Escalas
- Equipes
- Usuários
- Permissões
- Gestão empresarial

---

# 19. Planos comerciais

## Individual

Voltado para cuidadores independentes.

### Individual Free
Possíveis limites:
- Clientes
- Plantões
- Histórico
- Recursos financeiros

### Individual Pro
- Clientes ilimitados
- Plantões ilimitados
- Financeiro completo
- Relatórios
- Documentos
- Notificações

## Empresarial

Modelo recomendado:

```text
Preço base
+
Quantidade de cuidadores ativos
```

Ou pacotes:

```text
START
Até 10 cuidadores

PRO
Até 30 cuidadores

BUSINESS
Até 100 cuidadores

ENTERPRISE
100+ cuidadores
```

Os limites devem ser configuráveis pelo Super Admin.

---

# 20. Assinaturas

Controlar:
- Plano
- Data de assinatura
- Valor
- Ciclo
- Status
- Próxima cobrança
- Vencimento
- Cancelamento
- Trial

Status:
- Trial
- Ativo
- Atrasado
- Suspenso
- Cancelado

---

# 21. Super Admin

Painel exclusivo do proprietário do SaaS.

## Indicadores

```text
CLIENTES ATIVOS
128

INDIVIDUAIS
96

EMPRESAS
32

TRIAL
21

MRR
R$ 18.400

INADIMPLENTES
5

CANCELAMENTOS
3
```

## Gestão
- Contas
- Empresas
- Cuidadores individuais
- Planos
- Assinaturas
- Pagamentos
- Uso do sistema
- Logs
- Suporte

---

# 22. Futuro marketplace

Não faz parte do MVP, mas a arquitetura pode permitir que empresas encontrem cuidadores independentes para cobrir plantões.

```text
EMPRESA
   │
   ▼
PLANTÃO DESCOBERTO
   │
   ▼
CUIDADORES INDEPENDENTES
   ├── Disponibilidade
   ├── Distância
   ├── Avaliação
   ├── Experiência
   └── Valor
```

---

# 23. Roadmap

## Fase 1 — MVP Individual

- [ ] Cadastro
- [ ] Login
- [ ] Perfil
- [ ] Clientes
- [ ] Responsáveis
- [ ] Agenda
- [ ] Plantões
- [ ] Disponibilidade
- [ ] Serviços
- [ ] Contas a receber
- [ ] Contas a pagar
- [ ] Receitas
- [ ] Despesas
- [ ] Dashboard
- [ ] Relatórios básicos

## Fase 2 — MVP Empresarial

- [ ] Cadastro empresarial
- [ ] Cuidadores
- [ ] Escalas
- [ ] Plantões empresariais
- [ ] Contratos
- [ ] Serviços
- [ ] Substituições
- [ ] Ocorrências
- [ ] Usuários
- [ ] Permissões
- [ ] Financeiro empresarial
- [ ] Rentabilidade

## Fase 3 — Operação avançada

- [ ] Check-in
- [ ] Check-out
- [ ] Portal do cuidador
- [ ] Documentos
- [ ] Avaliações
- [ ] Notificações
- [ ] Fotos
- [ ] Assinaturas

## Fase 4 — SaaS

- [ ] Planos
- [ ] Trial
- [ ] Assinaturas
- [ ] Cobrança recorrente
- [ ] Super Admin
- [ ] Controle de uso
- [ ] Suspensão automática
- [ ] Migração Individual → Empresarial

## Fase 5 — Expansão

- [ ] PWA
- [ ] Aplicativo
- [ ] WhatsApp
- [ ] Push
- [ ] Marketplace
- [ ] API pública
- [ ] Integrações

---

# 24. Fluxo principal — Individual

```text
CADASTRO
   ↓
PERFIL
   ↓
CLIENTES
   ↓
SERVIÇOS
   ↓
AGENDA
   ↓
PLANTÃO
   ↓
ATENDIMENTO
   ├── RECEITA
   └── DESPESA
          ↓
       RESULTADO
          ↓
       RELATÓRIO
```

# 25. Fluxo principal — Empresarial

```text
EMPRESA
   ├── CLIENTES
   │      └── CONTRATOS
   ├── CUIDADORES
   │      └── DISPONIBILIDADE
   └──────────────┐
                  ↓
                ESCALA
                  ↓
                PLANTÃO
                  ├── CUIDADOR → CUSTO
                  └── CLIENTE   → RECEITA
                              ↓
                           MARGEM
                              ↓
                           RELATÓRIOS
```

---

# 26. Regras de negócio

## Individual

- O cuidador administra a própria agenda.
- Seus clientes pertencem à sua conta.
- Seus plantões geram seus recebimentos.
- Suas despesas são independentes.
- Não possui equipe de cuidadores.
- Pode migrar para conta empresarial.

## Empresarial

- A empresa possui vários cuidadores.
- Um cuidador pode participar de vários plantões.
- Um cliente pode possuir vários plantões.
- Um plantão possui um cuidador responsável.
- Um plantão pode ser substituído.
- Valor cobrado e custo do cuidador devem ser separados.
- O financeiro pode ser gerado a partir da operação.
- Usuários podem ter permissões diferentes.

---

# 27. Indicadores principais

## Individual

```text
Plantões no mês
Horas trabalhadas
Receita
Despesas
A receber
A pagar
Resultado
Média por plantão
Média por cliente
```

## Empresarial

```text
Clientes ativos
Cuidadores ativos
Plantões
Plantões descobertos
Substituições
Horas trabalhadas
Receita
Despesas
Custo com cuidadores
A receber
A pagar
Inadimplência
Resultado
Margem
```

---

# 28. Arquitetura conceitual

Entidades iniciais sugeridas:

```text
Tenant
User
Subscription
Plan

Customer
CustomerResponsible

Caregiver
CaregiverAvailability
CaregiverDocument

Service
Contract

Schedule
Shift
Attendance
Occurrence
Substitution

AccountReceivable
AccountPayable
Revenue
Expense
CashFlow

Notification
Attachment
AuditLog
```

Os nomes podem ser adaptados ao padrão do projeto.

---

# 29. Segurança

Como o sistema pode armazenar informações pessoais e informações relacionadas a cuidados, considerar desde o início:

- Controle de acesso
- Permissões
- Isolamento por tenant
- Logs de auditoria
- Histórico de alterações
- Controle de documentos
- Sessões seguras
- Senhas com hash
- Backup
- Exportação de dados
- Exclusão de dados

Informações sensíveis devem ser acessíveis somente por usuários autorizados.

---

# 30. Prioridade de desenvolvimento

### Prioridade 1 — Fundação

- [ ] Multi-tenant
- [ ] Autenticação
- [ ] Tipo de conta
- [ ] Individual
- [ ] Empresarial
- [ ] Usuários
- [ ] Permissões

### Prioridade 2 — Operação

- [ ] Clientes
- [ ] Cuidadores
- [ ] Serviços
- [ ] Agenda
- [ ] Plantões
- [ ] Disponibilidade
- [ ] Escalas

### Prioridade 3 — Financeiro

- [ ] Contas a receber
- [ ] Contas a pagar
- [ ] Receitas
- [ ] Despesas
- [ ] Fluxo de caixa

### Prioridade 4 — Gestão

- [ ] Dashboard
- [ ] Relatórios
- [ ] Rentabilidade
- [ ] Contratos
- [ ] Ocorrências
- [ ] Substituições

### Prioridade 5 — Recursos avançados

- [ ] Check-in
- [ ] Check-out
- [ ] Portal do cuidador
- [ ] Documentos
- [ ] Notificações

### Prioridade 6 — SaaS

- [ ] Planos
- [ ] Trial
- [ ] Assinaturas
- [ ] Super Admin
- [ ] Cobrança automática

---

# 31. MVP comercial definitivo

## Individual

- [ ] Login
- [ ] Cadastro
- [ ] Clientes
- [ ] Agenda
- [ ] Plantões
- [ ] Disponibilidade
- [ ] Serviços
- [ ] Contas a receber
- [ ] Contas a pagar
- [ ] Receitas
- [ ] Despesas
- [ ] Dashboard
- [ ] Relatórios

## Empresarial

- [ ] Cadastro da empresa
- [ ] Usuários
- [ ] Permissões
- [ ] Clientes
- [ ] Cuidadores
- [ ] Serviços
- [ ] Disponibilidade
- [ ] Escalas
- [ ] Plantões
- [ ] Contas a receber
- [ ] Contas a pagar
- [ ] Receitas
- [ ] Despesas
- [ ] Dashboard
- [ ] Relatórios
- [ ] Rentabilidade

## Plataforma

- [ ] Multi-tenant
- [ ] Planos
- [ ] Trial
- [ ] Assinatura
- [ ] Super Admin

---

# 32. Visão final

```text
                         SAAS
                          │
             ┌────────────┴────────────┐
             │                         │
       INDEPENDENTE                EMPRESA
             │                         │
        Meus clientes              Clientes
        Minha agenda              Cuidadores
        Meus plantões             Escalas
        Meu financeiro             Plantões
        Meu resultado              Contratos
                                   Financeiro
                                   Equipes
                                   Relatórios
                                      │
                                      ↓
                                  RENTABILIDADE
```

A plataforma deve permitir que o cuidador comece sozinho, organize sua operação no plano individual e, caso cresça, migre para o plano empresarial sem perder histórico, clientes e financeiro.

O núcleo do produto é:

**Cliente → Contrato → Serviço → Escala → Plantão → Cuidador → Custo → Receita → Resultado.**

Para o cuidador independente, a pergunta principal é:

> **Quanto eu trabalhei e quanto eu ganhei?**

Para a empresa, a pergunta principal é:

> **Quanto vendi, quanto custou e quanto realmente sobrou?**

import { ROLE_LABELS, type UserRole } from '../../../common/enums/user-role.enum'
import type { MailMessage } from '../mail.types'
import { esc, montarHtml, montarTexto, type Layout } from './layout'

/** Mensagem pronta menos o destinatário, que quem envia já conhece. */
export type Conteudo = Omit<MailMessage, 'to'>

function montar(tag: string, subject: string, layout: Layout): Conteudo {
  return { subject, tag, html: montarHtml(layout), text: montarTexto(layout) }
}

const negrito = (v: string) => `<strong style="color:#0f172a;">${esc(v)}</strong>`

// ─── Equipe ───────────────────────────────────────────────────────────────────

export function conviteDeEquipe(dados: {
  nome: string
  conta: string
  papel: UserRole
  convidadoPor: string | null
  url: string
  expiraEm: Date
}): Conteudo {
  return montar('convite', `Convite para entrar em ${dados.conta}`, {
    titulo: `${dados.nome}, você foi convidado para ${dados.conta}`,
    paragrafos: [
      dados.convidadoPor
        ? `${negrito(dados.convidadoPor)} convidou você para usar o MNVMA como ${negrito(ROLE_LABELS[dados.papel])}.`
        : `Você foi convidado para usar o MNVMA como ${negrito(ROLE_LABELS[dados.papel])}.`,
      'Clique no botão abaixo para escolher sua senha e entrar. Seu acesso já vem com as permissões desse papel.',
    ],
    botao: { texto: 'Aceitar convite', url: dados.url },
    rodape: [
      `O link vale até ${dataHoraLonga(dados.expiraEm)} e só pode ser usado uma vez.`,
      'Se você não esperava este convite, ignore este e-mail — nada é criado até alguém aceitar.',
    ],
  })
}

// ─── Senha ────────────────────────────────────────────────────────────────────

export function redefinicaoDeSenha(dados: { nome: string; url: string; expiraEm: Date }): Conteudo {
  return montar('reset-senha', 'Redefinir a senha do MNVMA', {
    titulo: 'Vamos criar uma senha nova',
    paragrafos: [
      `Olá, ${esc(dados.nome)}. Recebemos um pedido para redefinir a senha da sua conta no MNVMA.`,
      'Clique no botão abaixo para escolher uma senha nova.',
    ],
    botao: { texto: 'Redefinir senha', url: dados.url },
    rodape: [
      `O link vale até ${dataHoraLonga(dados.expiraEm)} e some depois do primeiro uso.`,
      'Se não foi você que pediu, não precisa fazer nada: sua senha atual continua valendo.',
    ],
  })
}

export function senhaAlterada(dados: { nome: string; quando: Date }): Conteudo {
  return montar('senha-alterada', 'Sua senha do MNVMA foi alterada', {
    titulo: 'Senha alterada',
    paragrafos: [
      `Olá, ${esc(dados.nome)}. A senha da sua conta no MNVMA foi alterada em ${dataHoraLonga(dados.quando)}.`,
      'Todas as sessões abertas foram encerradas — em todos os aparelhos você precisa entrar de novo.',
    ],
    rodape: [
      'Se não foi você, procure o titular da conta imediatamente: alguém tem acesso ao seu e-mail.',
    ],
  })
}

// ─── Conta e cobrança ─────────────────────────────────────────────────────────

export function boasVindas(dados: {
  nome: string
  conta: string
  url: string
  termina: Date | null
}): Conteudo {
  return montar('boas-vindas', 'Sua conta MNVMA está pronta', {
    titulo: `Bem-vindo, ${dados.nome}`,
    paragrafos: [
      `A conta ${negrito(dados.conta)} está criada e já dá para usar.`,
      dados.termina
        ? `Seu período de teste vai até ${dataLonga(dados.termina)}. Até lá, tudo liberado — clientes, agenda, plantões, financeiro e relatórios.`
        : 'Tudo liberado: clientes, agenda, plantões, financeiro e relatórios.',
      'Sugestão de primeiro passo: cadastre um cliente e monte a agenda da semana. Plantão concluído já vira conta a receber sozinho.',
    ],
    botao: { texto: 'Abrir o painel', url: dados.url },
  })
}

export function trialTerminando(dados: {
  nome: string
  conta: string
  dias: number
  termina: Date
  url: string
}): Conteudo {
  const quando = dados.dias <= 0 ? 'hoje' : dados.dias === 1 ? 'amanhã' : `em ${dados.dias} dias`

  return montar('trial-terminando', `Seu teste do MNVMA termina ${quando}`, {
    titulo: `O teste de ${dados.conta} termina ${quando}`,
    paragrafos: [
      `Olá, ${esc(dados.nome)}. Seu período de teste vai até ${dataLonga(dados.termina)}.`,
      'Assine para continuar lançando plantões e emitindo cobranças. Seus dados ficam onde estão de qualquer forma — quando o teste acaba a conta passa a só leitura, nada é apagado.',
    ],
    botao: { texto: 'Escolher um plano', url: dados.url },
  })
}

export function trialEncerrado(dados: { nome: string; conta: string; url: string }): Conteudo {
  return montar('trial-encerrado', 'Seu teste do MNVMA terminou', {
    titulo: `O teste de ${dados.conta} terminou`,
    paragrafos: [
      `Olá, ${esc(dados.nome)}. O período de teste acabou e a conta está em modo somente leitura.`,
      'Você continua vendo e exportando todo o histórico. Para voltar a lançar plantões, registrar pagamentos e emitir cobranças, é só assinar.',
    ],
    botao: { texto: 'Assinar agora', url: dados.url },
  })
}

// ─── Operação ─────────────────────────────────────────────────────────────────

export interface DocumentoVencendo {
  cuidador: string
  documento: string
  validade: Date
  /** Negativo quando já venceu. */
  diasRestantes: number
}

export function documentosVencendo(dados: {
  itens: DocumentoVencendo[]
  url: string
}): Conteudo {
  const vencidos = dados.itens.filter((i) => i.diasRestantes < 0)
  const aVencer = dados.itens.filter((i) => i.diasRestantes >= 0)

  const linha = (i: DocumentoVencendo) =>
    `• ${negrito(i.cuidador)} — ${esc(i.documento)}, ${
      i.diasRestantes < 0
        ? `vencido desde ${dataCurta(i.validade)}`
        : i.diasRestantes === 0
          ? 'vence hoje'
          : `vence em ${i.diasRestantes} dia${i.diasRestantes === 1 ? '' : 's'} (${dataCurta(i.validade)})`
    }`

  const paragrafos: string[] = [
    'COREN ou atestado vencido é risco trabalhista no dia em que acontece um incidente — e esse dia não avisa antes.',
  ]

  if (vencidos.length) {
    paragrafos.push(`${negrito('Já vencidos')}<br>${vencidos.map(linha).join('<br>')}`)
  }
  if (aVencer.length) {
    paragrafos.push(`${negrito('Vencendo em breve')}<br>${aVencer.map(linha).join('<br>')}`)
  }

  const total = dados.itens.length

  return montar(
    'documentos-vencendo',
    `${total} documento${total === 1 ? '' : 's'} de cuidador precisando de atenção`,
    {
      titulo: 'Documentos de cuidador para renovar',
      paragrafos,
      botao: { texto: 'Ver documentos', url: dados.url },
      rodape: ['Este aviso sai uma vez por dia enquanto existir documento nessa lista.'],
    },
  )
}

// ─── Assinatura ───────────────────────────────────────────────────────────────

export function assinaturaAtivada(dados: {
  nome: string
  conta: string
  plano: string
  proximaCobranca: Date | null
  url: string
}): Conteudo {
  return montar('assinatura-ativada', 'Assinatura do MNVMA confirmada', {
    titulo: 'Pagamento confirmado',
    paragrafos: [
      `Olá, ${esc(dados.nome)}. A assinatura de ${negrito(dados.conta)} está ativa no plano ${negrito(dados.plano)}.`,
      dados.proximaCobranca
        ? `A próxima cobrança acontece em ${dataLonga(dados.proximaCobranca)}, no mesmo cartão.`
        : 'A renovação é automática, no mesmo cartão.',
      'A conta voltou a liberar tudo: plantões, financeiro, relatórios e exportação.',
    ],
    botao: { texto: 'Ver assinatura', url: dados.url },
  })
}

export function cobrancaRecusada(dados: {
  nome: string
  conta: string
  valor: string
  motivo: string | null
  suspendeEm: Date
  url: string
}): Conteudo {
  return montar('cobranca-recusada', 'Não conseguimos processar sua cobrança', {
    titulo: 'A cobrança não passou',
    paragrafos: [
      `Olá, ${esc(dados.nome)}. A cobrança de ${negrito(`R$ ${dados.valor}`)} da conta ${negrito(dados.conta)} foi recusada pelo banco emissor.`,
      dados.motivo
        ? `Motivo informado: ${esc(explicarRecusa(dados.motivo))}.`
        : 'O motivo não foi informado pelo banco.',
      `O Mercado Pago tenta de novo automaticamente nos próximos dias. Se nenhuma tentativa passar até ${dataLonga(dados.suspendeEm)}, a conta passa a somente leitura — seus dados continuam todos aí, mas dá para consultar e exportar, não para lançar.`,
      'Trocar o cartão agora resolve em um minuto.',
    ],
    botao: { texto: 'Atualizar pagamento', url: dados.url },
  })
}

export function cobrancaEmAtraso(dados: {
  nome: string
  conta: string
  diasEmAtraso: number
  suspendeEm: Date
  url: string
}): Conteudo {
  const faltam = Math.max(
    0,
    Math.ceil((dados.suspendeEm.getTime() - Date.now()) / 86_400_000),
  )

  return montar('cobranca-atraso', `Sua conta MNVMA será suspensa em ${faltam} dia${faltam === 1 ? '' : 's'}`, {
    titulo: 'A assinatura continua pendente',
    paragrafos: [
      `Olá, ${esc(dados.nome)}. A conta ${negrito(dados.conta)} está com a mensalidade em aberto há ${dados.diasEmAtraso} dia${dados.diasEmAtraso === 1 ? '' : 's'}.`,
      `Em ${dataLonga(dados.suspendeEm)} ela passa a somente leitura. Nada é apagado: você continua vendo e exportando o histórico inteiro, mas para de conseguir lançar plantão e dar baixa em pagamento.`,
      'Se o cartão mudou, atualizar leva um minuto e a conta volta na hora.',
    ],
    botao: { texto: 'Regularizar assinatura', url: dados.url },
  })
}

export function contaSuspensa(dados: { nome: string; conta: string; url: string }): Conteudo {
  return montar('conta-suspensa', 'Sua conta MNVMA está em somente leitura', {
    titulo: `${dados.conta} está em somente leitura`,
    paragrafos: [
      `Olá, ${esc(dados.nome)}. Como a mensalidade continua em aberto, a conta passou a somente leitura.`,
      'Você não perdeu nada: clientes, plantões, financeiro e relatórios continuam todos aí, disponíveis para consulta e exportação. O que está bloqueado é a escrita.',
      'Assim que o pagamento entrar, tudo volta automaticamente — não é preciso pedir nada a ninguém.',
    ],
    botao: { texto: 'Regularizar agora', url: dados.url },
  })
}

export function assinaturaCancelada(dados: {
  nome: string
  conta: string
  ate: Date | null
  url: string
}): Conteudo {
  return montar('assinatura-cancelada', 'Assinatura do MNVMA cancelada', {
    titulo: 'Assinatura cancelada',
    paragrafos: [
      `Olá, ${esc(dados.nome)}. A assinatura de ${negrito(dados.conta)} foi cancelada e não haverá nova cobrança.`,
      dados.ate
        ? `A conta continua funcionando normalmente até ${dataLonga(dados.ate)}, que é o fim do período que você já pagou.`
        : 'A conta passa a somente leitura, com os dados preservados para consulta e exportação.',
      'Se mudar de ideia, é só assinar de novo — o histórico continua onde estava.',
    ],
    botao: { texto: 'Ver assinatura', url: dados.url },
  })
}

/**
 * O código de recusa do provedor não serve para o cliente ler:
 * `cc_rejected_insufficient_amount` não diz a ninguém o que fazer a seguir.
 * O que não estiver mapeado passa direto — é melhor um código estranho do que
 * uma explicação inventada.
 */
function explicarRecusa(codigo: string): string {
  const mapa: Record<string, string> = {
    cc_rejected_insufficient_amount: 'saldo ou limite insuficiente',
    cc_rejected_bad_filled_card_number: 'número do cartão incorreto',
    cc_rejected_bad_filled_date: 'data de validade incorreta',
    cc_rejected_bad_filled_security_code: 'código de segurança incorreto',
    cc_rejected_call_for_authorize: 'o banco pediu autorização do titular',
    cc_rejected_card_disabled: 'cartão desabilitado para compras online',
    cc_rejected_card_error: 'erro na leitura do cartão',
    cc_rejected_high_risk: 'recusado por análise de risco',
    cc_rejected_max_attempts: 'muitas tentativas seguidas',
    cc_rejected_other_reason: 'recusado pelo banco emissor',
  }
  return mapa[codigo] ?? codigo
}

// ─── Cortesia (cupom de 100%) ─────────────────────────────────────────────────

export function cortesiaAtivada(dados: {
  nome: string
  conta: string
  plano: string
  cupom: string
  ate: Date
  url: string
}): Conteudo {
  return montar('cortesia-ativada', 'Sua conta MNVMA está liberada', {
    titulo: 'Liberado, sem cobrança',
    paragrafos: [
      `Olá, ${esc(dados.nome)}. O cupom ${negrito(dados.cupom)} foi aplicado em ${negrito(dados.conta)}: o plano ${negrito(dados.plano)} está valendo sem nenhuma cobrança até ${dataLonga(dados.ate)}.`,
      'Não é preciso cadastrar cartão agora — não há o que cobrar. Avisamos com alguns dias de antecedência antes do prazo acabar.',
      'Até lá, tudo liberado: clientes, agenda, plantões, financeiro e relatórios.',
    ],
    botao: { texto: 'Abrir o painel', url: dados.url },
  })
}

export function cortesiaTerminando(dados: {
  nome: string
  conta: string
  dias: number
  termina: Date
  url: string
}): Conteudo {
  const quando = dados.dias <= 0 ? 'hoje' : dados.dias === 1 ? 'amanhã' : `em ${dados.dias} dias`

  return montar('cortesia-terminando', `Sua cortesia no MNVMA termina ${quando}`, {
    titulo: `A cortesia de ${dados.conta} termina ${quando}`,
    paragrafos: [
      `Olá, ${esc(dados.nome)}. O período sem cobrança da sua conta vai até ${dataLonga(dados.termina)}.`,
      'Para continuar lançando plantões e emitindo cobranças depois dessa data, escolha um plano. Seus dados ficam onde estão de qualquer forma — quando a cortesia acaba a conta passa a somente leitura, nada é apagado.',
    ],
    botao: { texto: 'Escolher um plano', url: dados.url },
  })
}

export function cortesiaEncerrada(dados: { nome: string; conta: string; url: string }): Conteudo {
  return montar('cortesia-encerrada', 'Sua cortesia no MNVMA terminou', {
    titulo: `A cortesia de ${dados.conta} terminou`,
    paragrafos: [
      `Olá, ${esc(dados.nome)}. O período sem cobrança acabou e a conta está em modo somente leitura.`,
      'Você continua vendo e exportando todo o histórico. Para voltar a lançar plantões, registrar pagamentos e emitir cobranças, é só assinar.',
    ],
    botao: { texto: 'Ver planos', url: dados.url },
  })
}

// ─── Datas ────────────────────────────────────────────────────────────────────
// Fuso fixo do produto: o e-mail é lido no Brasil e "vence dia 12" não pode
// virar "dia 11" porque o servidor roda em UTC.

const FUSO = 'America/Sao_Paulo'

function dataLonga(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: FUSO,
  }).format(d)
}

function dataCurta(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: FUSO }).format(d)
}

function dataHoraLonga(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: FUSO,
  }).format(d)
}

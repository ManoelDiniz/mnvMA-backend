/**
 * Moldura única de todos os e-mails.
 *
 * Tudo em CSS inline e tabela: Gmail, Outlook e Apple Mail descartam `<style>`
 * de cabeçalho e não conhecem flexbox. Nada de imagem externa — carregamento
 * remoto vem bloqueado por padrão e transformaria o cabeçalho num retângulo
 * vazio.
 */

const AZUL = '#1d4ed8'
const TINTA = '#0f172a'
const CINZA = '#475569'
const BORDA = '#e2e8f0'
const FUNDO = '#f1f5f9'

export interface Layout {
  /** Título grande dentro do card. */
  titulo: string
  /** Parágrafos do corpo, já escapados. */
  paragrafos: string[]
  botao?: { texto: string; url: string }
  /** Texto pequeno ao pé do card (validade do link, aviso de segurança). */
  rodape?: string[]
}

/** Escapa texto vindo do banco — nome de cuidador com `&` não pode quebrar o HTML. */
export function esc(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function montarHtml({ titulo, paragrafos, botao, rodape }: Layout): string {
  const corpo = paragrafos
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${CINZA};">${p}</p>`,
    )
    .join('')

  const cta = botao
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
         <tr><td style="border-radius:8px;background:${AZUL};">
           <a href="${botao.url}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(botao.texto)}</a>
         </td></tr>
       </table>
       <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${CINZA};">
         Se o botão não abrir, copie este endereço no navegador:<br>
         <span style="word-break:break-all;color:${AZUL};">${botao.url}</span>
       </p>`
    : ''

  const pe = (rodape ?? [])
    .map(
      (p) =>
        `<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#94a3b8;">${p}</p>`,
    )
    .join('')

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${FUNDO};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FUNDO};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${BORDA};border-radius:12px;">
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:2px;color:${AZUL};">MNVMA</p>
          <h1 style="margin:12px 0 20px;font-size:22px;line-height:1.3;color:${TINTA};">${esc(titulo)}</h1>
        </td></tr>
        <tr><td style="padding:0 32px 8px;">${corpo}${cta}</td></tr>
        <tr><td style="padding:8px 32px 28px;border-top:1px solid ${BORDA};">${pe}
          <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;">MNVMA — gestão para cuidadores.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Versão em texto puro da mesma mensagem. */
export function montarTexto({ titulo, paragrafos, botao, rodape }: Layout): string {
  const semTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')

  const blocos = [
    titulo,
    '',
    ...paragrafos.map(semTags),
    ...(botao ? ['', `${botao.texto}: ${botao.url}`] : []),
    ...(rodape?.length ? ['', ...rodape.map(semTags)] : []),
    '',
    '— MNVMA',
  ]

  return blocos.join('\n')
}

export interface LinhaConvite { nome: string; email: string; telefone?: string; creci?: string; imobiliaria?: string }

/**
 * Lista colada pelo admin (uma pessoa por linha, colunas separadas por ";" ou TAB — cópia direta de planilha):
 * nome; e-mail; telefone; CRECI; imobiliária. Ignora linhas vazias e cabeçalho; aceita as colunas em outra
 * ordem desde que o e-mail seja reconhecível.
 */
export function lerListaConvites(texto: string): LinhaConvite[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.split(/[;\t]/).map((c) => c.trim()))
    .filter((cols) => cols.some(Boolean) && !(cols.some((c) => /e-?mail/i.test(c)) && !cols.some((c) => c.includes('@'))))
    .map((cols) => {
      const i = cols.findIndex((c) => c.includes('@'))
      const email = (i >= 0 ? cols[i] : cols[1] ?? '').toLowerCase()
      const resto = cols.filter((_, j) => j !== (i >= 0 ? i : 1))
      const [nome = '', telefone, creci, imobiliaria] = resto
      return { nome, email, telefone: telefone || undefined, creci: creci || undefined, imobiliaria: imobiliaria || undefined }
    })
}

export const mensagemConvite = (nome: string, link: string) =>
  `Olá${nome ? `, ${nome.split(' ')[0]}` : ''}! A Bauenn agora é Arken Incorporadora e a área do parceiro mudou. ` +
  `Seu acesso já está liberado — defina sua senha por este link (vale 24 h): ${link}`

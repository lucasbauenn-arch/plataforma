export const brl = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export const m2 = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('pt-BR')} m²`)

export const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR')

export const soDigitos = (v: string) => v.replace(/\D/g, '')

export const mascaraCpf = (v: string) =>
  soDigitos(v).slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')

export const mascaraTelefone = (v: string) => {
  const d = soDigitos(v).slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

export function cpfValido(v: string) {
  const cpf = soDigitos(v)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const calc = (n: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(cpf[i]) * (n + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10])
}

/** Espelho de `public.cnpj_valido(text)`: 14 dígitos, sem todos iguais, com os dois dígitos verificadores. */
export function cnpjValido(v: string) {
  const cnpj = soDigitos(v)
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false
  const calc = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const s = pesos.reduce((acc, p, i) => acc + Number(cnpj[i]) * p, 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13])
}

export const mascaraCnpj = (v: string) =>
  soDigitos(v).slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')

export const mascaraCep = (v: string) => soDigitos(v).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2')

/** CPF (11) ou CNPJ (14) com a máscara certa; outros tamanhos saem como vieram. */
export function mascaraDocumento(v: string | null | undefined) {
  const d = soDigitos(v ?? '')
  if (d.length === 11) return mascaraCpf(d)
  if (d.length === 14) return mascaraCnpj(d)
  return v ?? ''
}

/**
 * Texto de moeda digitado em pt-BR → número com 2 casas (arredondado). Aceita "R$ 1.234,56", "1234,5", "1.234" e "1234.56".
 * Vazio ou inválido → null. Só para formulários: o servidor recalcula e é a fonte de verdade.
 */
export function moedaParaNumero(v: string | null | undefined): number | null {
  let t = (v ?? '').replace(/R\$|\s/g, '')
  if (!t) return null
  const negativo = t.startsWith('-')
  t = t.replace(/^-/, '')
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t)
  if (!m) return null
  // centavos exatos a partir do texto (sem erro de ponto flutuante), metade para longe do zero como o round() do Postgres
  const frac = (m[2] ?? '').padEnd(3, '0')
  const centavos = Number(m[1]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0)
  const n = centavos / 100
  return negativo ? -n : n
}

/** Reais com centavos ("R$ 1.808,33"). O `brl()` do site continua sem centavos. */
export const brlCentavos = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Máscara de digitação de moeda: os dígitos entram pelos centavos ("123456" → "1.234,56"). */
export function mascaraMoeda(v: string) {
  const d = soDigitos(v).replace(/^0+(?=\d)/, '').slice(0, 15)
  if (!d) return ''
  const n = Number(d) / 100
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Percentual na unidade "%" do banco (8.5 → "8,5%"). */
export const percentual = (v: number | null | undefined, casas = 2) =>
  v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`

/** Data e hora curtas em pt-BR (fuso do navegador). */
export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

/** Código de exibição com 7 dígitos (#0000123), usado em contratos e imóveis. */
export const codigoExibicao = (n: number | null | undefined) => (n == null ? '—' : `#${String(n).padStart(7, '0')}`)

export const youtubeId = (url: string) =>
  url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/)?.[1] ?? null

export const waLink = (numero: string, texto: string) =>
  `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`

/** Telefone brasileiro em qualquer formato → número para wa.me (com DDI 55). Null se não tiver DDD + número. */
export function whatsappBR(telefone: string | null | undefined) {
  const d = soDigitos(telefone ?? '')
  if (d.length === 10 || d.length === 11) return `55${d}`
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d
  return null
}

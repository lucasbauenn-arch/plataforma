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

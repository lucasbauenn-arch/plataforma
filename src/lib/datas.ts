// Datas "de calendário" (sem hora nem fuso) no formato ISO yyyy-mm-dd, como o Postgres grava `date`.
// Usado pelo CampoData: máscara dd/mm/aaaa, validação e a grade do calendário.

import { soDigitos } from './format'

/** dd/mm/aaaa a partir do que foi digitado (só dígitos, no máximo 8). */
export function mascaraData(texto: string): string {
  const d = soDigitos(texto).slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

const dois = (n: number) => String(n).padStart(2, '0')

/** yyyy-mm-dd → true se a data existe (31/02 não existe). */
export function isoValida(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (a < 1000 || mes < 1 || mes > 12 || dia < 1) return false
  return dia <= diasNoMes(a, mes)
}

/** dd/mm/aaaa → yyyy-mm-dd, ou null se incompleta ou inexistente. */
export function brParaIso(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br)
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  return isoValida(iso) ? iso : null
}

/** yyyy-mm-dd → dd/mm/aaaa ('' se vazio ou inválido). */
export function isoParaBr(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = iso.slice(0, 10)
  if (!isoValida(s)) return ''
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
}

export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

export function montarIso(ano: number, mes: number, dia: number): string {
  return `${ano}-${dois(mes)}-${dois(dia)}`
}

/** Dentro de [min, max] (ISO compara como texto). */
export function dentroDoIntervalo(iso: string, min?: string | null, max?: string | null): boolean {
  if (min && iso < min) return false
  if (max && iso > max) return false
  return true
}

/**
 * Grade do mês para o calendário: semanas de domingo a sábado; `null` nas casas fora do mês.
 */
export function gradeDoMes(ano: number, mes: number): (number | null)[][] {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay()
  const total = diasNoMes(ano, mes)
  const casas: (number | null)[] = [...Array(primeiro).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)]
  while (casas.length % 7) casas.push(null)
  const semanas: (number | null)[][] = []
  for (let i = 0; i < casas.length; i += 7) semanas.push(casas.slice(i, i + 7))
  return semanas
}

/** Hoje em São Paulo, yyyy-mm-dd. */
export function hojeIso(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

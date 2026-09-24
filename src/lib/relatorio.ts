export interface Relatorio {
  leads: number
  leads_anterior: number
  parceiros_novos: number
  parceiros_pendentes: number
  acessos_portal: number
  propostas: Partial<Record<'enviada' | 'em_analise' | 'aprovada' | 'recusada', number>>
  leads_mensal: { mes: string; total: number }[]
  leads_por_empreendimento: { nome: string; total: number }[]
  leads_por_origem: { origem: string; total: number }[]
  parceiros_ranking: { nome: string; total: number; aprovadas: number }[]
  estoque: { nome: string; disponivel: number; reservada: number; vendida: number; vgv_disponivel: number; vgv_vendido: number }[]
}

export const PERIODOS = [
  { chave: '7d', label: '7 dias', dias: 7 },
  { chave: '30d', label: '30 dias', dias: 30 },
  { chave: '90d', label: '90 dias', dias: 90 },
  { chave: '365d', label: '12 meses', dias: 365 },
] as const
export type ChavePeriodo = (typeof PERIODOS)[number]['chave']

export const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const mesAbrev = (aaaaMm: string) => MESES_ABREV[Number(aaaaMm.slice(5, 7)) - 1]

export const ORIGEM_LABEL: Record<string, string> = { site: 'Site (geral)', pagina_empreendimento: 'Página do empreendimento' }

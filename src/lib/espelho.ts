import type { StatusUnidade } from './types'

export interface LinhaEspelho { identificador: string; metragem: number | null; valor: number | null; status: StatusUnidade }

const STATUS: StatusUnidade[] = ['disponivel', 'reservada', 'vendida']

/** Número no formato brasileiro ou americano: "R$ 280.000,00", "52,5", "1.250.000", "52.50" → number. */
export function numeroBR(v: string | null | undefined): number | null {
  if (!v) return null
  const limpo = v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (!limpo || limpo === '-' || limpo === '.') return null
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

/**
 * Espelho de vendas exportado de planilha (Excel/Notion): unidade; metragem; valor; status.
 * O separador é detectado no arquivo — ";" (Excel pt-BR), TAB ou "," — para não quebrar decimais como "52,5".
 * Ignora cabeçalho e linhas vazias; status desconhecido vira "disponivel".
 */
export function lerEspelhoVendas(texto: string): LinhaEspelho[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim())
  const amostra = linhas.slice(0, 5).join('\n')
  const sep = amostra.includes(';') ? ';' : amostra.includes('\t') ? '\t' : ','
  return linhas
    .map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '').trim()))
    .filter((c) => c[0] && !/^(apto|apartamento|unidade|unid\.?)$/i.test(c[0]))
    .map((c) => {
      const s = (c[3] ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() as StatusUnidade
      return { identificador: c[0], metragem: numeroBR(c[1]), valor: numeroBR(c[2]), status: STATUS.includes(s) ? s : 'disponivel' }
    })
}

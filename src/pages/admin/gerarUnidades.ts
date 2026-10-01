// Geração das unidades que faltam para chegar ao "Total de unidades" do empreendimento (aba Unidades e materiais).
// Só CRIA: nenhuma unidade existente é apagada, renomeada ou alterada, e nenhum nome se repete (nem "APTO 1" x "APTO 01").

import { chaveUnidade, numeroBR } from '@/lib/espelho'

/** Metragem do cadastro ("45", "45,5 m²", "45m2") como número; faixa ou texto ("38 a 45 m²", "2 dorms") = null. */
export function metragemNumerica(texto: string | null | undefined): number | null {
  if (!texto) return null
  const m = texto.trim().match(/^(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|m2|m)?$/i)
  return m ? numeroBR(m[1]) : null
}

/** Chave de comparação: a de `chaveUnidade` sem zeros à esquerda nos números ("APTO 01" = "apto 1"). */
export const chaveSemZeros = (identificador: string) => chaveUnidade(identificador).replace(/(^|\D)0+(?=\d)/g, '$1')

/** Quantas unidades faltam para o total previsto (0 sem total ou quando já há o total ou mais). */
export function faltamParaOTotal(total: number | null | undefined, cadastradas: number) {
  return total && total > cadastradas ? total - cadastradas : 0
}

/**
 * Nomes das `quantidade` unidades novas: `prefixo` + número a partir de `inicio`, com pelo menos 2 dígitos (APTO 01),
 * pulando os nomes que o cadastro já tem. Com `prefixo` vazio, só o número.
 */
export function nomesParaGerar(existentes: string[], quantidade: number, prefixo: string, inicio: number): string[] {
  if (!Number.isInteger(quantidade) || quantidade <= 0) return []
  const base = Number.isInteger(inicio) && inicio >= 0 ? inicio : 1
  const usados = new Set(existentes.map(chaveSemZeros))
  const largura = Math.max(2, String(base + quantidade + existentes.length).length)
  const p = prefixo.replace(/\s+/g, ' ').trim()
  const nomes: string[] = []
  // cada nome existente bloqueia no máximo um número: o laço termina em quantidade + existentes passos
  for (let n = base; nomes.length < quantidade && n <= base + quantidade + existentes.length; n++) {
    const nome = [p, String(n).padStart(largura, '0')].filter(Boolean).join(' ')
    if (!usados.has(chaveSemZeros(nome))) nomes.push(nome)
  }
  return nomes
}

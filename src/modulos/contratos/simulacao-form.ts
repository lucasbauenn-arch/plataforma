// Formulário de simulação (docs/ARQUITETURA_EXPANSAO.md §3.6, §7.3; SEG-4, N16): o navegador manda SÓ as escolhas
// (forma, % de aporte, entrada, nº de parcelas) e o produto; nunca o valor do produto nem valores calculados. A prévia
// instantânea usa o espelho TS (@shared/simulacao) com o valor e os limites que o servidor expõe, rotulada "prévia";
// os valores oficiais são sempre os que o servidor devolve.

import { z } from 'zod'
import {
  calcularSimulacao, decimalDe, multiplicar, numeroDe, subtrair, type ResultadoSimulacao, type ValoresSimulacao,
} from '@shared/simulacao'
import type { FormaPagamento, Uuid } from '@/lib/types'
import type { ParametrosSimulacao } from '@/modulos/config/tipos'
import type { ContratoDetalhe, ProdutoRef, ProdutoResumo } from './tipos'

export interface EscolhasSimulacao {
  forma: FormaPagamento
  perc_aporte: number | null
  entrada: number | null
  n_parcelas: number | null
}

/** Texto do percentual ("30", "33,3333", "8.5") → número com até 4 casas; inválido → nulo. */
export function lerPercentual(texto: string | null | undefined): number | null {
  const t = (texto ?? '').trim().replace('%', '').trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export const percentualParaTexto = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

export const esquemaSimulacao = z.object({
  forma: z.enum(['parcelado', 'flexivel']),
  perc_aporte: z.string().trim().refine((v) => {
    const n = lerPercentual(v)
    return n != null && n > 0 && n <= 100
  }, 'Informe um percentual entre 0 e 100 (até 4 casas decimais).'),
  entrada: z.number().min(0, 'A entrada não pode ser negativa.').nullable(),
  n_parcelas: z.string().trim(),
}).superRefine((v, ctx) => {
  if (v.forma === 'parcelado' && !/^\d{1,3}$/.test(v.n_parcelas)) {
    ctx.addIssue({ code: 'custom', path: ['n_parcelas'], message: 'Informe o número de parcelas.' })
  }
})

export type FormSimulacao = z.infer<typeof esquemaSimulacao>

export function escolhasDoForm(f: FormSimulacao): EscolhasSimulacao {
  return {
    forma: f.forma,
    perc_aporte: lerPercentual(f.perc_aporte),
    entrada: f.entrada ?? 0,
    n_parcelas: f.forma === 'parcelado' && /^\d{1,3}$/.test(f.n_parcelas.trim()) ? Number(f.n_parcelas.trim()) : null,
  }
}

export const refDoProduto = (p: Pick<ProdutoResumo, 'tipo' | 'id'>): ProdutoRef =>
  p.tipo === 'unidade' ? { unidade_id: p.id } : { imovel_id: p.id }

/** `contrato_simular`: produto + escolhas. */
export const argsSimular = (p: Pick<ProdutoResumo, 'tipo' | 'id'>, e: EscolhasSimulacao) => ({
  p_forma: e.forma, p_produto: refDoProduto(p), p_perc_aporte: e.perc_aporte ?? 0, p_entrada: e.entrada ?? 0,
  p_n_parcelas: e.forma === 'parcelado' ? e.n_parcelas : null,
})

/** `contrato_criar`: cliente, produto e escolhas (nada calculado, nenhum valor de produto). */
export const argsCriar = (clienteId: Uuid, p: Pick<ProdutoResumo, 'tipo' | 'id'>, e: EscolhasSimulacao) => ({
  p_cliente_id: clienteId, ...argsSimular(p, e),
})

/** `contrato_atualizar_simulacao`: o produto não muda (o servidor relê o valor dele). */
export const argsAtualizar = (id: Uuid, e: EscolhasSimulacao) => ({
  p_id: id, p_forma: e.forma, p_perc_aporte: e.perc_aporte ?? 0, p_entrada: e.entrada ?? 0,
  p_n_parcelas: e.forma === 'parcelado' ? e.n_parcelas : null,
})

/** Prévia no navegador com o mesmo cálculo do servidor (nulo sem produto ou sem parâmetros). */
export function previaSimulacao(valorProduto: number | null | undefined, e: EscolhasSimulacao,
                                parametros: Pick<ParametrosSimulacao, 'taxa_aporte_proprio' | 'parcela_minima' | 'parcela_maxima' | 'valor_minimo' | 'valor_minimo_flex'> | null)
  : ResultadoSimulacao | null {
  if (!parametros || valorProduto === undefined) return null
  return calcularSimulacao({
    forma: e.forma, valor: valorProduto, perc_aporte: e.perc_aporte, entrada: e.entrada ?? 0, n_parcelas: e.n_parcelas,
    taxa: parametros.taxa_aporte_proprio, parcela_minima: parametros.parcela_minima, parcela_maxima: parametros.parcela_maxima,
    valor_minimo: parametros.valor_minimo, valor_minimo_flex: parametros.valor_minimo_flex,
  })
}

/** Valores oficiais gravados no contrato, no formato da simulação (o resíduo é derivado, com aritmética decimal exata). */
export function valoresDoContrato(k: Pick<ContratoDetalhe, 'valor_imovel' | 'perc_aporte' | 'valor_aporte' | 'valor_entrada'
  | 'base_parcelada' | 'valor_restante' | 'n_parcelas' | 'taxa_aporte' | 'valor_parcela' | 'valor_total_parcelas' | 'valor_minimo_flex'>): ValoresSimulacao {
  const residuo = k.n_parcelas != null && k.valor_parcela != null && k.valor_total_parcelas != null
    ? numeroDe(subtrair(decimalDe(k.valor_total_parcelas), multiplicar(decimalDe(k.valor_parcela), decimalDe(k.n_parcelas))))
    : null
  return {
    valor_imovel: k.valor_imovel, perc_aporte: k.perc_aporte, valor_aporte: k.valor_aporte, valor_entrada: k.valor_entrada,
    base_parcelada: k.base_parcelada, valor_restante: k.valor_restante, n_parcelas: k.n_parcelas, taxa_aporte: k.taxa_aporte,
    valor_parcela: k.valor_parcela, valor_total_parcelas: k.valor_total_parcelas, residuo, valor_minimo_flex: k.valor_minimo_flex,
  }
}

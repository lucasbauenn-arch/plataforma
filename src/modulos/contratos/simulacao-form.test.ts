import { describe, expect, it } from 'vitest'
import {
  argsAtualizar, argsCriar, argsSimular, escolhasDoForm, esquemaSimulacao, lerPercentual, percentualParaTexto, previaSimulacao,
  valoresDoContrato,
} from './simulacao-form'

const PARAMETROS = { taxa_aporte_proprio: 8.5, parcela_minima: 12, parcela_maxima: 360, valor_minimo: null, valor_minimo_flex: null }
const UNIDADE = { tipo: 'unidade' as const, id: 'f4000000-0000-4000-8000-000000000011' }

describe('percentual', () => {
  it('aceita vírgula ou ponto e até 4 casas', () => {
    expect(lerPercentual('30')).toBe(30)
    expect(lerPercentual('33,3333')).toBe(33.3333)
    expect(lerPercentual('8.5%')).toBe(8.5)
    expect(lerPercentual('1,23456')).toBeNull()
    expect(lerPercentual('abc')).toBeNull()
    expect(percentualParaTexto(8.5)).toBe('8,5')
  })
})

describe('formulário', () => {
  it('parcelado exige o número de parcelas; flexível não', () => {
    expect(esquemaSimulacao.safeParse({ forma: 'parcelado', perc_aporte: '30', entrada: 0, n_parcelas: '' }).success).toBe(false)
    expect(esquemaSimulacao.safeParse({ forma: 'flexivel', perc_aporte: '30', entrada: 0, n_parcelas: '' }).success).toBe(true)
    expect(esquemaSimulacao.safeParse({ forma: 'parcelado', perc_aporte: '0', entrada: 0, n_parcelas: '60' }).success).toBe(false)
    expect(esquemaSimulacao.safeParse({ forma: 'parcelado', perc_aporte: '30', entrada: -1, n_parcelas: '60' }).success).toBe(false)
  })

  it('escolhas: flexível sem parcelas; entrada vazia vira zero', () => {
    expect(escolhasDoForm({ forma: 'flexivel', perc_aporte: '30', entrada: null, n_parcelas: '60' }))
      .toEqual({ forma: 'flexivel', perc_aporte: 30, entrada: 0, n_parcelas: null })
  })
})

describe('SEG-4: o front manda só as escolhas', () => {
  const e = { forma: 'parcelado' as const, perc_aporte: 30, entrada: 50000, n_parcelas: 60 }
  it('argumentos sem valor do produto nem valores calculados', () => {
    const proibidas = ['valor', 'valor_imovel', 'valor_aporte', 'base_parcelada', 'valor_parcela', 'valor_total_parcelas', 'residuo']
    for (const args of [argsSimular(UNIDADE, e), argsCriar('cliente-1', UNIDADE, e), argsAtualizar('contrato-1', e)]) {
      const texto = JSON.stringify(args)
      for (const p of proibidas) expect(texto).not.toContain(`"${p}"`)
      expect(texto).not.toContain('500000')
    }
    expect(argsCriar('cliente-1', UNIDADE, e)).toEqual({
      p_cliente_id: 'cliente-1', p_forma: 'parcelado', p_produto: { unidade_id: UNIDADE.id }, p_perc_aporte: 30, p_entrada: 50000, p_n_parcelas: 60,
    })
    expect(argsSimular({ tipo: 'imovel', id: 'i1' }, { ...e, forma: 'flexivel' }).p_produto).toEqual({ imovel_id: 'i1' })
    expect(argsAtualizar('k', { ...e, forma: 'flexivel' }).p_n_parcelas).toBeNull()
  })
})

describe('prévia', () => {
  it('mesmo cálculo do servidor (vetor da §8.5)', () => {
    const r = previaSimulacao(500000, { forma: 'parcelado', perc_aporte: 30, entrada: 50000, n_parcelas: 60 }, PARAMETROS)
    expect(r?.ok && r.valores.valor_parcela).toBe(1808.33)
  })
  it('sem parâmetros não há prévia; flexível sem mínimo mostra o motivo', () => {
    expect(previaSimulacao(500000, { forma: 'parcelado', perc_aporte: 30, entrada: 0, n_parcelas: 60 }, null)).toBeNull()
    expect(previaSimulacao(500000, { forma: 'flexivel', perc_aporte: 30, entrada: 0, n_parcelas: null }, PARAMETROS))
      .toEqual({ ok: false, motivos: ['flexivel_sem_minimo'] })
  })
})

describe('valores do contrato', () => {
  it('resíduo derivado sem erro de ponto flutuante', () => {
    const v = valoresDoContrato({
      valor_imovel: 500000, perc_aporte: 30, valor_aporte: 150000, valor_entrada: 50000, base_parcelada: 100000,
      valor_restante: 350000, n_parcelas: 60, taxa_aporte: 8.5, valor_parcela: 1808.33, valor_total_parcelas: 108500, valor_minimo_flex: null,
    })
    expect(v.residuo).toBe(0.2)
  })
})

// Espelho TS da simulação (FIN-1/FIN-2) contra os MESMOS vetores do banco (simulacao.vetores.json, gerados por
// public.calcular_simulacao e conferidos também no supabase/tests/contratos.test.sql). Aritmética decimal exata, com o
// arredondamento do round() do Postgres (metade para longe do zero) e a escala de divisão do numeric.
import { describe, expect, it } from 'vitest'
import vetores from './simulacao.vetores.json' with { type: 'json' }
import {
  arredondar, calcularSimulacao, decimalDe, dividir, escalaDivisao, formatarMoeda, formatarPercentual, multiplicar, numeroDe,
  somar, subtrair, textoDecimal, type EntradaSimulacao, type FormaPagamento,
} from './simulacao.ts'

interface Vetor {
  descricao: string
  entrada: Omit<EntradaSimulacao, 'forma'> & { forma: string | null }
  esperado: Record<string, number | null> | { motivos: string[] }
}

const lista = vetores as unknown as Vetor[]

describe('simulação: vetores compartilhados com o SQL', () => {
  it('há vetores válidos e inválidos, com os dois da §8.5', () => {
    expect(lista.length).toBeGreaterThanOrEqual(30)
    expect(lista.some((v) => 'motivos' in v.esperado)).toBe(true)
    expect(lista[0].descricao).toContain('500.000')
    expect(lista[1].descricao).toContain('300.000')
  })

  for (const v of lista) {
    it(v.descricao, () => {
      const r = calcularSimulacao({ ...v.entrada, forma: v.entrada.forma as FormaPagamento | null })
      if ('motivos' in v.esperado) {
        expect(r).toEqual({ ok: false, motivos: v.esperado.motivos })
      } else {
        expect(r).toEqual({ ok: true, valores: v.esperado })
      }
    })
  }
})

describe('simulação: vetores da §8.5 escritos à mão', () => {
  it('500.000 × 30% − 50.000, 60×, 8,5% → aporte 150.000,00; base 100.000,00; parcela 1.808,33; total 108.500,00; resíduo 0,20', () => {
    const r = calcularSimulacao({
      forma: 'parcelado', valor: 500000, perc_aporte: 30, entrada: 50000, n_parcelas: 60, taxa: 8.5,
      parcela_minima: 12, parcela_maxima: 360, valor_minimo: null, valor_minimo_flex: null,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valores.valor_aporte).toBe(150000)
    expect(r.valores.base_parcelada).toBe(100000)
    expect(r.valores.valor_parcela).toBe(1808.33)
    expect(r.valores.valor_total_parcelas).toBe(108500)
    expect(r.valores.residuo).toBe(0.2)
    expect(r.valores.valor_restante).toBe(350000)
  })

  it('300.000 × 30% − 10.000 = base 80.000; 60× → 1.446,67', () => {
    const r = calcularSimulacao({
      forma: 'parcelado', valor: 300000, perc_aporte: 30, entrada: 10000, n_parcelas: 60, taxa: 8.5,
      parcela_minima: 12, parcela_maxima: 360, valor_minimo: null, valor_minimo_flex: null,
    })
    expect(r.ok && r.valores.base_parcelada).toBe(80000)
    expect(r.ok && r.valores.valor_parcela).toBe(1446.67)
  })
})

describe('decimal exato (espelho do numeric do Postgres)', () => {
  it('lê o texto decimal do número, não o binário do float', () => {
    expect(textoDecimal(decimalDe(0.1))).toBe('0.1')
    expect(textoDecimal(somar(decimalDe(0.1), decimalDe(0.2)))).toBe('0.3')
    expect(textoDecimal(decimalDe('1e3'))).toBe('1000')
    expect(textoDecimal(decimalDe(-12.5))).toBe('-12.5')
    expect(() => decimalDe(Number.NaN)).toThrow()
    expect(() => decimalDe('abc')).toThrow()
  })

  it('round() arredonda metade para longe do zero', () => {
    expect(numeroDe(arredondar(decimalDe('2.345'), 2))).toBe(2.35)
    expect(numeroDe(arredondar(decimalDe('-2.345'), 2))).toBe(-2.35)
    expect(numeroDe(arredondar(decimalDe('2.3449999'), 2))).toBe(2.34)
    expect(numeroDe(arredondar(decimalDe('10.005'), 2))).toBe(10.01)
  })

  it('escala da divisão igual à select_div_scale (16 dígitos significativos)', () => {
    expect(escalaDivisao(decimalDe('100000.00'), decimalDe(60))).toBe(16)
    expect(escalaDivisao(decimalDe('8.5'), decimalDe(100))).toBe(20)
    expect(textoDecimal(dividir(decimalDe('100000.00'), decimalDe(60)))).toBe('1666.6666666666666667')
    expect(textoDecimal(dividir(decimalDe(1), decimalDe(3)))).toBe('0.33333333333333333333')
    expect(() => dividir(decimalDe(1), decimalDe(0))).toThrow()
  })

  it('multiplicação e subtração exatas', () => {
    expect(textoDecimal(multiplicar(decimalDe('1808.33'), decimalDe(60)))).toBe('108499.8')
    expect(textoDecimal(subtrair(decimalDe('108500.00'), decimalDe('108499.80')))).toBe('0.2')
  })
})

describe('formatação pt-BR', () => {
  it('dinheiro sempre com centavos', () => {
    expect(formatarMoeda(1808.33)).toBe('R$ 1.808,33')
    expect(formatarMoeda(150000)).toBe('R$ 150.000,00')
    expect(formatarMoeda(0.2)).toBe('R$ 0,20')
    expect(formatarMoeda(-1234.5)).toBe('-R$ 1.234,50')
    expect(formatarMoeda('99999999.995')).toBe('R$ 100.000.000,00')
  })

  it('percentual na unidade "%"', () => {
    expect(formatarPercentual(30)).toBe('30%')
    expect(formatarPercentual(8.5)).toBe('8,5%')
    expect(formatarPercentual(33.3333)).toBe('33,3333%')
  })
})

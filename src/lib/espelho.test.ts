import { describe, expect, it } from 'vitest'
import { lerEspelhoVendas, numeroBR } from './espelho'

describe('numeroBR', () => {
  it.each([
    ['R$ 280.000,00', 280000],
    ['280.000', 280000],
    ['1.250.000,50', 1250000.5],
    ['52,5', 52.5],
    ['52.50', 52.5],
    ['52', 52],
    ['', null],
    ['—', null],
  ])('%s → %s', (entrada, esperado) => expect(numeroBR(entrada)).toBe(esperado))
})

describe('lerEspelhoVendas', () => {
  it('Excel pt-BR com ";" e decimais com vírgula (antes quebrava as colunas)', () => {
    const csv = 'Unidade;Metragem;Valor;Status\nAPTO 01;52,5;R$ 280.000,00;disponível\nAPTO 02;55,0;295.000;Vendida\n'
    expect(lerEspelhoVendas(csv)).toEqual([
      { identificador: 'APTO 01', metragem: 52.5, valor: 280000, status: 'disponivel' },
      { identificador: 'APTO 02', metragem: 55, valor: 295000, status: 'vendida' },
    ])
  })
  it('CSV com vírgula e aspas', () => {
    const csv = '"unidade","metragem","valor","status"\n"101","45.3","250000","reservada"'
    expect(lerEspelhoVendas(csv)).toEqual([{ identificador: '101', metragem: 45.3, valor: 250000, status: 'reservada' }])
  })
  it('colado de planilha (TAB), status desconhecido vira disponível e linhas vazias somem', () => {
    const tsv = 'APTO 11\t40\t199.900\tbloqueada\n\n\nAPTO 12\t41\t\t'
    expect(lerEspelhoVendas(tsv)).toEqual([
      { identificador: 'APTO 11', metragem: 40, valor: 199900, status: 'disponivel' },
      { identificador: 'APTO 12', metragem: 41, valor: null, status: 'disponivel' },
    ])
  })
})

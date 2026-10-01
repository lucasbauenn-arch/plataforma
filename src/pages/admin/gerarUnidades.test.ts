import { describe, expect, it } from 'vitest'
import { chaveSemZeros, faltamParaOTotal, metragemNumerica, nomesParaGerar } from './gerarUnidades'

describe('gerar unidades que faltam', () => {
  it('metragem só quando é um número (com ou sem m²)', () => {
    expect(metragemNumerica('45')).toBe(45)
    expect(metragemNumerica('45,5 m²')).toBe(45.5)
    expect(metragemNumerica('45m2')).toBe(45)
    expect(metragemNumerica('38 a 45 m²')).toBeNull()
    expect(metragemNumerica('2 dorms')).toBeNull()
    expect(metragemNumerica(null)).toBeNull()
  })

  it('faltam = total - cadastradas, nunca negativo', () => {
    expect(faltamParaOTotal(20, 3)).toBe(17)
    expect(faltamParaOTotal(3, 5)).toBe(0)
    expect(faltamParaOTotal(null, 0)).toBe(0)
  })

  it('numera com 2 dígitos a partir do início e pula os nomes que já existem (inclusive sem zero à esquerda)', () => {
    expect(nomesParaGerar(['APTO 01', 'apto 3'], 3, 'APTO', 1)).toEqual(['APTO 02', 'APTO 04', 'APTO 05'])
    expect(nomesParaGerar([], 2, '  Casa  ', 10)).toEqual(['Casa 10', 'Casa 11'])
    expect(nomesParaGerar([], 2, '', 1)).toEqual(['01', '02'])
  })

  it('não gera nome repetido nem entre os novos', () => {
    const nomes = nomesParaGerar(['APTO 01', 'APTO 02'], 98, 'APTO', 1)
    expect(nomes).toHaveLength(98)
    expect(new Set(nomes.map(chaveSemZeros)).size).toBe(98)
    expect(nomes[0]).toBe('APTO 003')
    expect(nomes).not.toContain('APTO 001')
  })

  it('quantidade inválida não gera nada', () => {
    expect(nomesParaGerar([], 0, 'APTO', 1)).toEqual([])
    expect(nomesParaGerar([], -2, 'APTO', 1)).toEqual([])
  })

  it('chave sem zeros: APTO 01 = apto 1; APTO 10 ≠ APTO 1', () => {
    expect(chaveSemZeros('APTO 01')).toBe(chaveSemZeros('apto 1'))
    expect(chaveSemZeros('APTO 10')).not.toBe(chaveSemZeros('APTO 1'))
    expect(chaveSemZeros('Bloco 02 - 0101')).toBe('BLOCO 2 - 101')
  })
})

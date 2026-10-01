import { describe, expect, it } from 'vitest'
import { brParaIso, dentroDoIntervalo, gradeDoMes, hojeIso, isoParaBr, isoValida, mascaraData } from './datas'

describe('datas', () => {
  it('máscara dd/mm/aaaa enquanto digita', () => {
    expect(mascaraData('3')).toBe('3')
    expect(mascaraData('301')).toBe('30/1')
    expect(mascaraData('30092026')).toBe('30/09/2026')
    expect(mascaraData('30/09/2026999')).toBe('30/09/2026')
  })
  it('converte e valida', () => {
    expect(brParaIso('30/09/2026')).toBe('2026-09-30')
    expect(brParaIso('31/02/2026')).toBeNull()
    expect(brParaIso('29/02/2024')).toBe('2024-02-29')
    expect(brParaIso('29/02/2025')).toBeNull()
    expect(brParaIso('30/09/26')).toBeNull()
    expect(isoParaBr('2026-09-30')).toBe('30/09/2026')
    expect(isoParaBr('2026-09-30T12:00:00Z')).toBe('30/09/2026')
    expect(isoParaBr(null)).toBe('')
    expect(isoValida('2026-13-01')).toBe(false)
  })
  it('intervalo', () => {
    expect(dentroDoIntervalo('2026-09-30', '2026-09-30', null)).toBe(true)
    expect(dentroDoIntervalo('2026-09-29', '2026-09-30', null)).toBe(false)
    expect(dentroDoIntervalo('2026-10-01', null, '2026-09-30')).toBe(false)
  })
  it('grade do mês começa no domingo', () => {
    const set2026 = gradeDoMes(2026, 9) // 1º de setembro de 2026 é terça
    expect(set2026[0]).toEqual([null, null, 1, 2, 3, 4, 5])
    expect(set2026.flat().filter(Boolean)).toHaveLength(30)
    expect(set2026.every((s) => s.length === 7)).toBe(true)
  })
  it('hoje em São Paulo', () => {
    expect(hojeIso(new Date('2026-10-01T02:00:00Z'))).toBe('2026-09-30')
  })
})

import { describe, expect, it } from 'vitest'
import { codigoTotpValido, etapaMfa, fatoresPendentes, podeRemover, type FatorResumo } from './seguranca'

const verificado: FatorResumo = { id: 'f1', factor_type: 'totp', status: 'verified' }
const pendente: FatorResumo = { id: 'f2', factor_type: 'totp', status: 'unverified' }

describe('verificação em duas etapas', () => {
  it('etapa conforme fatores e aal', () => {
    expect(etapaMfa([], 'aal1')).toBe('cadastrar')
    expect(etapaMfa([pendente], 'aal1')).toBe('cadastrar')
    expect(etapaMfa([verificado], 'aal1')).toBe('confirmar_sessao')
    expect(etapaMfa([verificado], 'aal2')).toBe('ativa')
    expect(etapaMfa([{ ...verificado, factor_type: 'phone' }], 'aal2')).toBe('cadastrar')
  })

  it('pendentes', () => {
    expect(fatoresPendentes([verificado, pendente])).toEqual([pendente])
  })

  it('código', () => {
    expect(codigoTotpValido('123 456')).toBe(true)
    expect(codigoTotpValido('12345')).toBe(false)
    expect(codigoTotpValido('abcdef')).toBe(false)
  })

  it('remover: só em aal2 e sem ficar sem nenhum quando exigida', () => {
    expect(podeRemover([verificado], 'aal1', false)).toBe(false)
    expect(podeRemover([verificado], 'aal2', false)).toBe(true)
    expect(podeRemover([verificado], 'aal2', true)).toBe(false)
    expect(podeRemover([verificado, { ...verificado, id: 'f3' }], 'aal2', true)).toBe(true)
  })
})

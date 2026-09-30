import { describe, expect, it, vi } from 'vitest'
import { CHAVE_RECARGA_MODULO, JANELA_RECARGA_MS, ehFalhaDeModulo, podeRecarregarSozinho, tratarFalhaDePreload } from './modulos'

const memoria = (inicial: Record<string, string> = {}) => {
  const dados = { ...inicial }
  return { getItem: (k: string) => dados[k] ?? null, setItem: (k: string, v: string) => { dados[k] = v }, dados }
}

describe('ehFalhaDeModulo (FUX-02)', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://arken.com.br/assets/Lista-Bx1.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/x.css',
  ])('reconhece "%s"', (m) => expect(ehFalhaDeModulo(new TypeError(m))).toBe(true))

  it('reconhece ChunkLoadError e texto solto; não confunde erro comum', () => {
    const e = new Error('Loading chunk 12 failed.'); e.name = 'ChunkLoadError'
    expect(ehFalhaDeModulo(e)).toBe(true)
    expect(ehFalhaDeModulo('Importing a module script failed.')).toBe(true)
    expect(ehFalhaDeModulo(new TypeError("Cannot read properties of null (reading 'map')"))).toBe(false)
    expect(ehFalhaDeModulo(null)).toBe(false)
    expect(ehFalhaDeModulo({ message: 'Failed to fetch dynamically imported module' })).toBe(true)
    expect(ehFalhaDeModulo(undefined)).toBe(false)
  })
})

describe('podeRecarregarSozinho: no máximo uma recarga por janela (sem laço)', () => {
  it('primeira falha recarrega e registra; a seguinte, dentro da janela, não', () => {
    const arm = memoria()
    expect(podeRecarregarSozinho(arm, 1_000_000)).toBe(true)
    expect(arm.dados[CHAVE_RECARGA_MODULO]).toBe('1000000')
    expect(podeRecarregarSozinho(arm, 1_000_000 + JANELA_RECARGA_MS - 1)).toBe(false)
  })

  it('depois da janela pode de novo', () => {
    const arm = memoria({ [CHAVE_RECARGA_MODULO]: '1000000' })
    expect(podeRecarregarSozinho(arm, 1_000_000 + JANELA_RECARGA_MS)).toBe(true)
  })

  it('sem armazenamento, ou com ele quebrado, não recarrega (não há como impedir o laço)', () => {
    expect(podeRecarregarSozinho(null, 1)).toBe(false)
    const quebrado = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    expect(podeRecarregarSozinho(quebrado, 1)).toBe(false)
  })

  it('carimbo do futuro (relógio ajustado) não trava para sempre', () => {
    const arm = memoria({ [CHAVE_RECARGA_MODULO]: String(9_999_999_999_999) })
    expect(podeRecarregarSozinho(arm, 1_000)).toBe(true)
  })
})

describe('tratarFalhaDePreload', () => {
  it('cancela o erro e recarrega uma vez; na segunda deixa o erro seguir para a tela de falha', () => {
    const arm = memoria()
    const recarregar = vi.fn()
    const ev1 = { preventDefault: vi.fn() }
    expect(tratarFalhaDePreload(ev1, arm, 5_000_000, recarregar)).toBe(true)
    expect(ev1.preventDefault).toHaveBeenCalledOnce()
    expect(recarregar).toHaveBeenCalledOnce()

    const ev2 = { preventDefault: vi.fn() }
    expect(tratarFalhaDePreload(ev2, arm, 5_000_500, recarregar)).toBe(false)
    expect(ev2.preventDefault).not.toHaveBeenCalled()
    expect(recarregar).toHaveBeenCalledOnce()
  })
})

import { describe, expect, it } from 'vitest'
import { juntarProdutos, LIMITE_PRODUTOS, padraoBusca, textoDeBusca } from './busca'

describe('busca de produtos no servidor (WP4R-06)', () => {
  it('texto limpo: sem acento, minúsculo, "·" vira espaço, espaços simples e no máximo 60 caracteres', () => {
    expect(textoDeBusca('  Residencial São João · APTO  11 ')).toBe('residencial sao joao apto 11')
    expect(textoDeBusca('x'.repeat(80))).toHaveLength(60)
    expect(textoDeBusca('   ')).toBe('')
  })

  it('padrão sem diferença de acento e com metacaracteres escapados', () => {
    expect(padraoBusca('')).toBeNull()
    expect(padraoBusca('Apto 11')).toBe('[aáàâãä]pt[oóòôõö]\\s+11')
    const re = new RegExp(padraoBusca('São')!, 'i')
    expect(re.test('Residencial São Paulo')).toBe(true)
    expect(re.test('Residencial Sao Paulo')).toBe(true)
    expect(re.test('Residencial Sé')).toBe(false)
    // nada do texto vira operador de expressão regular
    expect(padraoBusca('a.b*(c)[d]|e+f?^$\\')).toBe('[aáàâãä]\\.b\\*\\([cç]\\)\\[d\\]\\|[eéèêë]\\+f\\?\\^\\$\\\\')
    expect(new RegExp(padraoBusca('101-B')!, 'i').test('Torre 1 · 101-B')).toBe(true)
    expect(new RegExp(padraoBusca('1.1')!, 'i').test('121')).toBe(false)
  })

  it('junta as duas buscas sem repetir, ordena pelo nome (números em ordem natural) e avisa quando corta', () => {
    const p = (id: string, nome: string) => ({ id, nome })
    expect(juntarProdutos([[p('2', 'E · APTO 10'), p('1', 'E · APTO 2')], [p('1', 'E · APTO 2'), p('3', 'D · CASA 1')]]))
      .toEqual({ itens: [p('3', 'D · CASA 1'), p('1', 'E · APTO 2'), p('2', 'E · APTO 10')], cortado: false })
    const muitos = Array.from({ length: LIMITE_PRODUTOS }, (_, i) => p(String(i), `E · ${i}`))
    const r = juntarProdutos([muitos, [p('x', 'A · 1')]])
    expect(r.itens).toHaveLength(LIMITE_PRODUTOS)
    expect(r.itens[0]).toEqual(p('x', 'A · 1'))
    expect(r.cortado).toBe(true)
  })
})

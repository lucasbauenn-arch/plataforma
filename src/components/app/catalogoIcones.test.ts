import { describe, expect, it } from 'vitest'
import { CATALOGO_LAZER, CATALOGO_PROXIMIDADE, chaveDoRegistro, itemDoCatalogo } from './catalogoIcones'

describe('catálogo de ícones do empreendimento', () => {
  it('chaves no formato aceito pelo banco (check da migration 21) e sem repetição', () => {
    for (const lista of [CATALOGO_LAZER, CATALOGO_PROXIMIDADE]) {
      const chaves = lista.map((i) => i.chave)
      expect(new Set(chaves).size).toBe(chaves.length)
      for (const c of chaves) expect(c).toMatch(/^[a-z][a-z0-9_]{0,39}$/)
    }
  })

  it('traz os itens pedidos de lazer e de proximidade', () => {
    const lazer = CATALOGO_LAZER.map((i) => i.chave)
    for (const c of ['piscina', 'piscina_infantil', 'academia', 'churrasqueira', 'salao_festas', 'playground', 'brinquedoteca', 'quadra',
      'espaco_gourmet', 'pet_place', 'coworking', 'bicicletario', 'lavanderia', 'sauna', 'solarium', 'redario', 'horta', 'portaria_24h',
      'rooftop', 'cinema']) expect(lazer).toContain(c)
    const prox = CATALOGO_PROXIMIDADE.map((i) => i.chave)
    for (const c of ['mercado', 'escola', 'universidade', 'hospital', 'farmacia', 'metro', 'trem', 'onibus', 'shopping', 'parque', 'academia',
      'restaurante', 'banco', 'padaria']) expect(prox).toContain(c)
  })

  it('acha pela chave; chave vazia ou desconhecida = null', () => {
    expect(itemDoCatalogo('lazer', 'piscina')?.rotulo).toBe('Piscina')
    expect(itemDoCatalogo('proximidade', 'metro')?.rotulo).toBe('Metrô')
    expect(itemDoCatalogo('lazer', 'metro')).toBeNull()
    expect(itemDoCatalogo('lazer', null)).toBeNull()
    expect(itemDoCatalogo('lazer', 'nao_existe')).toBeNull()
  })

  it('registro antigo sem chave casa pelo título igual ao rótulo (sem acento e sem caixa)', () => {
    expect(chaveDoRegistro('lazer', { titulo: 'SALAO DE FESTAS ' })).toBe('salao_festas')
    expect(chaveDoRegistro('lazer', { titulo: 'Academia Equipada' })).toBeNull()
    expect(chaveDoRegistro('lazer', { titulo: 'Piscina', icone_catalogo: 'sauna' })).toBe('sauna')
    expect(chaveDoRegistro('lazer', { titulo: 'Piscina', icone_catalogo: 'removida' })).toBeNull()
  })
})

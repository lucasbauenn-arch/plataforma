import { describe, expect, it } from 'vitest'
import { descricaoEmpreendimento, ogEmpreendimento, tituloEmpreendimento } from './seo'

const base = {
  slug: 'eixo-leste', nome: 'Eixo Leste', estagio: 'obras_iniciadas' as const, bairro: null, cidade: 'São Paulo',
  dormitorios: '1-2 Dorm', metragem: '25-45m²', tagline: 'Um condomínio\n\nexclusivo', descricao: null, capa_url: 'wp/x.webp',
}

describe('SEO de empreendimento', () => {
  it('título com estágio e local', () => {
    expect(tituloEmpreendimento(base)).toBe('Eixo Leste — Obras iniciadas em São Paulo | Arken Incorporadora')
    expect(tituloEmpreendimento({ ...base, bairro: 'Artur Alvim' })).toContain('em Artur Alvim')
  })
  it('descrição normaliza espaços/quebras e junta os detalhes', () => {
    expect(descricaoEmpreendimento(base)).toBe('Eixo Leste: obras iniciadas em São Paulo. 1-2 Dorm · 25-45m². Um condomínio exclusivo')
  })
  it('descrição longa é cortada em palavra inteira, até ~158 caracteres', () => {
    const d = descricaoEmpreendimento({ ...base, tagline: 'palavra '.repeat(60) })
    expect(d.length).toBeLessThanOrEqual(158)
    expect(d.endsWith('palavra…')).toBe(true)
  })
  it('imagem de compartilhamento: própria ou padrão quando não há capa', () => {
    expect(ogEmpreendimento(base)).toBe('https://arkenincorporadora.com.br/og/eixo-leste.jpg')
    expect(ogEmpreendimento({ ...base, capa_url: null })).toBe('https://arkenincorporadora.com.br/og/padrao.jpg')
  })
})

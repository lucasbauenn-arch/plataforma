// Diagramação do PDF (§6.3): quebra de linha e paginação determinísticas com métrica injetada; troca de caracteres
// fora do WinAnsi.
import { describe, expect, it } from 'vitest'
import { renderizarModelo, type BlocoRenderizado } from './modelo-contrato.ts'
import { LAYOUT_A4, montarLayout, paraWinAnsi, quebrarLinhas, rodapeContrato, type MedirTexto, type OpcoesLayout } from './pdf.ts'

/** Métrica fixa: 0,5 em por caractere (0,6 em no negrito). */
const medir: MedirTexto = (t, tamanho, estilo) => [...t].length * tamanho * (estilo.startsWith('negrito') ? 0.6 : 0.5)
const trecho = (texto: string, negrito = false) => ({ texto, negrito, italico: false })
const paragrafo = (texto: string): BlocoRenderizado => ({ tipo: 'paragrafo', trechos: [trecho(texto)] })

describe('WinAnsi', () => {
  it('mantém ASCII, acentos do português e os extras do cp1252', () => {
    expect(paraWinAnsi('Ação, coração, ÇÃO — “aspas” • 1º € …')).toBe('Ação, coração, ÇÃO — “aspas” • 1º € …')
  })

  it('troca o que a Helvetica padrão não desenha', () => {
    expect(paraWinAnsi('a b c')).toBe('a b c')
    expect(paraWinAnsi('se­parar')).toBe('separar')
    expect(paraWinAnsi('A → B ≥ C ≤ D')).toBe('A -> B >= C <= D')
    expect(paraWinAnsi('Erdős Łódź')).toBe('Erdos ?ódz')
    expect(paraWinAnsi('ok 😀')).toBe('ok ?')
    expect(paraWinAnsi('linha\tcom\ncontrole')).toBe('linha com controle')
    expect(paraWinAnsi('ﬁm № 5')).toBe('fim nº 5')
  })
})

describe('quebra de linha', () => {
  it('é determinística e não passa da largura', () => {
    // 10 pt × 0,5 = 5 pt por caractere; largura 100 pt = 20 caracteres
    const linhas = quebrarLinhas([trecho('um dois tres quatro cinco seis sete oito')], 100, 10, medir)
    expect(linhas.map((l) => l.map((p) => p.texto).join(''))).toEqual(['um dois tres quatro', 'cinco seis sete oito'])
    for (const l of linhas) expect(l.reduce((s, p) => s + medir(p.texto, 10, p.estilo), 0)).toBeLessThanOrEqual(100)
  })

  it('palavra maior que a linha é partida', () => {
    const linhas = quebrarLinhas([trecho('a ' + 'x'.repeat(45))], 100, 10, medir)
    expect(linhas.map((l) => l.map((p) => p.texto).join(''))).toEqual(['a', 'x'.repeat(20), 'x'.repeat(20), 'x'.repeat(5)])
  })

  it('mantém os estilos dentro da linha e junta espaços repetidos', () => {
    const linhas = quebrarLinhas([trecho('Comprador:   '), trecho('Maria', true), trecho(', CPF 1.')], 400, 10, medir)
    expect(linhas).toEqual([[
      { texto: 'Comprador: ', estilo: 'normal' }, { texto: 'Maria', estilo: 'negrito' }, { texto: ', CPF 1.', estilo: 'normal' },
    ]])
  })
})

describe('paginação', () => {
  const opcoes: OpcoesLayout = { ...LAYOUT_A4, altura: 200, margemTopo: 20, margemBase: 20, espacoBloco: 0 }

  it('posiciona as linhas de cima para baixo e abre página nova quando acaba o espaço', () => {
    // área útil 160 pt; linha de 10,5 × 1,45 = 15,225 pt → 10 linhas por página
    const blocos = Array.from({ length: 25 }, (_, i) => paragrafo(`Linha ${i + 1}`))
    const layout = montarLayout(blocos, medir, opcoes, rodapeContrato(123))
    expect(layout.paginas).toHaveLength(3)
    expect(layout.paginas.map((p) => p.textos.length)).toEqual([11, 11, 6])
    const [primeira, segunda] = layout.paginas[0].textos
    expect(primeira).toEqual({ texto: 'Linha 1', x: 64, y: 169.5, tamanho: 10.5, estilo: 'normal' })
    expect(segunda.y).toBeCloseTo(169.5 - 15.225, 2)
    expect(layout.paginas[2].textos.at(-1)).toEqual({ texto: 'Contrato nº 0000123 · página 3 de 3', x: 64, y: 10, tamanho: 8, estilo: 'normal' })
  })

  it('a mesma entrada dá sempre o mesmo layout', () => {
    const blocos = Array.from({ length: 25 }, (_, i) => paragrafo(`Linha ${i + 1} com um pouco mais de texto para quebrar`))
    expect(JSON.stringify(montarLayout(blocos, medir, opcoes))).toBe(JSON.stringify(montarLayout(blocos, medir, opcoes)))
  })

  it('"---" força página nova; página final vazia não conta', () => {
    const layout = montarLayout([paragrafo('a'), { tipo: 'quebra_pagina' }, paragrafo('b'), { tipo: 'quebra_pagina' }], medir, opcoes)
    expect(layout.paginas.map((p) => p.textos.map((t) => t.texto))).toEqual([['a'], ['b']])
  })

  it('título não fica sozinho no pé da página', () => {
    const blocos: BlocoRenderizado[] = [
      ...Array.from({ length: 9 }, (_, i) => paragrafo(`Linha ${i + 1}`)),
      { tipo: 'titulo', nivel: 2, trechos: [trecho('Cláusula')] },
      paragrafo('Texto da cláusula'),
    ]
    const layout = montarLayout(blocos, medir, opcoes)
    expect(layout.paginas[1].textos.map((t) => t.texto)).toEqual(['Cláusula', 'Texto da cláusula'])
    expect(layout.paginas[1].textos[0].estilo).toBe('negrito')
  })

  it('listas com marcador e numeração a partir do início', () => {
    const layout = montarLayout([{ tipo: 'lista', ordenada: true, inicio: 3, itens: [[trecho('três')], [trecho('quatro')]] }], medir, LAYOUT_A4)
    const textos = layout.paginas[0].textos
    expect(textos.map((t) => t.texto)).toEqual(['três', '3.', 'quatro', '4.'])
    expect(textos[1].y).toBe(textos[0].y)
    expect(textos[1].x).toBeLessThan(textos[0].x)
  })

  it('contrato de 15 páginas é diagramado rápido (prova de viabilidade da parte de layout)', () => {
    const clausula = '## Cláusula {{codigo}}\n\n' + 'O comprador **{{nome}}** declara que leu e concorda com todas as condições. '.repeat(12)
    const modelo = Array.from({ length: 50 }, () => clausula).join('\n\n')
    const r = renderizarModelo(modelo, { codigo: 1, nome: 'Maria Exemplo' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const inicio = performance.now()
    const layout = montarLayout(r.blocos, medir, LAYOUT_A4, rodapeContrato(1))
    const ms = performance.now() - inicio
    expect(layout.paginas.length).toBeGreaterThanOrEqual(15)
    expect(ms).toBeLessThan(500)
    for (const p of layout.paginas) {
      for (const t of p.textos) {
        expect(t.y).toBeGreaterThanOrEqual(LAYOUT_A4.margemBase / 2)
        expect(t.x + medir(t.texto, t.tamanho, t.estilo)).toBeLessThanOrEqual(LAYOUT_A4.largura - LAYOUT_A4.margemDireita + 0.01)
      }
    }
  })
})

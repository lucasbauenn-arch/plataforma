// Diagramação do PDF do contrato (docs/ARQUITETURA_EXPANSAO.md §6.3): quebra de linha, paginação, rodapé
// "Contrato nº X · página N de M" e troca dos caracteres fora do WinAnsi (a codificação das fontes padrão do PDF,
// Helvetica, que cobre os acentos do português).
//
// Módulo PURO: sem Deno.*, sem npm:, sem DOM. A medida do texto é INJETADA (`MedirTexto`): na Edge contrato-gerar é
// o `widthOfTextAtSize` das fontes do pdf-lib (supabase/functions/contrato-gerar/pdf-lib.ts); nos testes, uma métrica
// fixa. Assim a diagramação é determinística e testável no Vitest, e o pdf-lib fica num arquivo só de Deno.

import type { BlocoRenderizado, Trecho } from './modelo-contrato.ts'

export type EstiloFonte = 'normal' | 'negrito' | 'italico' | 'negrito_italico'

/** Largura (em pontos) de um texto já convertido para WinAnsi, no tamanho e estilo dados. */
export type MedirTexto = (texto: string, tamanho: number, estilo: EstiloFonte) => number

export interface OpcoesLayout {
  /** Página em pontos (A4 = 595,28 × 841,89). */
  largura: number
  altura: number
  margemTopo: number
  margemBase: number
  margemEsquerda: number
  margemDireita: number
  tamanhoTexto: number
  /** Tamanhos dos títulos #, ## e ###. */
  tamanhoTitulos: readonly [number, number, number]
  /** Altura da linha = tamanho × entrelinha. */
  entrelinha: number
  /** Espaço depois de cada parágrafo, lista ou título (em pontos). */
  espacoBloco: number
  /** Recuo do texto dos itens de lista. */
  recuoLista: number
  tamanhoRodape: number
}

export const LAYOUT_A4: OpcoesLayout = {
  largura: 595.28,
  altura: 841.89,
  margemTopo: 64,
  margemBase: 64,
  margemEsquerda: 64,
  margemDireita: 64,
  tamanhoTexto: 10.5,
  tamanhoTitulos: [15, 12.5, 11],
  entrelinha: 1.45,
  espacoBloco: 7,
  recuoLista: 18,
  tamanhoRodape: 8,
}

export interface TextoPosicionado {
  texto: string
  /** Canto esquerdo da linha de base (origem no canto inferior esquerdo da página, como no PDF). */
  x: number
  y: number
  tamanho: number
  estilo: EstiloFonte
}

export interface PaginaPdf {
  textos: TextoPosicionado[]
}

export interface LayoutPdf {
  paginas: PaginaPdf[]
}

// ============ WinAnsi (cp1252) ============

/** Caracteres do cp1252 fora do Latin-1 (posições 0x80–0x9F), aceitos pelas fontes padrão. */
const CP1252_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

const TROCAS: Record<string, string> = {
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
  '­': '', '​': '', '‌': '', '‍': '', '⁠': '', '﻿': '',
  '‐': '-', '‑': '-', '‒': '–', '―': '—', '−': '-', '⁃': '-',
  '′': "'", '″': '"', '‛': "'", '‟': '"', '‵': "'",
  '←': '<-', '→': '->', '↔': '<->', '⇒': '=>', '≤': '<=', '≥': '>=', '≠': '!=',
  '≈': '~', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '●': '•', '◦': '•', '‣': '•',
  '∙': '·', '⋅': '·', '⁄': '/', '∕': '/', '№': 'nº', '™': '™',
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
}

function caractereWinAnsi(c: string): boolean {
  const cp = c.codePointAt(0) ?? 0
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa1 && cp <= 0xff && cp !== 0xad) || CP1252_EXTRAS.has(c)
}

/**
 * Converte para o que a Helvetica padrão (WinAnsi) desenha: mantém ASCII, Latin-1 e os extras do cp1252 (aspas
 * curvas, travessões, €, •); troca espaços especiais por espaço, setas e sinais por equivalentes em ASCII; tira os
 * diacríticos de letras fora do Latin-1 (ő → o); controle vira espaço; o resto vira "?".
 */
export function paraWinAnsi(texto: string): string {
  let saida = ''
  for (const c of texto) {
    if (caractereWinAnsi(c)) {
      saida += c
      continue
    }
    const troca = TROCAS[c]
    if (troca !== undefined) {
      saida += troca
      continue
    }
    const cp = c.codePointAt(0) ?? 0
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) {
      saida += ' '
      continue
    }
    const semAcento = c.normalize('NFD').replace(/\p{M}/gu, '')
    saida += semAcento && [...semAcento].every(caractereWinAnsi) ? semAcento : '?'
  }
  return saida
}

// ============ diagramação ============

const estiloDe = (t: { negrito: boolean; italico: boolean }): EstiloFonte =>
  t.negrito ? (t.italico ? 'negrito_italico' : 'negrito') : t.italico ? 'italico' : 'normal'

interface Pedaco { texto: string; estilo: EstiloFonte }
/** Palavra = pedaços sem espaço (pode mudar de estilo no meio, ex.: "**Maria**,"); `espaco` = estilo do espaço antes. */
interface Palavra { pedacos: Pedaco[]; espaco: EstiloFonte | null }

function palavrasDe(trechos: Trecho[], forcarNegrito = false): Palavra[] {
  const palavras: Palavra[] = []
  let atual: Palavra | null = null
  let espacoPendente: EstiloFonte | null = null
  for (const t of trechos) {
    const estilo = estiloDe({ negrito: t.negrito || forcarNegrito, italico: t.italico })
    for (const c of paraWinAnsi(t.texto)) {
      if (c === ' ') {
        if (atual) {
          palavras.push(atual)
          atual = null
        }
        espacoPendente ??= estilo
        continue
      }
      if (!atual) {
        atual = { pedacos: [], espaco: palavras.length ? (espacoPendente ?? estilo) : null }
        espacoPendente = null
      }
      const ultimo = atual.pedacos[atual.pedacos.length - 1]
      if (ultimo && ultimo.estilo === estilo) ultimo.texto += c
      else atual.pedacos.push({ texto: c, estilo })
    }
  }
  if (atual) palavras.push(atual)
  return palavras
}

const larguraPalavra = (p: Palavra, tamanho: number, medir: MedirTexto) =>
  p.pedacos.reduce((s, x) => s + medir(x.texto, tamanho, x.estilo), 0)

/** Quebra uma palavra maior que a linha em partes que cabem (caractere a caractere). */
function partirPalavra(p: Palavra, larguraMax: number, tamanho: number, medir: MedirTexto): Palavra[] {
  const partes: Palavra[] = []
  let atual: Palavra = { pedacos: [], espaco: p.espaco }
  let largura = 0
  for (const pedaco of p.pedacos) {
    for (const c of pedaco.texto) {
      const w = medir(c, tamanho, pedaco.estilo)
      if (largura + w > larguraMax && atual.pedacos.length) {
        partes.push(atual)
        atual = { pedacos: [], espaco: null }
        largura = 0
      }
      const ultimo = atual.pedacos[atual.pedacos.length - 1]
      if (ultimo && ultimo.estilo === pedaco.estilo) ultimo.texto += c
      else atual.pedacos.push({ texto: c, estilo: pedaco.estilo })
      largura += w
    }
  }
  if (atual.pedacos.length) partes.push(atual)
  return partes
}

/** Linhas de pedaços (com os espaços já incluídos) que cabem em `larguraMax`. */
export function quebrarLinhas(trechos: Trecho[], larguraMax: number, tamanho: number, medir: MedirTexto,
                              forcarNegrito = false): Pedaco[][] {
  const linhas: Pedaco[][] = []
  let linha: Pedaco[] = []
  let largura = 0
  const acrescentar = (p: Pedaco) => {
    const ultimo = linha[linha.length - 1]
    if (ultimo && ultimo.estilo === p.estilo) ultimo.texto += p.texto
    else linha.push({ ...p })
  }
  for (const palavraOriginal of palavrasDe(trechos, forcarNegrito)) {
    const w0 = larguraPalavra(palavraOriginal, tamanho, medir)
    const partes = w0 > larguraMax ? partirPalavra(palavraOriginal, larguraMax, tamanho, medir) : [palavraOriginal]
    for (const palavra of partes) {
      const w = larguraPalavra(palavra, tamanho, medir)
      const espaco = linha.length && palavra.espaco ? medir(' ', tamanho, palavra.espaco) : 0
      if (linha.length && largura + espaco + w > larguraMax) {
        linhas.push(linha)
        linha = []
        largura = 0
      }
      if (linha.length && palavra.espaco) {
        acrescentar({ texto: ' ', estilo: palavra.espaco })
        largura += espaco
      }
      for (const p of palavra.pedacos) acrescentar(p)
      largura += w
    }
  }
  if (linha.length) linhas.push(linha)
  return linhas
}

/**
 * Diagrama os blocos renderizados (renderizarModelo) em páginas. Determinística: a mesma entrada e a mesma métrica
 * dão sempre as mesmas posições. `rodape(n, total)` escreve o rodapé de cada página (depois da paginação, para saber
 * o total).
 */
export function montarLayout(blocos: BlocoRenderizado[], medir: MedirTexto, opcoes: OpcoesLayout = LAYOUT_A4,
                             rodape?: (pagina: number, total: number) => string): LayoutPdf {
  const paginas: PaginaPdf[] = [{ textos: [] }]
  const larguraUtil = opcoes.largura - opcoes.margemEsquerda - opcoes.margemDireita
  const topo = opcoes.altura - opcoes.margemTopo
  let y = topo
  let vazia = true

  const pagina = () => paginas[paginas.length - 1]
  const novaPagina = () => {
    paginas.push({ textos: [] })
    y = topo
    vazia = true
  }
  const cabe = (altura: number) => y - altura >= opcoes.margemBase
  /** Desenha uma linha (nova página se não couber) e devolve a página e a linha de base usadas. */
  const desenharLinha = (linha: Pedaco[], x0: number, tamanho: number) => {
    const alturaLinha = tamanho * opcoes.entrelinha
    if (!vazia && !cabe(alturaLinha)) novaPagina()
    const base = y - tamanho
    const alvo = pagina()
    let x = x0
    for (const p of linha) {
      if (p.texto.trim()) alvo.textos.push({ texto: p.texto, x: arred(x), y: arred(base), tamanho, estilo: p.estilo })
      x += medir(p.texto, tamanho, p.estilo)
    }
    y -= alturaLinha
    vazia = false
    return { alvo, base }
  }

  for (const bloco of blocos) {
    if (bloco.tipo === 'quebra_pagina') {
      if (!vazia) novaPagina()
      continue
    }
    if (bloco.tipo === 'titulo') {
      const tamanho = opcoes.tamanhoTitulos[bloco.nivel - 1]
      const linhas = quebrarLinhas(bloco.trechos, larguraUtil, tamanho, medir, true)
      // o título não fica sozinho no pé da página: precisa caber com uma linha de texto depois
      const necessario = linhas.length * tamanho * opcoes.entrelinha + opcoes.tamanhoTexto * opcoes.entrelinha + opcoes.espacoBloco
      if (!vazia) {
        y -= opcoes.espacoBloco
        if (!cabe(necessario)) novaPagina()
      }
      for (const l of linhas) desenharLinha(l, opcoes.margemEsquerda, tamanho)
      y -= opcoes.espacoBloco / 2
      continue
    }
    if (bloco.tipo === 'paragrafo') {
      for (const l of quebrarLinhas(bloco.trechos, larguraUtil, opcoes.tamanhoTexto, medir)) {
        desenharLinha(l, opcoes.margemEsquerda, opcoes.tamanhoTexto)
      }
      y -= opcoes.espacoBloco
      continue
    }
    // lista
    const tamanho = opcoes.tamanhoTexto
    const xTexto = opcoes.margemEsquerda + opcoes.recuoLista
    bloco.itens.forEach((item, i) => {
      const marcador = bloco.ordenada ? `${bloco.inicio + i}.` : '•'
      const linhas = quebrarLinhas(item, larguraUtil - opcoes.recuoLista, tamanho, medir)
      if (!linhas.length) linhas.push([])
      linhas.forEach((l, j) => {
        const { alvo, base } = desenharLinha(l, xTexto, tamanho)
        if (j === 0) {
          const larguraMarcador = medir(marcador, tamanho, 'normal')
          alvo.textos.push({ texto: marcador, x: arred(xTexto - 6 - larguraMarcador), y: arred(base), tamanho, estilo: 'normal' })
        }
      })
    })
    y -= opcoes.espacoBloco
  }

  // página final vazia (ex.: "---" no fim) não conta
  if (paginas.length > 1 && !paginas[paginas.length - 1].textos.length) paginas.pop()
  if (rodape) {
    const total = paginas.length
    paginas.forEach((p, i) => {
      const texto = paraWinAnsi(rodape(i + 1, total))
      p.textos.push({ texto, x: opcoes.margemEsquerda, y: arred(opcoes.margemBase / 2), tamanho: opcoes.tamanhoRodape, estilo: 'normal' })
    })
  }
  return { paginas }
}

const arred = (v: number) => Math.round(v * 100) / 100

/** Rodapé padrão: "Contrato nº 0000123 · página 2 de 5". */
export const rodapeContrato = (codigo: number | string) => (pagina: number, total: number) =>
  `Contrato nº ${String(codigo).replace(/\D/g, '').padStart(7, '0')} · página ${pagina} de ${total}`

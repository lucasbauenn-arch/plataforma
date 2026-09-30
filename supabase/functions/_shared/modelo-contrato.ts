// Modelos de contrato em marcação restrita "marcacao_v1" (docs/ARQUITETURA_EXPANSAO.md §6.3). Nunca HTML.
//
//   # Título / ## Subtítulo / ### Seção     títulos (3 níveis)
//   linhas seguidas                          um parágrafo (as quebras de linha viram espaço)
//   linha em branco                          separa blocos
//   - item                                   lista com marcador
//   1. item                                  lista numerada (a numeração começa no primeiro número)
//   ---                                      quebra de página
//   **negrito**  *itálico*  \*  \\           ênfases e escapes; marcador sem par vira texto
//   {{variavel}}                             variável da lista permitida (mesma lista do gatilho da migration 07)
//
// O analisador gera uma árvore neutra; `renderizarModelo` troca as variáveis por TEXTO já formatado (dinheiro com
// centavos, CPF/CNPJ e CEP mascarados). Como a troca acontece na árvore, um valor nunca é interpretado como marcação.
// O mesmo módulo alimenta a prévia no front (React, sem dangerouslySetInnerHTML) e o PDF (pdf.ts + pdf-lib).
// Variável desconhecida ou usada e vazia → erro que lista os campos (nunca gera documento incompleto).
//
// Módulo PURO: sem Deno.*, sem npm:, sem DOM (alias @shared no front).

import { formatarMoeda, formatarPercentual } from './simulacao.ts'

/** Lista permitida (§6.3): as da doc + as acrescentadas ⚑. Igual à do gatilho `_contrato_modelos_variaveis` (07). */
export const VARIAVEIS_MODELO = [
  'codigo', 'nome', 'sobrenome', 'cpf-cnpj', 'logradouro', 'numero', 'bairro', 'cidade', 'estado', 'cep',
  'valor-propriedade', 'valor-parcela',
  'data', 'rg', 'estado-civil', 'nacionalidade', 'complemento', 'produto', 'produto-matricula', 'percentual-aporte',
  'valor-aporte', 'valor-entrada', 'base-parcelada', 'numero-parcelas', 'taxa-aporte', 'valor-minimo-flex',
  'corretor-nome', 'corretor-creci', 'imobiliaria-nome', 'vendedora-razao-social', 'vendedora-cnpj',
  'vendedora-endereco',
] as const

export type NomeVariavel = (typeof VARIAVEIS_MODELO)[number]

const PERMITIDAS = new Set<string>(VARIAVEIS_MODELO)
export const variavelPermitida = (nome: string): nome is NomeVariavel => PERMITIDAS.has(nome)

/** Rótulos para a paleta do editor e para a lista "complete na aba Dados". */
export const ROTULOS_VARIAVEIS: Record<NomeVariavel, string> = {
  codigo: 'Número do contrato', nome: 'Nome do cliente', sobrenome: 'Sobrenome do cliente', 'cpf-cnpj': 'CPF/CNPJ do cliente',
  logradouro: 'Logradouro', numero: 'Número', bairro: 'Bairro', cidade: 'Cidade', estado: 'Estado (UF)', cep: 'CEP',
  'valor-propriedade': 'Valor do produto', 'valor-parcela': 'Valor da parcela', data: 'Data de emissão', rg: 'RG',
  'estado-civil': 'Estado civil', nacionalidade: 'Nacionalidade', complemento: 'Complemento', produto: 'Produto',
  'produto-matricula': 'Matrícula do imóvel', 'percentual-aporte': '% de aporte próprio', 'valor-aporte': 'Valor do aporte',
  'valor-entrada': 'Entrada', 'base-parcelada': 'Base parcelada', 'numero-parcelas': 'Número de parcelas',
  'taxa-aporte': 'Taxa do aporte', 'valor-minimo-flex': 'Mínimo por pagamento (flexível)', 'corretor-nome': 'Nome do corretor',
  'corretor-creci': 'CRECI do corretor', 'imobiliaria-nome': 'Imobiliária', 'vendedora-razao-social': 'Razão social da vendedora',
  'vendedora-cnpj': 'CNPJ da vendedora', 'vendedora-endereco': 'Endereço da vendedora',
}

/** Variáveis que vêm do cadastro do cliente (as vazias viram "complete na aba Dados"). */
export const VARIAVEIS_DO_CLIENTE: readonly NomeVariavel[] = [
  'nome', 'sobrenome', 'cpf-cnpj', 'logradouro', 'numero', 'bairro', 'cidade', 'estado', 'cep', 'rg', 'estado-civil',
  'nacionalidade', 'complemento',
]

// ============ árvore ============

export type Inline =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'variavel'; nome: string }
  | { tipo: 'negrito'; filhos: Inline[] }
  | { tipo: 'italico'; filhos: Inline[] }

export type Bloco =
  | { tipo: 'titulo'; nivel: 1 | 2 | 3; conteudo: Inline[] }
  | { tipo: 'paragrafo'; conteudo: Inline[] }
  | { tipo: 'lista'; ordenada: boolean; inicio: number; itens: Inline[][] }
  | { tipo: 'quebra_pagina' }

/** Pedaço de texto já resolvido, com o estilo. */
export interface Trecho { texto: string; negrito: boolean; italico: boolean }

export type BlocoRenderizado =
  | { tipo: 'titulo'; nivel: 1 | 2 | 3; trechos: Trecho[] }
  | { tipo: 'paragrafo'; trechos: Trecho[] }
  | { tipo: 'lista'; ordenada: boolean; inicio: number; itens: Trecho[][] }
  | { tipo: 'quebra_pagina' }

// ============ análise inline ============

type Token =
  | { t: 'texto'; v: string }
  | { t: 'var'; v: string }
  | { t: 'mk'; v: '**' | '*' }

function tokenizar(linha: string): Token[] {
  const tokens: Token[] = []
  let buf = ''
  const soltar = () => { if (buf) { tokens.push({ t: 'texto', v: buf }); buf = '' } }
  let i = 0
  while (i < linha.length) {
    const c = linha[i]
    if (c === '\\' && (linha[i + 1] === '*' || linha[i + 1] === '\\')) {
      buf += linha[i + 1]
      i += 2
      continue
    }
    if (c === '{' && linha[i + 1] === '{') {
      const fim = linha.indexOf('}}', i + 2)
      const dentro = fim >= 0 ? linha.slice(i + 2, fim) : null
      // mesma regra do SQL: {{ ... }} sem { nem } dentro
      if (dentro !== null && !/[{}]/.test(dentro)) {
        soltar()
        tokens.push({ t: 'var', v: dentro })
        i = fim + 2
        continue
      }
    }
    if (c === '*') {
      soltar()
      if (linha[i + 1] === '*') {
        tokens.push({ t: 'mk', v: '**' })
        i += 2
      } else {
        tokens.push({ t: 'mk', v: '*' })
        i += 1
      }
      continue
    }
    buf += c
    i++
  }
  soltar()
  return tokens
}

function juntarTexto(nos: Inline[]): Inline[] {
  const saida: Inline[] = []
  for (const n of nos) {
    const ultimo = saida[saida.length - 1]
    if (n.tipo === 'texto' && ultimo?.tipo === 'texto') saida[saida.length - 1] = { tipo: 'texto', texto: ultimo.texto + n.texto }
    else if (n.tipo !== 'texto' || n.texto) saida.push(n)
  }
  return saida
}

function analisarTokens(tokens: Token[]): Inline[] {
  const nos: Inline[] = []
  let i = 0
  while (i < tokens.length) {
    const tk = tokens[i]
    if (tk.t === 'texto') { nos.push({ tipo: 'texto', texto: tk.v }); i++; continue }
    if (tk.t === 'var') { nos.push({ tipo: 'variavel', nome: tk.v }); i++; continue }
    // marcador: procura o par do mesmo tipo mais adiante; sem par, é texto
    let j = i + 1
    while (j < tokens.length && !(tokens[j].t === 'mk' && tokens[j].v === tk.v)) j++
    if (j < tokens.length && j > i + 1) {
      const filhos = analisarTokens(tokens.slice(i + 1, j))
      nos.push(tk.v === '**' ? { tipo: 'negrito', filhos } : { tipo: 'italico', filhos })
      i = j + 1
    } else {
      nos.push({ tipo: 'texto', texto: tk.v })
      i++
    }
  }
  return juntarTexto(nos)
}

export const analisarInline = (texto: string): Inline[] => analisarTokens(tokenizar(texto))

// ============ análise de blocos ============

const RE_TITULO = /^(#{1,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const RE_ITEM = /^[ \t]*-[ \t]+(.+)$/
const RE_NUMERADO = /^[ \t]*(\d{1,4})[.)][ \t]+(.+)$/
const RE_QUEBRA = /^[ \t]*-{3,}[ \t]*$/

/** Analisa a marcação restrita. Nunca falha: o que não é sintaxe vira texto. */
export function analisarMarcacao(conteudo: string): Bloco[] {
  const blocos: Bloco[] = []
  const linhas = conteudo.replace(/\r\n?/g, '\n').split('\n')
  let paragrafo: string[] = []
  let lista: { ordenada: boolean; inicio: number; itens: string[] } | null = null
  const fecharParagrafo = () => {
    if (paragrafo.length) {
      blocos.push({ tipo: 'paragrafo', conteudo: analisarInline(paragrafo.join(' ')) })
      paragrafo = []
    }
  }
  const fecharLista = () => {
    if (lista) {
      blocos.push({ tipo: 'lista', ordenada: lista.ordenada, inicio: lista.inicio, itens: lista.itens.map(analisarInline) })
      lista = null
    }
  }
  for (const bruta of linhas) {
    const linha = bruta.replace(/\t/g, ' ')
    if (!linha.trim()) { fecharParagrafo(); fecharLista(); continue }
    if (RE_QUEBRA.test(linha)) { fecharParagrafo(); fecharLista(); blocos.push({ tipo: 'quebra_pagina' }); continue }
    const t = RE_TITULO.exec(linha.trim())
    if (t) {
      fecharParagrafo(); fecharLista()
      blocos.push({ tipo: 'titulo', nivel: t[1].length as 1 | 2 | 3, conteudo: analisarInline(t[2]) })
      continue
    }
    const item = RE_ITEM.exec(linha)
    const num = item ? null : RE_NUMERADO.exec(linha)
    if (item || num) {
      fecharParagrafo()
      const ordenada = !!num
      const lst = lista as { ordenada: boolean; inicio: number; itens: string[] } | null
      if (lst && lst.ordenada !== ordenada) fecharLista()
      if (!lista) lista = { ordenada, inicio: num ? Number(num[1]) : 1, itens: [] }
      ;(lista as { itens: string[] }).itens.push((item ? item[1] : num![2]).trim())
      continue
    }
    fecharLista()
    paragrafo.push(linha.trim())
  }
  fecharParagrafo()
  fecharLista()
  return blocos
}

// ============ validação (espelho do gatilho da migration 07) ============

export interface ValidacaoModelo {
  /** Variáveis usadas (distintas, em ordem alfabética). */
  variaveis: string[]
  /** Usadas e fora da lista permitida. */
  invalidas: string[]
  /** Sobra "{{" ou "}}" sem par depois de tirar as variáveis. */
  chavesSemPar: boolean
}

export function validarModelo(conteudo: string): ValidacaoModelo {
  const usadas = new Set<string>()
  for (const m of conteudo.matchAll(/\{\{([^{}]*)\}\}/g)) usadas.add(m[1])
  const variaveis = [...usadas].sort()
  return {
    variaveis,
    invalidas: variaveis.filter((v) => !variavelPermitida(v)),
    chavesSemPar: /(\{\{|\}\})/.test(conteudo.replace(/\{\{[^{}]*\}\}/g, '')),
  }
}

// ============ formatação das variáveis ============

export type ValorVariavel = string | number | null | undefined

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
  'novembro', 'dezembro']

const ESTADO_CIVIL: Record<string, string> = {
  solteiro: 'solteiro(a)', casado: 'casado(a)', divorciado: 'divorciado(a)', viuvo: 'viúvo(a)', uniao_estavel: 'em união estável',
}

const VARIAVEIS_MOEDA = new Set<string>(['valor-propriedade', 'valor-parcela', 'valor-aporte', 'valor-entrada', 'base-parcelada', 'valor-minimo-flex'])
const VARIAVEIS_PERCENTUAL = new Set<string>(['percentual-aporte', 'taxa-aporte'])

const digitos = (v: string) => v.replace(/\D/g, '')

export function mascaraCpfCnpj(v: string): string {
  const d = digitos(v)
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  return v
}

/** "2026-09-28" → "28 de setembro de 2026". Outro formato sai como veio. */
export function dataPorExtenso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const mes = MESES[Number(m[2]) - 1]
  return mes ? `${Number(m[3])} de ${mes} de ${m[1]}` : iso
}

/** Número do contrato com 7 dígitos ("0000123"), como no rodapé do PDF. */
export const codigoContrato = (v: number | string) => String(v).replace(/\D/g, '').padStart(7, '0')

/** Texto final de uma variável (valor cru de `contrato_dados_modelo` → texto do contrato). Vazio → nulo. */
export function formatarVariavel(nome: string, valor: ValorVariavel): string | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'number' && !Number.isFinite(valor)) return null
  const texto = String(valor).replace(/\s+/g, ' ').trim()
  if (!texto) return null
  if (VARIAVEIS_MOEDA.has(nome)) return formatarMoeda(typeof valor === 'number' ? valor : texto)
  if (VARIAVEIS_PERCENTUAL.has(nome)) return formatarPercentual(typeof valor === 'number' ? valor : texto)
  switch (nome) {
    case 'cpf-cnpj':
    case 'vendedora-cnpj':
      return mascaraCpfCnpj(texto)
    case 'cep': {
      const d = digitos(texto)
      return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : texto
    }
    case 'data':
      return dataPorExtenso(texto)
    case 'codigo':
      return codigoContrato(texto)
    case 'estado-civil':
      return ESTADO_CIVIL[texto] ?? texto
    default:
      return texto
  }
}

// ============ renderização ============

export type Renderizacao =
  | { ok: true; blocos: BlocoRenderizado[]; texto: string; variaveis: string[] }
  | { ok: false; desconhecidas: string[]; vazias: string[] }

function coletarVariaveis(nos: Inline[], saida: Set<string>) {
  for (const n of nos) {
    if (n.tipo === 'variavel') saida.add(n.nome)
    else if (n.tipo === 'negrito' || n.tipo === 'italico') coletarVariaveis(n.filhos, saida)
  }
}

export function variaveisDaArvore(blocos: Bloco[]): string[] {
  const s = new Set<string>()
  for (const b of blocos) {
    if (b.tipo === 'titulo' || b.tipo === 'paragrafo') coletarVariaveis(b.conteudo, s)
    else if (b.tipo === 'lista') for (const it of b.itens) coletarVariaveis(it, s)
  }
  return [...s].sort()
}

function resolver(nos: Inline[], valores: Map<string, string>, negrito: boolean, italico: boolean, saida: Trecho[]) {
  for (const n of nos) {
    if (n.tipo === 'texto') saida.push({ texto: n.texto, negrito, italico })
    else if (n.tipo === 'variavel') saida.push({ texto: valores.get(n.nome) ?? '', negrito, italico })
    else if (n.tipo === 'negrito') resolver(n.filhos, valores, true, italico, saida)
    else resolver(n.filhos, valores, negrito, true, saida)
  }
}

function juntarTrechos(trechos: Trecho[]): Trecho[] {
  const saida: Trecho[] = []
  for (const t of trechos) {
    if (!t.texto) continue
    const u = saida[saida.length - 1]
    if (u && u.negrito === t.negrito && u.italico === t.italico) saida[saida.length - 1] = { ...u, texto: u.texto + t.texto }
    else saida.push({ ...t })
  }
  return saida
}

const trechosDe = (nos: Inline[], valores: Map<string, string>, negrito = false) => {
  const s: Trecho[] = []
  resolver(nos, valores, negrito, false, s)
  return juntarTrechos(s)
}

/** Texto plano canônico do contrato (base do `texto_sha256`). */
export function textoPlano(blocos: BlocoRenderizado[]): string {
  const t = (tr: Trecho[]) => tr.map((x) => x.texto).join('')
  return blocos.map((b) => {
    switch (b.tipo) {
      case 'titulo': return `${'#'.repeat(b.nivel)} ${t(b.trechos)}`
      case 'paragrafo': return t(b.trechos)
      case 'lista': return b.itens.map((it, i) => `${b.ordenada ? `${b.inicio + i}.` : '-'} ${t(it)}`).join('\n')
      case 'quebra_pagina': return '---'
    }
  }).join('\n\n')
}

/**
 * Troca as variáveis pelos valores formatados. Falha (sem gerar nada) se houver variável fora da lista permitida
 * ou usada e sem valor, listando os nomes.
 */
export function renderizarModelo(conteudo: string, variaveis: Record<string, ValorVariavel>): Renderizacao {
  const arvore = analisarMarcacao(conteudo)
  const usadas = variaveisDaArvore(arvore)
  const desconhecidas = usadas.filter((v) => !variavelPermitida(v))
  const valores = new Map<string, string>()
  const vazias: string[] = []
  for (const v of usadas) {
    if (!variavelPermitida(v)) continue
    const f = formatarVariavel(v, Object.prototype.hasOwnProperty.call(variaveis, v) ? variaveis[v] : null)
    if (f === null) vazias.push(v)
    else valores.set(v, f)
  }
  if (desconhecidas.length || vazias.length) return { ok: false, desconhecidas, vazias }
  const blocos: BlocoRenderizado[] = arvore.map((b): BlocoRenderizado => {
    switch (b.tipo) {
      case 'titulo': return { tipo: 'titulo', nivel: b.nivel, trechos: trechosDe(b.conteudo, valores) }
      case 'paragrafo': return { tipo: 'paragrafo', trechos: trechosDe(b.conteudo, valores) }
      case 'lista': return { tipo: 'lista', ordenada: b.ordenada, inicio: b.inicio, itens: b.itens.map((it) => trechosDe(it, valores)) }
      case 'quebra_pagina': return { tipo: 'quebra_pagina' }
    }
  })
  return { ok: true, blocos, texto: textoPlano(blocos), variaveis: usadas }
}

/** Dados de exemplo para a prévia do editor de modelos (nenhum dado real). */
export const DADOS_EXEMPLO: Record<NomeVariavel, string | number> = {
  codigo: 123, nome: 'Maria', sobrenome: 'Exemplo da Silva', 'cpf-cnpj': '12345678909', logradouro: 'Rua das Flores',
  numero: '100', bairro: 'Centro', cidade: 'São Paulo', estado: 'SP', cep: '01001000', 'valor-propriedade': 500000,
  'valor-parcela': 1808.33, data: '2026-09-28', rg: '12.345.678-9', 'estado-civil': 'casado', nacionalidade: 'brasileira',
  complemento: 'Apto 12', produto: 'Residencial Exemplo · Apto 12', 'produto-matricula': '12.345', 'percentual-aporte': 30,
  'valor-aporte': 150000, 'valor-entrada': 50000, 'base-parcelada': 100000, 'numero-parcelas': 60, 'taxa-aporte': 8.5,
  'valor-minimo-flex': 5000, 'corretor-nome': 'João Corretor', 'corretor-creci': '123456-F', 'imobiliaria-nome': 'Imobiliária Exemplo',
  'vendedora-razao-social': 'ARKEN INCORPORADORA LTDA', 'vendedora-cnpj': '11222333000181', 'vendedora-endereco': 'Av. Exemplo, 1000, São Paulo/SP',
}

// Busca de produtos no servidor (WP4R-06): o texto digitado vira um padrão de expressão regular sem diferença de
// maiúsculas nem de acentos, aplicado pelo PostgREST (operador `imatch`, `~*` no Postgres). Assim a busca alcança todas
// as unidades e imóveis, não só as primeiras que chegam ao navegador. Módulo puro (testado em busca.test.ts).

/** Tamanho máximo do texto de busca (o resto é ignorado). */
export const MAXIMO_BUSCA = 60

/** Quantos produtos a lista mostra; quem passar disso precisa refinar a busca. */
export const LIMITE_PRODUTOS = 50

const VARIANTES: Record<string, string> = {
  a: '[aáàâãä]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôõö]', u: '[uúùûü]', c: '[cç]', n: '[nñ]',
}

/** Texto limpo para a busca: sem acentos, minúsculo, espaços simples (o "·" do nome exibido vira espaço). */
export function textoDeBusca(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, MAXIMO_BUSCA).trim()
}

/**
 * Padrão para `imatch` a partir do que a pessoa digitou: metacaracteres escapados (nada do texto vira operador),
 * vogais, c e n casam com as versões acentuadas e espaços casam com qualquer sequência de espaços. Vazio → nulo.
 */
export function padraoBusca(texto: string): string | null {
  const limpo = textoDeBusca(texto)
  if (!limpo) return null
  let padrao = ''
  for (const ch of limpo) {
    if (ch === ' ') padrao += '\\s+'
    else if (VARIANTES[ch]) padrao += VARIANTES[ch]
    else if (/[\\^$.|?*+()[\]{}-]/.test(ch)) padrao += `\\${ch}`
    else padrao += ch
  }
  return padrao
}

/** Junta os resultados das buscas (por unidade e por empreendimento), sem repetir, em ordem de nome e com o limite. */
export function juntarProdutos<T extends { id: string; nome: string }>(listas: T[][], limite = LIMITE_PRODUTOS): { itens: T[]; cortado: boolean } {
  const vistos = new Map<string, T>()
  for (const lista of listas) for (const p of lista) if (!vistos.has(p.id)) vistos.set(p.id, p)
  const todos = [...vistos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
  return { itens: todos.slice(0, limite), cortado: todos.length > limite || listas.some((l) => l.length >= limite) }
}

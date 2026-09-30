// Acesso a dados do módulo Contratos [WP4] (docs/ARQUITETURA_EXPANSAO.md §3.6, §4.4, §6.3, §6.4, §7.3).
// Contratos não têm grant para `authenticated`: tudo por RPC (src/lib/rpc.ts) ou pelas Edge Functions contrato-gerar
// e contrato-assinatura, que chamam as RPCs com o JWT do usuário. Produtos (unidades e imóveis aprovados) e os
// parâmetros vigentes da simulação são lidos direto, com a RLS (não têm dado pessoal).

import { supabase } from '@/lib/supabase'
import { contratoBaixar, urlDoDownload } from '@/lib/rpc'
import { ErroRpc, traduzirErro, type CodigoErro } from '@/lib/erros'
import type { Uuid } from '@/lib/types'
import type { ParametrosSimulacao } from '@/modulos/config/tipos'
import type { ContratosFiltros, ProdutoResumo, StatusRetornoD4sign } from './tipos'
import { juntarProdutos, LIMITE_PRODUTOS, padraoBusca } from './busca'

export const chavesContratos = {
  todos: ['contratos'] as const,
  lista: (f: ContratosFiltros) => ['contratos', 'lista', f] as const,
  detalhe: (id: string) => ['contratos', 'detalhe', id] as const,
  texto: (id: string) => ['contratos', 'texto', id] as const,
  produtos: (tipo: TipoProduto, busca: string) => ['contratos', 'produtos', tipo, busca] as const,
  parametros: ['contratos', 'parametros-vigentes'] as const,
}

export const EDGE_GERAR = 'contrato-gerar'
export const EDGE_ASSINATURA = 'contrato-assinatura'

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ehUuid = (v: string | null | undefined): v is string => !!v && RE_UUID.test(v)

// ---------- Edge Functions ----------

interface CorpoErroEdge { erro?: unknown; codigo?: unknown; detalhes?: unknown }

/** Erro de uma Edge de contrato → ErroRpc em pt-BR. Erro de RPC repassado pela Edge é traduzido como o de uma RPC. */
async function erroDaEdge(error: unknown, nome: string): Promise<ErroRpc> {
  const contexto = (error as { context?: { status?: number; json?: () => Promise<unknown> } } | null)?.context
  const corpo = contexto?.json ? ((await contexto.json().catch(() => null)) as CorpoErroEdge | null) : null
  const detalhes = corpo?.detalhes as { code?: unknown } | null | undefined
  if (corpo?.codigo === 'rpc' && detalhes && typeof detalhes.code === 'string') return traduzirErro(detalhes, nome)
  const status = contexto?.status
  const codigo: CodigoErro = status === 401 ? 'SESSAO_EXPIRADA' : status === 403 ? 'SEM_ACESSO'
    : corpo?.codigo === 'variaveis_faltando' ? 'DADOS_INVALIDOS' : 'DESCONHECIDO'
  const mensagem = typeof corpo?.erro === 'string' && corpo.erro ? corpo.erro : traduzirErro(error, nome).message
  return new ErroRpc(codigo, mensagem, { rpc: nome, detalhe: corpo?.detalhes ?? null })
}

async function invocarEdge<T>(nome: string, corpo: Record<string, unknown>): Promise<T> {
  let resposta
  try {
    resposta = await supabase.functions.invoke<T>(nome, { body: corpo })
  } catch (e) {
    throw traduzirErro(e, nome)
  }
  if (resposta.error) throw await erroDaEdge(resposta.error, nome)
  return resposta.data as T
}

/** Gera a próxima versão da minuta (PDF). Falta de dado: ErroRpc DADOS_INVALIDOS com detalhe {desconhecidas, vazias}. */
export const gerarPdf = (contratoId: Uuid) =>
  invocarEdge<{ ok: true; versao: number; path: string }>(EDGE_GERAR, { contrato_id: contratoId })

/** Envio para assinatura no D4Sign (só internos; o servidor confere). */
export const enviarParaAssinatura = (contratoId: Uuid) =>
  invocarEdge<{ ok: true; status: 'assinatura_pendente' }>(EDGE_ASSINATURA, { acao: 'enviar', contrato_id: contratoId })

/** Cancela no D4Sign e, depois, muda o status para cancelado (com o motivo). */
export const cancelarEnvio = (contratoId: Uuid, motivo: string) =>
  invocarEdge<{ ok: true; status: 'cancelado' }>(EDGE_ASSINATURA, { acao: 'cancelar', contrato_id: contratoId, motivo })

/** Reconsulta o documento e os signatários no D4Sign. */
export const atualizarAssinatura = (contratoId: Uuid) =>
  invocarEdge<{ ok: true; status: StatusRetornoD4sign | null }>(EDGE_ASSINATURA, { acao: 'atualizar', contrato_id: contratoId })

/**
 * Abre o PDF numa aba nova: `contrato_baixar` (escopo e auditoria) e a Edge `baixar-arquivo` (URL assinada curta).
 * A aba abre já no clique (bloqueio de pop-up) e recebe o endereço quando ele chega.
 */
export async function abrirPdf(contratoId: Uuid, tipo: 'minuta' | 'assinado', versao: number | null = null): Promise<void> {
  const aba = window.open('about:blank', '_blank')
  if (aba) aba.opener = null
  try {
    const url = await urlDoDownload(await contratoBaixar({ p_id: contratoId, p_tipo: tipo, p_versao: versao }))
    if (aba && !aba.closed) aba.location.href = url
    else window.location.assign(url)
  } catch (e) {
    aba?.close()
    throw e
  }
}

// ---------- produtos (leitura direta, RLS) ----------

export type TipoProduto = 'unidade' | 'imovel'

/** Produto na lista de escolha: o valor serve só para a prévia; o contrato usa o valor lido no servidor (N16). */
export type ProdutoOpcao = ProdutoResumo

interface LinhaUnidade {
  id: string
  identificador: string
  valor: number | null
  empreendimentos: { id: string; nome: string } | { id: string; nome: string }[] | null
}

const opcaoDaUnidade = (u: LinhaUnidade): ProdutoOpcao => {
  const e = Array.isArray(u.empreendimentos) ? u.empreendimentos[0] ?? null : u.empreendimentos
  return { tipo: 'unidade', id: u.id, nome: `${e?.nome ?? 'Empreendimento'} · ${u.identificador}`, codigo: null, empreendimento: e ?? null, valor: u.valor }
}

/**
 * Unidades não vendidas e com valor de tabela (N5) ou imóveis aprovados e ativos (E2). A busca é feita no SERVIDOR
 * (WP4R-06), sem diferença de maiúsculas nem de acentos: unidade pelo identificador OU pelo nome do empreendimento
 * (duas consultas); imóvel pelo #código ou pelo nome. `cortado` avisa que há mais resultados que o limite.
 */
export async function buscarProdutos(tipo: TipoProduto, busca: string): Promise<{ itens: ProdutoOpcao[]; cortado: boolean }> {
  const termo = busca.trim()
  const padrao = padraoBusca(termo)
  if (tipo === 'unidade') {
    const consulta = () => supabase.from('unidades')
      .select('id, identificador, valor, empreendimentos!inner(id, nome)')
      .neq('status', 'vendida').not('valor', 'is', null)
    const buscas = padrao
      ? [
        consulta().filter('identificador', 'imatch', padrao).order('identificador').limit(LIMITE_PRODUTOS),
        consulta().filter('empreendimentos.nome', 'imatch', padrao).order('identificador').limit(LIMITE_PRODUTOS),
      ]
      : [consulta().order('identificador').limit(LIMITE_PRODUTOS)]
    const respostas = await Promise.all(buscas)
    const erro = respostas.find((x) => x.error)?.error
    if (erro) throw traduzirErro(erro)
    return juntarProdutos(respostas.map((x) => ((x.data ?? []) as unknown as LinhaUnidade[]).map(opcaoDaUnidade)))
  }
  let consulta = supabase.from('imoveis').select('id, codigo, nome, valor')
    .eq('status', 'aprovado').is('inativado_em', null).order('codigo', { ascending: false }).limit(LIMITE_PRODUTOS)
  const codigo = /^#?\d{1,12}$/.test(termo) ? Number(termo.replace('#', '')) : null
  if (codigo != null) consulta = consulta.eq('codigo', codigo)
  else if (padrao) consulta = consulta.filter('nome', 'imatch', padrao)
  const { data, error } = await consulta
  if (error) throw traduzirErro(error)
  const itens = ((data ?? []) as { id: string; codigo: number; nome: string | null; valor: number | null }[]).map((i): ProdutoOpcao => ({
    tipo: 'imovel', id: i.id, nome: i.nome?.trim() || `Imóvel #${String(i.codigo).padStart(7, '0')}`, codigo: i.codigo,
    empreendimento: null, valor: i.valor,
  }))
  return { itens, cortado: itens.length >= LIMITE_PRODUTOS }
}

/** Versão vigente de parametros_simulacao (parceiros só enxergam a vigente; internos, todas). Para a prévia. */
export async function parametrosVigentes(): Promise<ParametrosSimulacao | null> {
  const { data, error } = await supabase.from('parametros_simulacao').select('*')
    .lte('vigente_desde', new Date().toISOString())
    .order('vigente_desde', { ascending: false }).order('criado_em', { ascending: false }).limit(1)
  if (error) throw traduzirErro(error)
  return ((data ?? [])[0] as ParametrosSimulacao | undefined) ?? null
}

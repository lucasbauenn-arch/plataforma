// Apoio do front da Rede [WP1]: chaves do TanStack Query, leituras pela API com RLS (imobiliárias, parceiros sem CPF,
// autocadastros pendentes) e a chamada da Edge convidar-parceiros. As escritas e as leituras com CPF são RPCs
// (src/lib/rpc.ts); os formatos estão em ./tipos.ts. O escopo é sempre decidido pelo servidor (a RLS de parceiros já
// limita: imobiliária vê a própria; gerente, ele e os corretores dele; internos, tudo).

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ErroRpc, MENSAGENS, mensagemErroEdge, traduzirErro } from '@/lib/erros'
import {
  lgpdTermoVigente, redeAtualizarMeuCadastro, redeCadastrarParceiro, redeParceiroDetalhe, type ArgsRpc,
} from '@/lib/rpc'
import { montarPedidoConvite, type ModoConvite, type ResultadoConvite } from '@/lib/convites'
import type { Pagina, StatusParceiro, TipoParceiro, Uuid } from '@/lib/types'
import { COLUNAS_PARCEIRO, type Imobiliaria, type Parceiro, type ParceiroDetalhe, type ParceiroEdicao } from './tipos'
import { cpfFicouGravado, termoBusca } from './regras'

export const POR_PAGINA = 25

export const chavesRede = {
  /** Prefixo de tudo da rede (invalide depois de qualquer escrita). */
  tudo: ['rede'] as const,
  parceiros: (f: FiltrosParceiros) => ['rede', 'parceiros', f] as const,
  opcoes: (f: FiltrosOpcoes) => ['rede', 'opcoes', f] as const,
  imobiliarias: (f: FiltrosImobiliarias) => ['rede', 'imobiliarias', f] as const,
  imobiliaria: (id: Uuid) => ['rede', 'imobiliaria', id] as const,
  detalhe: (id: Uuid) => ['rede', 'parceiro', id] as const,
  pendentes: ['rede', 'pendentes'] as const,
  termoParceiro: ['lgpd-termo', 'termos_parceiro'] as const,
}

// ============ parceiros (RLS; sem CPF) ============

export type SituacaoFiltro = 'ativos' | 'inativos' | 'todos'

export interface FiltrosParceiros {
  busca: string
  tipo: TipoParceiro | ''
  imobiliariaId: Uuid | null
  gerenteId: Uuid | null
  situacao: SituacaoFiltro
  offset: number
  /** Inclui a cadeia virtual da casa (só faz sentido para internos). */
  virtuais?: boolean
  /** Tira da lista (ex.: o próprio gerente na tela Equipe). */
  excluirId?: Uuid | null
}

/** Linha da lista: colunas liberadas de `parceiros` + nomes da imobiliária e do gerente + status do acesso (se visível). */
export interface LinhaParceiro extends Parceiro {
  imobiliaria: { nome: string; da_casa: boolean } | null
  gerente: { nome: string } | null
  /** Só aparece para internos (a RLS de profiles deixa o parceiro ler só o próprio perfil). */
  perfil: { status_parceiro: StatusParceiro } | null
}

// Autorrelação (parceiros → parceiros): o PostgREST 14 só acha o vínculo pela COLUNA (`!gerente_id`); com o nome da
// FK (`!parceiros_gerente_id_fkey`) responde PGRST200 e a lista da Rede não abria (achado na stack real, WP7).
const SELECAO_LINHA = `${COLUNAS_PARCEIRO}, imobiliaria:imobiliarias(nome, da_casa), gerente:parceiros!gerente_id(nome), perfil:profiles!parceiros_profile_id_fkey(status_parceiro)`

export async function listarParceiros(f: FiltrosParceiros): Promise<Pagina<LinhaParceiro>> {
  let q = supabase.from('parceiros').select(SELECAO_LINHA, { count: 'exact' })
  if (f.tipo) q = q.eq('tipo', f.tipo)
  if (f.imobiliariaId) q = q.eq('imobiliaria_id', f.imobiliariaId)
  if (f.gerenteId) q = q.eq('gerente_id', f.gerenteId)
  if (f.situacao === 'ativos') q = q.is('inativado_em', null)
  if (f.situacao === 'inativos') q = q.not('inativado_em', 'is', null)
  if (!f.virtuais) q = q.eq('virtual', false)
  if (f.excluirId) q = q.neq('id', f.excluirId)
  const t = termoBusca(f.busca)
  if (t) q = q.or(`nome.ilike.%${t}%,email.ilike.%${t}%,creci.ilike.%${t}%`)
  const { data, error, count } = await q
    .order('inativado_em', { ascending: false, nullsFirst: true })
    .order('nome')
    .range(f.offset, f.offset + POR_PAGINA - 1)
  if (error) throw traduzirErro(error)
  return { total: count ?? 0, itens: (data ?? []) as unknown as LinhaParceiro[] }
}

export interface FiltrosOpcoes {
  tipos: TipoParceiro[]
  imobiliariaId?: Uuid | null
  /** Todas as imobiliárias (seleção de gerente para internos). */
  todas?: boolean
}

export type OpcaoParceiro = Pick<Parceiro, 'id' | 'nome' | 'tipo' | 'imobiliaria_id' | 'gerente_id' | 'inativado_em' | 'virtual'> & {
  imobiliaria: { nome: string; da_casa: boolean } | null
}

/** Parceiros ativos no escopo, para seletores (destino, gerente, novo gerente). Até 500, por nome. */
export async function listarOpcoes(f: FiltrosOpcoes): Promise<OpcaoParceiro[]> {
  let q = supabase.from('parceiros')
    .select('id, nome, tipo, imobiliaria_id, gerente_id, inativado_em, virtual, imobiliaria:imobiliarias(nome, da_casa)')
    .is('inativado_em', null)
    .in('tipo', f.tipos)
  if (f.imobiliariaId) q = q.eq('imobiliaria_id', f.imobiliariaId)
  const { data, error } = await q.order('nome').limit(500)
  if (error) throw traduzirErro(error)
  return (data ?? []) as unknown as OpcaoParceiro[]
}

export function useOpcoes(f: FiltrosOpcoes, habilitado = true) {
  return useQuery({ queryKey: chavesRede.opcoes(f), queryFn: () => listarOpcoes(f), enabled: habilitado, staleTime: 30_000 })
}

// ============ escritas com resposta a interpretar [WP1R-04] ============

const cpfIndisponivel = (rpc: string) => new ErroRpc('DOCUMENTO_INDISPONIVEL', MENSAGENS.DOCUMENTO_INDISPONIVEL, { rpc })

/**
 * rede_cadastrar_parceiro. Para parceiros, CPF que já é de outro parceiro devolve `null` (a tentativa fica na
 * auditoria e conta no limite por hora): vira o erro DOCUMENTO_INDISPONIVEL, como os internos já recebem.
 */
export async function cadastrarParceiro(args: ArgsRpc<'rede_cadastrar_parceiro'>): Promise<Uuid> {
  const id = await redeCadastrarParceiro(args)
  if (!id) throw cpfIndisponivel('rede_cadastrar_parceiro')
  return id
}

/**
 * rede_atualizar_meu_cadastro. Com CPF, relê o próprio cadastro: se o CPF enviado não ficou gravado (já é de outro
 * parceiro; a RPC não lança para a tentativa ficar na auditoria), nada mudou e vira o erro DOCUMENTO_INDISPONIVEL.
 */
export async function atualizarMeuCadastro(parceiroId: Uuid, dados: ParceiroEdicao): Promise<ParceiroDetalhe | null> {
  await redeAtualizarMeuCadastro({ p_dados: dados })
  if (!dados.cpf) return null
  const detalhe = await redeParceiroDetalhe({ p_id: parceiroId })
  if (!cpfFicouGravado(dados.cpf, detalhe)) throw cpfIndisponivel('rede_atualizar_meu_cadastro')
  return detalhe
}

/** Detalhe auditado (com CPF): `null` fora do escopo. */
export function useParceiroDetalhe(id: Uuid | null | undefined) {
  return useQuery({
    queryKey: chavesRede.detalhe(id ?? ''),
    queryFn: () => redeParceiroDetalhe({ p_id: id! }),
    enabled: !!id,
    // cada leitura grava auditoria (acesso/consultar): nada de reconsultar ao voltar para a aba
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })
}

// ============ imobiliárias (RLS: internos todas; parceiro a própria) ============

export interface FiltrosImobiliarias {
  busca: string
  situacao: SituacaoFiltro
}

export async function listarImobiliarias(f: FiltrosImobiliarias): Promise<Imobiliaria[]> {
  let q = supabase.from('imobiliarias').select('*')
  if (f.situacao === 'ativos') q = q.is('inativado_em', null)
  if (f.situacao === 'inativos') q = q.not('inativado_em', 'is', null)
  const t = termoBusca(f.busca)
  if (t) q = q.or(`nome.ilike.%${t}%,razao_social.ilike.%${t}%,cidade.ilike.%${t}%`)
  const { data, error } = await q.order('da_casa', { ascending: false }).order('nome').limit(500)
  if (error) throw traduzirErro(error)
  return (data ?? []) as Imobiliaria[]
}

export async function buscarImobiliaria(id: Uuid): Promise<Imobiliaria | null> {
  const { data, error } = await supabase.from('imobiliarias').select('*').eq('id', id).maybeSingle()
  if (error) throw traduzirErro(error)
  return (data as Imobiliaria | null) ?? null
}

// ============ autocadastros pendentes (internos; perfis, sem CPF) ============

export interface Pendente {
  id: Uuid
  nome: string
  email: string | null
  telefone: string | null
  creci: string | null
  imobiliaria: string | null
  created_at: string
}

/** Perfis 'parceiro' pendentes e sem vínculo na rede (autocadastro pelo site, N18). */
export async function listarPendentes(): Promise<Pendente[]> {
  const { data, error } = await supabase.from('profiles')
    .select('id, nome, email, telefone, creci, imobiliaria, created_at, vinculo:parceiros!parceiros_profile_id_fkey(id)')
    .eq('papel', 'parceiro')
    .eq('status_parceiro', 'pendente')
    .is('inativado_em', null)
    .order('created_at')
    .limit(500)
  if (error) throw traduzirErro(error)
  type Linha = Pendente & { vinculo: { id: Uuid } | { id: Uuid }[] | null }
  return ((data ?? []) as unknown as Linha[])
    .filter((p) => !p.vinculo || (Array.isArray(p.vinculo) && p.vinculo.length === 0))
    .map((p) => ({ id: p.id, nome: p.nome, email: p.email, telefone: p.telefone, creci: p.creci, imobiliaria: p.imobiliaria, created_at: p.created_at }))
}

// ============ termo de parceiro (Meu cadastro) ============

export function useTermoParceiro(habilitado = true) {
  return useQuery({
    queryKey: chavesRede.termoParceiro,
    queryFn: () => lgpdTermoVigente({ p_tipo: 'termos_parceiro' }),
    enabled: habilitado,
    staleTime: 5 * 60_000,
  })
}

// ============ convite (Edge convidar-parceiros, §6.2) ============

export const EDGE_CONVITE = 'convidar-parceiros'

/** Convida (ou reenvia o convite de) parceiros. Quem pode convidar quem é decidido pelo servidor, parceiro a parceiro. */
export async function convidarParceiros(ids: readonly Uuid[], modo: ModoConvite): Promise<ResultadoConvite[]> {
  const corpo = montarPedidoConvite(ids, modo, window.location.origin)
  let resposta
  try {
    resposta = await supabase.functions.invoke<{ resultados?: ResultadoConvite[] }>(EDGE_CONVITE, { body: corpo })
  } catch (e) {
    throw traduzirErro(e, EDGE_CONVITE)
  }
  if (resposta.error) {
    const status = (resposta.error as { context?: { status?: unknown } }).context?.status
    throw new ErroRpc(status === 401 ? 'SESSAO_EXPIRADA' : 'DESCONHECIDO', await mensagemErroEdge(resposta.error), { rpc: EDGE_CONVITE })
  }
  const resultados = resposta.data?.resultados
  if (!Array.isArray(resultados)) throw new ErroRpc('DESCONHECIDO', 'Resposta inesperada do servidor. Tente de novo.', { rpc: EDGE_CONVITE })
  return resultados
}

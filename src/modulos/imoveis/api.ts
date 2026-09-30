// Acesso a dados do módulo Imóveis [WP5] (docs/ARQUITETURA_EXPANSAO.md §3.7, §3.10, §4.2–§4.4).
// Imóvel não tem dado pessoal: leitura e escrita dos campos editáveis vão direto na tabela, com a RLS da regra E4 e
// o grant por coluna (nunca `status`, `codigo`, `criado_por` nem a cadeia). Status, fotos e inativação só por RPC
// (src/lib/rpc.ts). Fotos: bucket privado `imoveis` (URL assinada; política pela mesma regra E4).

import { supabase } from '@/lib/supabase'
import { contratosListar, imovelFotoRegistrar, imovelFotoRemover } from '@/lib/rpc'
import { ErroRpc, traduzirErro } from '@/lib/erros'
import type { Pagina, StatusContrato, StatusImovel, Uuid } from '@/lib/types'
import type { StatusTransicao } from '@/modulos/config/tipos'
import type { HistoricoStatus } from '@/modulos/governanca/tipos'
import type { Imovel, ImovelDados, ImovelFoto, ImovelTipo } from './tipos'
import { interpretarBusca, padraoIlike } from './formulario'
import { caminhosDaFoto, reduzirImagem } from './imagem'
import { erroDoStorage } from './envio'

export const BUCKET_IMOVEIS = 'imoveis'
export const POR_PAGINA = 20
/** Validade das URLs assinadas das fotos (a consulta é refeita antes de vencer). */
export const VALIDADE_URL_SEGUNDOS = 3600

export const chavesImoveis = {
  todas: ['imoveis'] as const,
  lista: (f: FiltrosLista) => ['imoveis', 'lista', f] as const,
  item: (id: string) => ['imoveis', 'item', id] as const,
  fotos: (id: string) => ['imoveis', 'fotos', id] as const,
  historico: (id: string) => ['imoveis', 'historico', id] as const,
  tipos: ['imoveis', 'tipos'] as const,
  transicoes: ['imoveis', 'transicoes'] as const,
  limites: ['imoveis', 'limites-fotos'] as const,
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ehUuid = (v: string | undefined | null): v is string => !!v && RE_UUID.test(v)

function falhou(error: unknown): never {
  throw traduzirErro(error)
}

// ---------- lista ----------

export type AbaLista = 'todos' | StatusImovel

export interface FiltrosLista {
  aba: AbaLista
  busca: string
  offset: number
  /** Inclui inativados (só aparecem para quem os enxerga: criador, cadeia acima e internos). */
  inativos: boolean
  /** Só os cadastrados por este perfil. */
  criadoPor: string | null
}

export type ImovelResumo = Pick<Imovel,
  'id' | 'codigo' | 'nome' | 'tipo' | 'status' | 'cidade' | 'uf' | 'valor' | 'criado_por' | 'criado_em' | 'atualizado_em'
  | 'inativado_em'>

const COLUNAS_RESUMO = 'id, codigo, nome, tipo, status, cidade, uf, valor, criado_por, criado_em, atualizado_em, inativado_em'

export async function listarImoveis(f: FiltrosLista): Promise<Pagina<ImovelResumo>> {
  let q = supabase.from('imoveis').select(COLUNAS_RESUMO, { count: 'exact' })
  if (f.aba !== 'todos') q = q.eq('status', f.aba)
  if (!f.inativos) q = q.is('inativado_em', null)
  if (f.criadoPor) q = q.eq('criado_por', f.criadoPor)
  const { codigo, nome } = interpretarBusca(f.busca)
  // código: só dígitos (seguro dentro do or() do PostgREST); nome: filtro próprio, com curingas escapados
  if (codigo != null) q = q.or(`codigo.eq.${codigo},nome.ilike.*${codigo}*`)
  else if (nome) q = q.ilike('nome', padraoIlike(nome))
  const { data, error, count } = await q
    .order('atualizado_em', { ascending: false, nullsFirst: false })
    .order('criado_em', { ascending: false })
    .order('codigo', { ascending: false })
    .range(f.offset, f.offset + POR_PAGINA - 1)
  if (error) falhou(error)
  return { total: count ?? 0, itens: (data ?? []) as ImovelResumo[] }
}

// ---------- registro ----------

/** Nulo para inexistente ou fora da regra E4 (a RLS não diz qual). */
export async function buscarImovel(id: string): Promise<Imovel | null> {
  if (!ehUuid(id)) return null
  const { data, error } = await supabase.from('imoveis').select('*').eq('id', id).maybeSingle()
  if (error) falhou(error)
  return (data as Imovel | null) ?? null
}

/** Cadastro (sempre em rascunho; `criado_por` = quem está logado, pelo padrão da coluna). */
export async function criarImovel(dados: ImovelDados): Promise<Imovel> {
  const { data, error } = await supabase.from('imoveis').insert(dados).select('*').single()
  if (error) falhou(error)
  return data as Imovel
}

/** Edição só das colunas enviadas. 0 linhas = mudou de status ou perdeu a permissão enquanto a tela estava aberta. */
export async function atualizarImovel(id: string, dados: ImovelDados): Promise<Imovel> {
  const { data, error } = await supabase.from('imoveis').update(dados).eq('id', id).select('*').maybeSingle()
  if (error) falhou(error)
  if (!data) {
    throw new ErroRpc('SEM_ACESSO',
      'Não foi possível salvar: o imóvel mudou de status ou você não pode mais editá-lo. Recarregue a página.')
  }
  return data as Imovel
}

// ---------- apoio ----------

export async function listarTipos(): Promise<ImovelTipo[]> {
  const { data, error } = await supabase.from('imovel_tipos').select('*').order('rotulo')
  if (error) falhou(error)
  return (data ?? []) as ImovelTipo[]
}

export async function listarTransicoes(): Promise<StatusTransicao[]> {
  const { data, error } = await supabase.from('status_transicoes').select('*').eq('entidade', 'imovel')
  if (error) falhou(error)
  return (data ?? []) as StatusTransicao[]
}

export interface LimitesFotos { maximo: number; maxBytes: number }
/** Padrões da §3.9, usados se a configuração não puder ser lida. */
export const LIMITES_PADRAO: LimitesFotos = { maximo: 20, maxBytes: 5 * 1024 * 1024 }

/** `configuracao_publica` (parceiros aprovados e internos). O servidor confere de novo no registro da foto. */
export async function limitesFotos(): Promise<LimitesFotos> {
  const { data, error } = await supabase.from('configuracao_publica').select('imovel_fotos_max, imovel_foto_max_bytes').maybeSingle()
  if (error || !data) return LIMITES_PADRAO
  const d = data as { imovel_fotos_max: number | null; imovel_foto_max_bytes: number | null }
  return { maximo: d.imovel_fotos_max ?? LIMITES_PADRAO.maximo, maxBytes: d.imovel_foto_max_bytes ?? LIMITES_PADRAO.maxBytes }
}

/** Status do contrato com o imóvel em NC: enviado para assinatura (efeito `imovel_no_contrato`) ou assinado. */
export const STATUS_CONTRATO_NC: StatusContrato[] = ['assinatura_pendente', 'assinado']

/**
 * Contrato que deixou o imóvel em NC, entre os que quem consulta acompanha (escopo do cliente, conferido pela RPC,
 * que audita a consulta). `contratos_listar` filtra pelo produto (`imovel_id`, migration 13): o mais novo em assinatura
 * ou assinado. Nulo se não houver (ou se estiver fora do escopo de quem consulta). Não depende do nome do imóvel.
 */
export async function contratoDoImovel(imovel: Pick<Imovel, 'id'>): Promise<Uuid | null> {
  const r = await contratosListar({ p_filtros: { imovel_id: imovel.id, status: STATUS_CONTRATO_NC, limite: 1, offset: 0 } })
  const contrato = (r?.itens ?? []).find((k) => k.produto?.tipo === 'imovel' && k.produto.id === imovel.id)
  return contrato?.id ?? null
}

export type ItemHistorico = HistoricoStatus & { ator_nome: string | null }

/** `historico_status` do imóvel: só internos leem (a política devolve zero linhas para os demais). */
export async function historicoImovel(id: string): Promise<ItemHistorico[]> {
  const { data, error } = await supabase.from('historico_status').select('*')
    .eq('entidade', 'imovel').eq('entidade_id', id).order('ocorrido_em', { ascending: false }).limit(100)
  if (error) falhou(error)
  const linhas = (data ?? []) as HistoricoStatus[]
  const ids = [...new Set(linhas.map((h) => h.ator_id).filter((x): x is string => !!x))]
  const nomes = new Map<string, string>()
  if (ids.length) {
    const r = await supabase.from('profiles').select('id, nome, email').in('id', ids)
    for (const p of (r.data ?? []) as { id: string; nome: string | null; email: string | null }[]) {
      nomes.set(p.id, p.nome?.trim() || p.email || '')
    }
  }
  return linhas.map((h) => ({ ...h, ator_nome: h.ator_id ? nomes.get(h.ator_id) || null : null }))
}

// ---------- fotos ----------

export async function listarFotos(imovelId: string): Promise<ImovelFoto[]> {
  const { data, error } = await supabase.from('imovel_fotos').select('*').eq('imovel_id', imovelId)
    .order('ordem').order('criado_em')
  if (error) falhou(error)
  return (data ?? []) as ImovelFoto[]
}

/** URLs assinadas (bucket privado). Caminho sem URL (sem acesso ou removido) fica de fora. */
export async function urlsAssinadas(caminhos: string[]): Promise<Record<string, string>> {
  if (!caminhos.length) return {}
  const { data, error } = await supabase.storage.from(BUCKET_IMOVEIS).createSignedUrls(caminhos, VALIDADE_URL_SEGUNDOS)
  if (error) throw erroDoStorage(error)
  const saida: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) saida[d.path] = d.signedUrl
  return saida
}

export interface FotoComUrl extends ImovelFoto {
  /** Miniatura (ou a própria foto, se não houver miniatura). */
  url: string | null
}

export async function fotosComUrls(imovelId: string): Promise<FotoComUrl[]> {
  const fotos = await listarFotos(imovelId)
  const urls = await urlsAssinadas(fotos.map((f) => f.miniatura_path ?? f.storage_path))
  return fotos.map((f) => ({ ...f, url: urls[f.miniatura_path ?? f.storage_path] ?? null }))
}

export async function urlDaFoto(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_IMOVEIS).createSignedUrl(caminho, VALIDADE_URL_SEGUNDOS)
  if (error || !data?.signedUrl) throw erroDoStorage(error ?? { message: 'Foto indisponível' })
  return data.signedUrl
}

/** Apaga objetos do bucket sem interromper o fluxo (arquivo que sobrar vira órfão, sem linha em imovel_fotos). */
async function apagarObjetos(caminhos: string[]) {
  try {
    await supabase.storage.from(BUCKET_IMOVEIS).remove(caminhos)
  } catch {
    // ignora: a política de remoção é a mesma do envio; falha aqui não muda o que o banco registrou
  }
}

/**
 * Envia uma foto: reduz no navegador, grava principal e miniatura no bucket (sem sobrescrever) e registra pela RPC,
 * que confere no Storage o tamanho e o tipo reais e o limite de quantidade. Se o registro falhar, os arquivos
 * enviados são apagados.
 */
export async function enviarFoto(imovelId: string, arquivo: File, maxBytes: number): Promise<Uuid> {
  const r = await reduzirImagem(arquivo, maxBytes)
  const caminhos = caminhosDaFoto(imovelId, crypto.randomUUID(), r.extensao)
  const opcoes = { contentType: r.tipo, upsert: false, cacheControl: '31536000' }
  const bucket = supabase.storage.from(BUCKET_IMOVEIS)
  const enviados: string[] = []
  try {
    const a = await bucket.upload(caminhos.principal, r.principal, { ...opcoes, metadata: { largura: r.largura, altura: r.altura } })
    if (a.error) throw erroDoStorage(a.error)
    enviados.push(caminhos.principal)
    const b = await bucket.upload(caminhos.miniatura, r.miniatura, opcoes)
    if (b.error) throw erroDoStorage(b.error)
    enviados.push(caminhos.miniatura)
    return await imovelFotoRegistrar({ p_imovel_id: imovelId, p_path: caminhos.principal, p_miniatura_path: caminhos.miniatura })
  } catch (e) {
    if (enviados.length) await apagarObjetos(enviados)
    throw e
  }
}

/** Remove o registro (RPC) e depois os arquivos do bucket. */
export async function removerFoto(foto: Pick<ImovelFoto, 'id' | 'storage_path' | 'miniatura_path'>): Promise<void> {
  await imovelFotoRemover({ p_id: foto.id })
  await apagarObjetos([foto.storage_path, ...(foto.miniatura_path ? [foto.miniatura_path] : [])])
}

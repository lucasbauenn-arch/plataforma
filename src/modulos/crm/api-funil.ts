// Acesso a dados do funil e das atividades do CRM [WP3] (docs/ARQUITETURA_EXPANSAO.md §3.8, §3.10, §4.3, §4.4, §7.3).
// Dado pessoal de cliente só por RPC (src/lib/rpc.ts), sempre auditada no servidor. Direto em tabela, só o que não é
// dado pessoal e tem política para parceiros aprovados e internos: `status_transicoes` (destinos do kanban),
// `configuracao_publica` (documentos básicos e limite de arquivo) e `imobiliarias` (filtro dos internos).
// Upload: bucket privado `crm-documentos`, política de INSERT = `pode_enviar_documento` (sem SELECT nem upsert);
// download: `crm_documento_baixar` (auditada) + Edge `baixar-arquivo` (URL assinada até `expira_em`).

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { crmDocumentoBaixar, crmDocumentoRegistrarEnvio, urlDoDownload } from '@/lib/rpc'
import { ErroRpc, traduzirErro } from '@/lib/erros'
import type { Ref, Uuid } from '@/lib/types'
import { caminhoDoArquivo, conferirArquivo, type TransicaoFunil } from './funil'
import type { ClienteDocumento, KanbanFiltros, TarefasFiltros } from './tipos'

export const BUCKET_DOCUMENTOS = 'crm-documentos'
/** Cartões por coluna na primeira carga do kanban (a RPC aceita até 200; "Ver mais" traz de 50 em 50). */
export const CARTOES_POR_COLUNA = 50
export const TAREFAS_POR_PAGINA = 50
export const EVENTOS_POR_PAGINA = 30
/** Padrão de `configuracao_geral.documento_max_bytes`, enquanto a configuração não carrega. */
export const MAX_BYTES_PADRAO = 5 * 1024 * 1024

export const chavesFunil = {
  kanbanTodas: ['crm-funil', 'kanban'] as const,
  kanban: (f: KanbanFiltros) => ['crm-funil', 'kanban', f] as const,
  transicoes: ['crm-funil', 'transicoes'] as const,
  config: ['crm-funil', 'config-documentos'] as const,
  imobiliarias: ['crm-funil', 'imobiliarias'] as const,
  timeline: (id: Uuid) => ['crm-funil', 'timeline', id] as const,
  notas: (id: Uuid) => ['crm-funil', 'notas', id] as const,
  tarefas: (id: Uuid) => ['crm-funil', 'tarefas', id] as const,
  responsaveis: (id: Uuid) => ['crm-funil', 'responsaveis', id] as const,
  documentos: (id: Uuid) => ['crm-funil', 'documentos', id] as const,
  minhasTarefasTodas: ['crm-funil', 'minhas-tarefas'] as const,
  minhasTarefas: (f: TarefasFiltros) => ['crm-funil', 'minhas-tarefas', f] as const,
}

// ---------- tabelas sem dado pessoal ----------

/** Transições do funil (`status_transicoes`, entidade `cliente_etapa`), para esmaecer as colunas proibidas. */
export async function listarTransicoesFunil(): Promise<TransicaoFunil[]> {
  const { data, error } = await supabase
    .from('status_transicoes')
    .select('de, para, papeis, sistema, exige_motivo, efeitos, ativa')
    .eq('entidade', 'cliente_etapa')
  if (error) throw traduzirErro(error)
  return (data ?? []) as TransicaoFunil[]
}

export const useTransicoesFunil = () =>
  useQuery({ queryKey: chavesFunil.transicoes, queryFn: listarTransicoesFunil, staleTime: 5 * 60_000 })

export interface ConfigDocumentos { documentos_basicos: string[]; documento_max_bytes: number }

/** Documentos básicos (CRM-3) e limite de arquivo, da view `configuracao_publica`. */
export async function lerConfigDocumentos(): Promise<ConfigDocumentos> {
  const { data, error } = await supabase.from('configuracao_publica').select('documentos_basicos, documento_max_bytes').maybeSingle()
  if (error) throw traduzirErro(error)
  const d = data as Partial<ConfigDocumentos> | null
  return {
    documentos_basicos: Array.isArray(d?.documentos_basicos) ? d.documentos_basicos : [],
    documento_max_bytes: typeof d?.documento_max_bytes === 'number' && d.documento_max_bytes > 0 ? d.documento_max_bytes : MAX_BYTES_PADRAO,
  }
}

export const useConfigDocumentos = () =>
  useQuery({ queryKey: chavesFunil.config, queryFn: lerConfigDocumentos, staleTime: 10 * 60_000 })

/** Imobiliárias ativas (filtro do kanban dos internos; a RLS limita os demais à própria). */
export async function listarImobiliarias(): Promise<Ref[]> {
  const { data, error } = await supabase.from('imobiliarias').select('id, nome').is('inativado_em', null).order('nome')
  if (error) throw traduzirErro(error)
  return (data ?? []) as Ref[]
}

// ---------- arquivos de documento ----------

function erroDoUpload(e: unknown): ErroRpc {
  const bruto = (e ?? {}) as { message?: unknown; statusCode?: unknown; status?: unknown }
  const msg = typeof bruto.message === 'string' ? bruto.message : ''
  const status = Number(bruto.statusCode ?? bruto.status)
  if (status === 413 || /too large|maximum allowed size/i.test(msg)) {
    return new ErroRpc('ARQUIVO_INVALIDO', 'O arquivo passa do tamanho permitido.')
  }
  if (status === 415 || /mime type|not supported/i.test(msg)) {
    return new ErroRpc('ARQUIVO_INVALIDO', 'Tipo de arquivo não permitido.')
  }
  if (status === 403 || /row-level security|unauthorized|not allowed/i.test(msg)) {
    return new ErroRpc('SEM_ACESSO', 'Este documento não está aguardando envio, ou você não tem acesso a ele.')
  }
  return traduzirErro(e)
}

/**
 * Envia o arquivo de uma solicitação (em nome do cliente): confere tipo e tamanho no navegador, grava no bucket em
 * `<cliente_id>/<documento_id>/<uuid>.<ext>` (upsert desligado: a política só permite INSERT) e registra o envio,
 * que confere tamanho e MIME reais no servidor e leva o documento a "em análise".
 */
export async function enviarArquivoDocumento(doc: Pick<ClienteDocumento, 'id' | 'cliente_id' | 'formatos_aceitos'>, arquivo: File, maxBytes: number) {
  const c = conferirArquivo(arquivo, doc.formatos_aceitos, maxBytes)
  if (!c.ok) throw new ErroRpc('ARQUIVO_INVALIDO', c.erro)
  const caminho = caminhoDoArquivo(doc.cliente_id, doc.id, crypto.randomUUID(), c.ext)
  // o supabase-js manda Blob como multipart e usa o tipo do próprio Blob (a opção contentType fica de fora): o tipo
  // conferido vai no Blob, para o bucket (allowed_mime_types) e o registro verem o mesmo MIME
  const corpo = new Blob([arquivo], { type: c.mime })
  let enviado
  try {
    enviado = await supabase.storage.from(BUCKET_DOCUMENTOS).upload(caminho, corpo, { upsert: false, contentType: c.mime, cacheControl: '0' })
  } catch (e) {
    throw erroDoUpload(e)
  }
  if (enviado.error) throw erroDoUpload(enviado.error)
  await crmDocumentoRegistrarEnvio({ p_documento_id: doc.id, p_path: caminho })
}

/**
 * Abre o arquivo numa aba nova: `crm_documento_baixar` (confere o escopo e audita) e a Edge `baixar-arquivo` (URL
 * assinada). A aba é aberta já no clique, para o navegador não bloquear, e recebe o endereço quando ele chega.
 */
export async function abrirArquivo(arquivoId: Uuid): Promise<void> {
  const aba = window.open('about:blank', '_blank')
  if (aba) aba.opener = null
  try {
    const url = await urlDoDownload(await crmDocumentoBaixar({ p_arquivo_id: arquivoId }))
    if (aba && !aba.closed) aba.location.href = url
    else window.location.assign(url)
  } catch (e) {
    aba?.close()
    throw e
  }
}

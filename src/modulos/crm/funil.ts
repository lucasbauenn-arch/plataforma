// Regras puras do funil e das atividades [WP3] (docs/ARQUITETURA_EXPANSAO.md §3.8, §3.10, §7.3), sem React nem rede.
// Só decidem o que a tela OFERECE: o servidor confere tudo de novo em `crm_mudar_etapa` (tabela `status_transicoes`,
// papel e escopo) e em `crm_documento_registrar_envio` (tamanho e MIME reais do Storage).

import { ETAPAS, FORMATOS_DOCUMENTO, ORDEM_ETAPAS } from '@/lib/constants'
import type { EtapaFunil, FormatoDocumento, Papel } from '@/lib/types'
import type { StatusTransicao } from '@/modulos/config/tipos'
import type { KanbanCartao, KanbanResultado, TimelineEvento } from './tipos'

// =====================================================================================================
// Destinos de arraste no kanban (a partir de `status_transicoes`, entidade `cliente_etapa`)
// =====================================================================================================

/** Colunas de `status_transicoes` que o kanban usa (a política deixa parceiros aprovados e internos lerem). */
export type TransicaoFunil = Pick<StatusTransicao, 'de' | 'para' | 'papeis' | 'sistema' | 'exige_motivo' | 'efeitos' | 'ativa'>

/** O que a tela faz ao soltar o cartão: mover na hora, pedir o motivo (Perdidos) ou confirmar os documentos (Documentação). */
export type AcaoAoSoltar = 'mover' | 'pedir_motivo' | 'confirmar_documentos'

export interface DestinoArraste {
  para: EtapaFunil
  permitido: boolean
  /** Nulo quando não é permitido. */
  acao: AcaoAoSoltar | null
  exigeMotivo: boolean
  /** Dica da coluna esmaecida (nula quando é permitido). */
  dica: string | null
}

export const DICAS_ETAPA = {
  finalizaSozinho: 'Finaliza automaticamente quando o contrato é assinado.',
  finalizado: 'Cliente finalizado não muda de etapa.',
  voltar: 'Voltar de etapa não é permitido.',
  desligada: 'Esta mudança está desligada nas configurações.',
  papel: 'Seu perfil não pode fazer esta mudança.',
  reativar: 'Para reativar, mova para Novo contato.',
  pular: 'Passe antes por Contato iniciado.',
  proibida: 'Esta mudança de etapa não é permitida.',
} as const

const ordem = (e: EtapaFunil) => ETAPAS[e].ordem
/** Volta entre NC, CI e DO (Perdido e Finalizado não contam como "voltar"). */
const ehVolta = (de: EtapaFunil, para: EtapaFunil) =>
  de !== 'perdido' && para !== 'perdido' && de !== 'finalizado' && para !== 'finalizado' && ordem(para) < ordem(de)

/** Se `papel` pode levar um cliente de `de` para `para`, e o que a tela faz ao soltar. */
export function destinoPara(
  transicoes: readonly TransicaoFunil[], papel: Papel | null | undefined, de: EtapaFunil, para: EtapaFunil,
): DestinoArraste {
  const negado = (dica: string): DestinoArraste => ({ para, permitido: false, acao: null, exigeMotivo: false, dica })
  if (de === para) return negado(DICAS_ETAPA.proibida)
  if (de === 'finalizado') return negado(DICAS_ETAPA.finalizado)
  const t = transicoes.find((x) => x.de === de && x.para === para)
  if (t && t.ativa && papel && t.papeis.includes(papel)) {
    // 'perdido' sempre exige motivo no servidor (check de clientes), mesmo que a linha diga o contrário
    const exigeMotivo = t.exige_motivo || para === 'perdido'
    const acao: AcaoAoSoltar = exigeMotivo ? 'pedir_motivo' : t.efeitos.includes('solicitar_documentos_basicos') ? 'confirmar_documentos' : 'mover'
    return { para, permitido: true, acao, exigeMotivo, dica: null }
  }
  if (para === 'finalizado') return negado(DICAS_ETAPA.finalizaSozinho)
  if (t && t.ativa) return negado(t.papeis.length === 0 ? DICAS_ETAPA.proibida : DICAS_ETAPA.papel)
  if (t) return negado(ehVolta(de, para) ? DICAS_ETAPA.voltar : DICAS_ETAPA.desligada)
  if (de === 'perdido') return negado(DICAS_ETAPA.reativar)
  if (ehVolta(de, para)) return negado(DICAS_ETAPA.voltar)
  if (de === 'novo_contato' && para === 'documentacao') return negado(DICAS_ETAPA.pular)
  return negado(DICAS_ETAPA.proibida)
}

/** Todas as outras colunas, na ordem do funil, com o que é permitido a partir de `de`. */
export function destinosDoCartao(transicoes: readonly TransicaoFunil[], papel: Papel | null | undefined, de: EtapaFunil): DestinoArraste[] {
  return ORDEM_ETAPAS.filter((e) => e !== de).map((para) => destinoPara(transicoes, papel, de, para))
}

/** Só os destinos que `papel` pode acionar (menu "Mover para…"). */
export const destinosPermitidos = (transicoes: readonly TransicaoFunil[], papel: Papel | null | undefined, de: EtapaFunil) =>
  destinosDoCartao(transicoes, papel, de).filter((d) => d.permitido)

// =====================================================================================================
// Movimento otimista no kanban (o cartão muda na hora e volta se a RPC falhar)
// =====================================================================================================

/** Acha o cartão em qualquer coluna. */
export function acharCartao(k: KanbanResultado, id: string): KanbanCartao | null {
  for (const c of k.colunas) {
    const cartao = c.itens.find((i) => i.id === id)
    if (cartao) return cartao
  }
  return null
}

/**
 * Tira o cartão da coluna atual e põe no topo de `para` (a ordem do servidor é `etapa_desde` mais recente primeiro),
 * ajustando os totais das duas colunas. Sem o cartão, devolve o mesmo objeto.
 */
export function moverCartao(k: KanbanResultado, id: string, para: EtapaFunil, agoraIso: string, motivo: string | null = null): KanbanResultado {
  const cartao = acharCartao(k, id)
  if (!cartao || cartao.etapa === para) return k
  const movido: KanbanCartao = {
    ...cartao, etapa: para, etapa_desde: agoraIso, dias_na_etapa: 0, motivo_perda: para === 'perdido' ? motivo : null,
  }
  return {
    ...k,
    colunas: k.colunas.map((c) => {
      if (c.etapa === cartao.etapa) return { ...c, total: Math.max(0, c.total - 1), itens: c.itens.filter((i) => i.id !== id) }
      if (c.etapa === para) return { ...c, total: c.total + 1, itens: [movido, ...c.itens] }
      return c
    }),
  }
}

/** Data sem hora (`AAAA-MM-DD`) em pt-BR, sem passar por `Date` (que leria como UTC e mostraria o dia anterior). */
export function dataSemFuso(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

/** Hoje no fuso de São Paulo (`AAAA-MM-DD`), o mesmo "hoje" que o servidor usa para prazo e tarefa atrasada. */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo' }).format(agora)
}

/** "Hoje", "1 dia", "12 dias" na etapa. */
export const textoDiasNaEtapa = (n: number) => (n <= 0 ? 'Hoje' : n === 1 ? '1 dia' : `${n} dias`)

// =====================================================================================================
// Timeline agrupada por mês/ano (fuso de São Paulo, igual ao servidor)
// =====================================================================================================

const FUSO = 'America/Sao_Paulo'
const fmtMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: FUSO })
const fmtChave = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: FUSO })

export interface GrupoTimeline { chave: string; rotulo: string; eventos: TimelineEvento[] }

/** Agrupa (na ordem recebida, do mais novo ao mais antigo) por mês/ano: "Setembro de 2026". */
export function agruparPorMes(eventos: readonly TimelineEvento[]): GrupoTimeline[] {
  const grupos: GrupoTimeline[] = []
  for (const e of eventos) {
    const d = new Date(e.ocorrido_em)
    const chave = fmtChave.format(d).slice(0, 7)
    let g = grupos[grupos.length - 1]
    if (!g || g.chave !== chave) {
      const r = fmtMes.format(d)
      g = { chave, rotulo: r.charAt(0).toUpperCase() + r.slice(1), eventos: [] }
      grupos.push(g)
    }
    g.eventos.push(e)
  }
  return grupos
}

// =====================================================================================================
// Envio de arquivo de documento (§3.10): conferência no navegador antes do upload (o servidor confere de novo)
// =====================================================================================================

/** Formato do arquivo pela extensão e MIME (os dois precisam ser da mesma família). */
export function formatoDoArquivo(nome: string, mime: string): { formato: FormatoDocumento; ext: string; mime: string } | null {
  const ext = (nome.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  const m = mime.split(';')[0].trim().toLowerCase()
  for (const [formato, f] of Object.entries(FORMATOS_DOCUMENTO) as [FormatoDocumento, (typeof FORMATOS_DOCUMENTO)[FormatoDocumento]][]) {
    if (!f.extensoes.includes(ext)) continue
    // alguns navegadores não informam o MIME de .doc/.xls/.csv: usa o primeiro da família pela extensão
    if (m === '') return { formato, ext, mime: f.mimes[f.extensoes.indexOf(ext)] ?? f.mimes[0] }
    if (f.mimes.includes(m)) return { formato, ext, mime: m }
    return null
  }
  return null
}

/** `accept` do `<input type="file">` para os formatos aceitos. */
export const acceptDosFormatos = (formatos: readonly FormatoDocumento[]) =>
  formatos.flatMap((f) => [...FORMATOS_DOCUMENTO[f].extensoes.map((e) => `.${e}`), ...FORMATOS_DOCUMENTO[f].mimes]).join(',')

export type ConferenciaArquivo =
  | { ok: true; ext: string; mime: string }
  | { ok: false; erro: string }

/** Confere tipo e tamanho antes de enviar. `maxBytes` vem de `configuracao_publica.documento_max_bytes`. */
export function conferirArquivo(arquivo: { name: string; type: string; size: number }, formatos: readonly FormatoDocumento[], maxBytes: number): ConferenciaArquivo {
  if (arquivo.size <= 0) return { ok: false, erro: 'O arquivo está vazio.' }
  if (arquivo.size > maxBytes) return { ok: false, erro: `O arquivo passa do limite de ${tamanhoLegivel(maxBytes)}.` }
  const f = formatoDoArquivo(arquivo.name, arquivo.type)
  if (!f || !formatos.includes(f.formato)) {
    return { ok: false, erro: `Formato não aceito. Envie ${formatos.map((x) => FORMATOS_DOCUMENTO[x].rotulo).join(', ')}.` }
  }
  return { ok: true, ext: f.ext, mime: f.mime }
}

/** Caminho no bucket `crm-documentos`: `<cliente_id>/<documento_id>/<uuid>.<ext>` (sem dado pessoal no nome). */
export const caminhoDoArquivo = (clienteId: string, documentoId: string, uuid: string, ext: string) =>
  `${clienteId}/${documentoId}/${uuid.toLowerCase()}.${ext.toLowerCase()}`

/** 1,5 MB, 800 KB, 120 bytes. */
export function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024).toLocaleString('pt-BR')} KB`
  return `${bytes} bytes`
}

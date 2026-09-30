// Consulta da auditoria (docs/ARQUITETURA_EXPANSAO.md §5.1, N20): rótulos e montagem dos filtros de
// `auditoria_consultar`. Módulo puro (testado em auditoria.test.ts). O servidor valida tudo de novo e registra a
// própria leitura; aqui só evitamos mandar filtro que ele recusaria.

import type { AuditoriaFiltros, AuditoriaItem } from './tipos'
import type { CategoriaAuditoria } from '@/lib/types'
import { CATEGORIAS_AUDITORIA } from '@/lib/constants'

export const LIMITE_AUDITORIA = 50

const ROTULOS_ACAO: Record<string, string> = {
  consultar: 'Consultou', listar: 'Listou', baixar: 'Baixou', exportar: 'Exportou', criar: 'Criou', editar: 'Editou',
  excluir: 'Excluiu', inativar: 'Inativou', reativar: 'Reativou', transferir: 'Transferiu', mudar_status: 'Mudou o status',
  gerar: 'Gerou', enviar_assinatura: 'Enviou para assinatura', assinar: 'Assinou', anonimizar: 'Anonimizou',
  login: 'Entrou', acesso_negado: 'Acesso negado', link_gerado: 'Gerou link', migracao: 'Migração', aprovar: 'Aprovou',
  recusar: 'Recusou', regularizar: 'Regularizou', aceitar: 'Aceitou', revogar: 'Revogou', purgar: 'Purga de retenção',
  enviar_email: 'Envio de e-mail',
}

/** Ações conhecidas, para o filtro (o servidor aceita qualquer código no formato). */
export const ACOES_AUDITORIA = Object.keys(ROTULOS_ACAO).sort((a, b) => ROTULOS_ACAO[a].localeCompare(ROTULOS_ACAO[b], 'pt-BR'))

export const rotuloAcao = (acao: string) => ROTULOS_ACAO[acao] ?? acao.replace(/_/g, ' ')

export const rotuloCategoria = (c: CategoriaAuditoria) => CATEGORIAS_AUDITORIA[c] ?? c

/** `rpc` | `trigger` | `edge:<nome>` | `webhook:<nome>` | `cron` | `hook` | `migracao`. */
export function rotuloOrigem(origem: string): string {
  if (origem === 'rpc') return 'Sistema (RPC)'
  if (origem === 'trigger') return 'Gravação direta'
  if (origem === 'cron') return 'Rotina agendada'
  if (origem === 'hook') return 'Login'
  if (origem === 'migracao') return 'Migração'
  if (origem.startsWith('edge:')) return `Função ${origem.slice(5)}`
  if (origem.startsWith('webhook:')) return `Webhook ${origem.slice(8)}`
  return origem
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATA = /^\d{4}-\d{2}-\d{2}$/
const CODIGO = /^[a-z][a-z_]{1,39}$/
const ENTIDADE = /^[a-z][a-z0-9_]{1,59}$/

/** Valores do formulário de filtros (texto cru dos campos). */
export interface FormFiltros {
  categoria: string
  acao: string
  entidade: string
  entidade_id: string
  cliente_id: string
  ator_id: string
  de: string
  ate: string
}

export const FILTROS_VAZIOS: FormFiltros = { categoria: '', acao: '', entidade: '', entidade_id: '', cliente_id: '', ator_id: '', de: '', ate: '' }

/** Converte o formulário em `p_filtros` (só as chaves preenchidas) ou devolve a mensagem do primeiro problema. */
export function montarFiltros(f: FormFiltros): { ok: true; filtros: AuditoriaFiltros } | { ok: false; erro: string } {
  const t = (v: string) => v.trim()
  const filtros: AuditoriaFiltros = {}
  const categoria = t(f.categoria)
  if (categoria) {
    if (!(categoria in CATEGORIAS_AUDITORIA)) return { ok: false, erro: 'Categoria inválida.' }
    filtros.categoria = categoria as CategoriaAuditoria
  }
  const acao = t(f.acao)
  if (acao) {
    if (!CODIGO.test(acao)) return { ok: false, erro: 'Ação inválida.' }
    filtros.acao = acao
  }
  const entidade = t(f.entidade).toLowerCase()
  if (entidade) {
    if (!ENTIDADE.test(entidade)) return { ok: false, erro: 'Entidade inválida (use o nome da tabela, ex.: clientes).' }
    filtros.entidade = entidade
  }
  const entidadeId = t(f.entidade_id)
  if (entidadeId) {
    if (entidadeId.length > 200) return { ok: false, erro: 'Identificador do registro muito longo.' }
    filtros.entidade_id = entidadeId
  }
  for (const campo of ['cliente_id', 'ator_id'] as const) {
    const v = t(f[campo]).toLowerCase()
    if (!v) continue
    if (!UUID.test(v)) return { ok: false, erro: campo === 'cliente_id' ? 'ID do cliente inválido.' : 'ID de quem agiu inválido.' }
    filtros[campo] = v
  }
  const de = t(f.de)
  const ate = t(f.ate)
  if (de && !DATA.test(de)) return { ok: false, erro: 'Data inicial inválida.' }
  if (ate && !DATA.test(ate)) return { ok: false, erro: 'Data final inválida.' }
  if (de && ate && ate < de) return { ok: false, erro: 'A data final é anterior à inicial.' }
  if (de) filtros.de = de
  if (ate) filtros.ate = ate
  return { ok: true, filtros }
}

/** Valor de `antes`/`depois`/`detalhe` para exibição (nunca contém dado pessoal: o servidor só grava códigos e ids). */
export function formatarValor(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return v.toLocaleString('pt-BR')
  return JSON.stringify(v)
}

/** Alterações de um registro: campos, com antes e depois quando o servidor guardou os valores (configuração). */
export function alteracoes(item: Pick<AuditoriaItem, 'campos' | 'antes' | 'depois'>): { campo: string; antes: string | null; depois: string | null }[] {
  const nomes = new Set<string>([...(item.campos ?? []), ...Object.keys(item.antes ?? {}), ...Object.keys(item.depois ?? {})])
  return [...nomes].map((campo) => ({
    campo,
    antes: item.antes && campo in item.antes ? formatarValor(item.antes[campo]) : null,
    depois: item.depois && campo in item.depois ? formatarValor(item.depois[campo]) : null,
  }))
}

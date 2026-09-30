// Contrato de Governança (WP6/WP7): auditoria, LGPD, painel e pendências da migração
// (docs/ARQUITETURA_EXPANSAO.md §3.9, §4.4 e §5). A auditoria só é lida por `auditoria_consultar`, que registra a
// própria leitura. RPC de escrita sem retorno = `returns void`.

import type {
  CategoriaAuditoria, DataHoraISO, DataISO, DefRpc, EntidadeTransicao, EtapaFunil, OrigemHistorico, Pagina, Papel,
  SemArgs, StatusContrato, StatusImovel, StatusProposta, TipoTermo, Uuid,
} from '@/lib/types'

// ---------- auditoria ----------

/** Ações usadas em `auditoria.acao` (§5.1). */
export type AcaoAuditoria =
  | 'consultar' | 'listar' | 'baixar' | 'exportar' | 'criar' | 'editar' | 'inativar' | 'reativar' | 'transferir'
  | 'mudar_status' | 'gerar' | 'enviar_assinatura' | 'assinar' | 'anonimizar' | 'login' | 'acesso_negado'
  | 'link_gerado' | 'migracao' | 'aprovar' | 'recusar' | 'regularizar'

/** `p_filtros` de `auditoria_consultar`. */
export interface AuditoriaFiltros {
  categoria?: CategoriaAuditoria | null
  acao?: string | null
  entidade?: string | null
  entidade_id?: string | null
  cliente_id?: Uuid | null
  ator_id?: Uuid | null
  de?: DataISO | null
  ate?: DataISO | null
}

/** Linha de `auditoria` (+ nome do ator). Nunca contém valor pessoal: `campos` são só nomes de colunas. */
export interface AuditoriaItem {
  id: number
  ocorrido_em: DataHoraISO
  categoria: CategoriaAuditoria
  acao: string
  entidade: string
  entidade_id: string | null
  cliente_id: Uuid | null
  ator_id: Uuid | null
  ator_nome: string | null
  ator_papel: Papel | null
  ator_parceiro_id: Uuid | null
  /** `rpc` | `trigger` | `edge:<nome>` | `webhook:d4sign` | `cron` | `hook` | `migracao`. */
  origem: string
  campos: string[] | null
  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
  detalhe: Record<string, unknown>
  ip: string | null
  user_agent: string | null
}

// ---------- LGPD ----------

/** `lgpd_termo_vigente(p_tipo)` (anon): o de maior `vigente_desde` do tipo; `null` se não houver. */
export interface LgpdTermo {
  id: Uuid
  tipo: TipoTermo
  versao: string
  texto: string
  vigente_desde: DataHoraISO
  revisado_juridico: boolean
}

/** `lgpd_anonimizar_cliente` (Edge `lgpd-anonimizar`, com o JWT do Super): caminhos a apagar no Storage e o usuário do portal. */
export interface AnonimizacaoResultado {
  paths: string[]
  user_id: Uuid | null
}

// ---------- painel ----------

/**
 * `painel_resumo()`: cartões por papel e escopo. Cada seção vem `null` quando quem consulta não tem a permissão
 * correspondente (entre parênteses). Contagens sempre dentro do escopo.
 */
export interface PainelResumo {
  papel: Papel
  /** (`empreendimentos.ver`) */
  empreendimentos: { publicados: number; unidades_disponiveis: number } | null
  /** (`crm.ver`) Clientes ativos. */
  crm: {
    total: number
    por_etapa: Record<EtapaFunil, number>
    tarefas_pendentes: number
    tarefas_atrasadas: number
    documentos_em_analise: number
  } | null
  /** (`contratos.ver`) Só os status com contagem > 0. */
  contratos: { por_status: Partial<Record<StatusContrato, number>> } | null
  /** (`imoveis.ver`) Só os status com contagem > 0. */
  imoveis: { por_status: Partial<Record<StatusImovel, number>> } | null
  /** (`propostas.ver`) */
  propostas: { por_status: Record<StatusProposta, number> } | null
  /** (`rede.ver`) `autocadastros_pendentes` só para internos (nulo para parceiros). */
  rede: { imobiliarias: number; gerentes: number; corretores: number; autocadastros_pendentes: number | null } | null
  /** (`leads.ver`) */
  leads: { novos: number; total: number } | null
  /** (`crm.duplicidades`) */
  duplicidades_pendentes: number | null
  /** (`migracao.ver`) */
  migracao_pendencias: number | null
}

// ---------- linhas lidas pela API (internos) ----------

/** `historico_status` (S para internos; sem dado pessoal). */
export interface HistoricoStatus {
  id: number
  entidade: EntidadeTransicao
  entidade_id: Uuid
  de: string | null
  para: string
  motivo: string | null
  origem: OrigemHistorico
  ator_id: Uuid | null
  ocorrido_em: DataHoraISO
}

/** Tipos de pendência abertos pelo corte (§2.4; `_migracao_pendencia` na migration 20260929000018). */
export type TipoPendenciaMigracao =
  | 'cpf_invalido' | 'cpf_conflito_portal' | 'cpf_conflito_cliente' | 'cpf_conflito_parceiros' | 'cpf_parceiro_invalido'
  | 'decisao_invalida' | 'dono_sem_vinculo' | 'parceiro_pendente_com_clientes' | 'proposta_cliente_outro_parceiro'

/** `migracao_pendencias` (S para internos; resolver por RPC). */
export interface MigracaoPendencia {
  id: number
  tipo: TipoPendenciaMigracao
  tabela: string
  registro_id: string
  relacionado_id: string | null
  detalhe: string | null
  /** Texto gravado por `migracao_pendencias_resolver` (nulo enquanto aberta). */
  decisao: string | null
  resolvido_em: DataHoraISO | null
  resolvido_por: Uuid | null
  criado_em: DataHoraISO
}

/** RPCs de governança que o front chama. */
export interface RpcGovernanca {
  /** I. Registra `acesso/consultar` da própria leitura. */
  auditoria_consultar: DefRpc<{ p_filtros: AuditoriaFiltros; p_limite: number; p_offset: number }, Pagina<AuditoriaItem>>
  /** anon + authenticated. */
  lgpd_termo_vigente: DefRpc<{ p_tipo: TipoTermo }, LgpdTermo | null>
  /** Super. Somente inclusão (nova versão). */
  lgpd_publicar_termo: DefRpc<{ p_tipo: TipoTermo; p_versao: string; p_texto: string; p_revisado_juridico: boolean }, void>
  /** Logado: aceite do termo vigente (parceiro com pendência `termo`). */
  lgpd_aceitar_termo: DefRpc<{ p_termo_id: Uuid }, void>
  /** Super. Só preenche `revogado_*`. */
  lgpd_revogar_consentimento: DefRpc<{ p_id: Uuid; p_motivo: string }, void>
  /** Todos os logados. */
  painel_resumo: DefRpc<SemArgs, PainelResumo>
  /** I (corpo no arquivo de corte, WP7). `p_decisao` é texto livre da decisão tomada. */
  migracao_pendencias_resolver: DefRpc<{ p_id: number; p_decisao: string }, void>
}

/** Chamada só pela Edge `lgpd-anonimizar` com o JWT do Super (depois ela apaga os arquivos e o usuário do portal). */
export interface RpcGovernancaEdgeUsuario {
  lgpd_anonimizar_cliente: DefRpc<{ p_cliente_id: Uuid; p_protocolo: string }, AnonimizacaoResultado>
}

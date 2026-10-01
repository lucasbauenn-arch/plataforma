// Contrato do Portal do cliente (WP6): RPCs `portal_*`, sempre por `meu_cliente_id()` (portal liberado, não inativado
// e não anonimizado). Nenhuma recebe id de cliente: o titular só vê os próprios dados (docs/ARQUITETURA_EXPANSAO.md
// §4.4, §6.7 e N1). Sem cliente vinculado ou portal não liberado: `null` (dados/corretor) ou lista vazia.

import type {
  DataHoraISO, DataISO, DefRpc, DownloadAutorizado, FormaPagamento, FormatoDocumento, FiltroPaginacao, Ref, SemArgs,
  StatusDocumento, TipoDocumento, Uuid,
} from '@/lib/types'

/** `portal_meus_dados()`. Só PF (o login do portal é por CPF). */
export interface PortalMeusDados {
  id: Uuid
  nome: string
  sobrenome: string | null
  /** 11 dígitos. */
  cpf: string
  email: string | null
  telefone: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
}

/** `portal_meu_corretor()`. Para a Carteira Arken (`virtual`), o front mostra o contato da empresa. */
export interface PortalMeuCorretor {
  nome: string
  telefone: string | null
  email: string | null
  creci: string | null
  imobiliaria_nome: string | null
  virtual: boolean
}

/** Item de `portal_documentos()`: só envio (o titular não baixa os pessoais). */
export interface PortalDocumento {
  id: Uuid
  tipo: TipoDocumento
  nome: string
  formatos_aceitos: FormatoDocumento[]
  status: StatusDocumento
  motivo_rejeicao: string | null
  /** `pendente` ou `rejeitado`. */
  pode_enviar: boolean
  ultimo_envio_em: DataHoraISO | null
  /**
   * Limite de envio configurado pelo Super (`configuracao_geral.documento_max_bytes`, ≤ limite do bucket). O portal
   * confere antes de subir: um arquivo que o registro do envio recusaria ficaria no bucket sem registro.
   */
  max_bytes: number
}

/** Item de `portal_contratos()`: só `assinatura_pendente` e `assinado`. */
export interface PortalContrato {
  id: Uuid
  codigo: number
  status: 'assinatura_pendente' | 'assinado'
  forma_pagamento: FormaPagamento
  produto: { tipo: 'unidade' | 'imovel'; nome: string }
  valor_imovel: number
  n_parcelas: number | null
  valor_parcela: number | null
  enviado_assinatura_em: DataHoraISO | null
  assinado_em: DataHoraISO | null
  pdf_assinado_disponivel: boolean
}

// ---------- Linha do tempo da compra e solicitações (decisão do dono, 29/09/2026; migration 24) ----------

/** Marcos da compra, na ordem em que acontecem. */
export type TipoMarco = 'contrato_assinado' | 'obra' | 'vistoria' | 'entrega_chaves'

/** Um marco de um negócio. Sem registro da equipe, as datas vêm nulas. */
export interface PortalMarco {
  tipo: TipoMarco
  data_prevista: DataISO | null
  /** Realizada: registrada pela equipe ou, em "Contrato assinado", lida do contrato assinado. */
  data_realizada: DataISO | null
  /** De onde veio a data realizada. */
  origem: 'equipe' | 'contrato' | null
  /** Até 500 caracteres; aparece para o cliente. */
  observacao: string | null
}

/** Marco na visão da equipe (`crm_portal_marcos`): com id, a data realizada gravada e quem atualizou. */
export interface MarcoEquipe extends PortalMarco {
  id: Uuid | null
  /** O que está gravado (sem a data lida do contrato). */
  data_realizada_registrada: DataISO | null
  atualizado_em: DataHoraISO | null
  atualizado_por: Ref | null
}

/** Negócio (`cliente_negocios`) com os 4 marcos, sempre na ordem de `TipoMarco`. */
export interface PortalNegocioLinha<M extends PortalMarco = PortalMarco> {
  negocio_id: Uuid
  /** "Empreendimento — unidade" ou a descrição. */
  titulo: string
  empreendimento_id: Uuid | null
  /** Último percentual publicado da obra do empreendimento. */
  obra_percentual: number | null
  marcos: M[]
}

export type TipoSolicitacao = 'segunda_via_boleto' | 'antecipacao_parcelas' | 'agendar_vistoria' | 'duvida_contrato' | 'outro'
export type StatusSolicitacao = 'aberta' | 'em_atendimento' | 'concluida'

/** Pedido do titular (`portal_solicitacoes()`). */
export interface PortalSolicitacao {
  id: Uuid
  /** Número de exibição (sequencial). */
  numero: number
  tipo: TipoSolicitacao
  negocio: { id: Uuid; titulo: string } | null
  mensagem: string | null
  status: StatusSolicitacao
  /** Resposta da equipe (obrigatória para concluir). */
  resposta: string | null
  criado_em: DataHoraISO
  atualizado_em: DataHoraISO | null
  concluida_em: DataHoraISO | null
}

/** Pedido na fila da equipe (`crm_portal_solicitacoes`): com o cliente e quem atualizou. */
export interface SolicitacaoEquipe extends PortalSolicitacao {
  cliente: { id: Uuid; nome: string }
  atualizado_por: Ref | null
}

/** `p_filtros` de `crm_portal_solicitacoes`. Abertos primeiro (o mais antigo no topo), concluídos no fim. */
export interface SolicitacoesFiltros extends FiltroPaginacao {
  status?: StatusSolicitacao | null
  /** `true` = não concluídas; `false` = só concluídas. */
  abertas?: boolean | null
  cliente_id?: Uuid | null
}

/** RPCs do portal (grant para `authenticated`; cada uma confere `meu_cliente_id()`). */
export interface RpcPortal {
  portal_meus_dados: DefRpc<SemArgs, PortalMeusDados | null>
  portal_meu_corretor: DefRpc<SemArgs, PortalMeuCorretor | null>
  portal_documentos: DefRpc<SemArgs, PortalDocumento[]>
  portal_contratos: DefRpc<SemArgs, PortalContrato[]>
  /** Só o PDF assinado; registra a baixa. */
  portal_contrato_baixar: DefRpc<{ p_id: Uuid }, DownloadAutorizado>
  /** Negócios do titular com os 4 marcos (sem ids nem autoria). */
  portal_linha_do_tempo: DefRpc<SemArgs, PortalNegocioLinha[]>
  /** Pedidos do titular (até 100, mais recentes primeiro). */
  portal_solicitacoes: DefRpc<SemArgs, PortalSolicitacao[]>
  /**
   * Novo pedido. `p_negocio_id` (opcional) precisa ser do titular; `p_mensagem` até 2000 caracteres, obrigatória em
   * `outro`. Limites: 5 em 24 h e 10 em aberto. Avisa a equipe (e-mail sem o texto do pedido).
   */
  portal_solicitar: DefRpc<{ p_tipo: TipoSolicitacao; p_negocio_id: Uuid | null; p_mensagem: string | null }, Uuid>
  // ---- equipe (só internos) ----
  /** Negócios de um cliente com os marcos; nulo fora do escopo. */
  crm_portal_marcos: DefRpc<{ p_cliente_id: Uuid }, PortalNegocioLinha<MarcoEquipe>[] | null>
  /** Grava as datas de um marco; tudo nulo apaga. Realizada nunca no futuro. */
  crm_portal_marco_salvar: DefRpc<{
    p_negocio_id: Uuid; p_tipo: TipoMarco; p_data_prevista: DataISO | null; p_data_realizada: DataISO | null; p_observacao: string | null
  }, null>
  crm_portal_solicitacoes: DefRpc<{ p_filtros: SolicitacoesFiltros }, { total: number; itens: SolicitacaoEquipe[] }>
  /** aberta → em_atendimento → concluida (ou aberta → concluida); concluída é final; concluir exige resposta. */
  crm_portal_solicitacao_atualizar: DefRpc<{ p_id: Uuid; p_status: StatusSolicitacao; p_resposta: string | null }, null>
}

/** RPC de sistema: **só `service_role`** (Edge `cliente-login`). Devolve 0 ou 1 linha (`returns table`). */
export interface RpcPortalServico {
  portal_localizar_cliente: DefRpc<{ p_cpf: string }, { id: Uuid; nome: string; user_id: Uuid | null }[]>
}

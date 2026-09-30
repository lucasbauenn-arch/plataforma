// Contrato do Portal do cliente (WP6): RPCs `portal_*`, sempre por `meu_cliente_id()` (portal liberado, não inativado
// e não anonimizado). Nenhuma recebe id de cliente: o titular só vê os próprios dados (docs/ARQUITETURA_EXPANSAO.md
// §4.4, §6.7 e N1). Sem cliente vinculado ou portal não liberado: `null` (dados/corretor) ou lista vazia.

import type {
  DataHoraISO, DefRpc, DownloadAutorizado, FormaPagamento, FormatoDocumento, SemArgs, StatusDocumento, TipoDocumento, Uuid,
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

/** RPCs do portal (grant para `authenticated`; cada uma confere `meu_cliente_id()`). */
export interface RpcPortal {
  portal_meus_dados: DefRpc<SemArgs, PortalMeusDados | null>
  portal_meu_corretor: DefRpc<SemArgs, PortalMeuCorretor | null>
  portal_documentos: DefRpc<SemArgs, PortalDocumento[]>
  portal_contratos: DefRpc<SemArgs, PortalContrato[]>
  /** Só o PDF assinado; registra a baixa. */
  portal_contrato_baixar: DefRpc<{ p_id: Uuid }, DownloadAutorizado>
}

/** RPC de sistema: **só `service_role`** (Edge `cliente-login`). Devolve 0 ou 1 linha (`returns table`). */
export interface RpcPortalServico {
  portal_localizar_cliente: DefRpc<{ p_cpf: string }, { id: Uuid; nome: string; user_id: Uuid | null }[]>
}

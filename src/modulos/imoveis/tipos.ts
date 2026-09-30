// Contrato do módulo Imóveis (WP5): linhas lidas pela API com RLS (regra E4) e RPCs `imovel_*`
// (docs/ARQUITETURA_EXPANSAO.md §3.7, §3.8, §4.2 e §4.4). Imóvel não tem dado pessoal: leitura e escrita dos campos
// editáveis vão direto na tabela (grant por coluna); status, fotos e inativação só por RPC.

import type { DataHoraISO, DefRpc, StatusImovel, Uuid } from '@/lib/types'

/** `imoveis.adicionais` ⊂ este conjunto ("Chip" fica fora, E5). */
export type AdicionalImovel =
  | 'churrasqueira' | 'ar_condicionado' | 'perto_metro' | 'perto_parque' | 'perto_onibus' | 'piscina' | 'aceita_pet'

/** Campos exigidos pelo IMV-2 na saída do rascunho; vêm em `detalhe.campos` do erro `CAMPOS_OBRIGATORIOS`. */
export type CampoObrigatorioImovel = 'nome' | 'tipo' | 'cep' | 'logradouro' | 'numero' | 'cidade' | 'uf' | 'valor'

/** `public.imovel_tipos` (E3). Leitura para todos os logados; o Super acrescenta. */
export interface ImovelTipo {
  codigo: string
  rotulo: string
  ativo: boolean
  criado_em: DataHoraISO
  criado_por: Uuid | null
  atualizado_em: DataHoraISO | null
  atualizado_por: Uuid | null
}

/** `public.imoveis`. Visibilidade E4: criador, cadeia acima dele e internos em RA/PE/RE; todos os parceiros aprovados em AP/NC. */
export interface Imovel {
  id: Uuid
  /** Exibido como #0000007. */
  codigo: number
  nome: string | null
  matricula: string | null
  /** FK `imovel_tipos.codigo`. */
  tipo: string | null
  descricao: string | null
  status: StatusImovel
  /** 8 dígitos. */
  cep: string | null
  pais: string
  uf: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  valor: number | null
  area_total: number | null
  area_construida: number | null
  idade_anos: number | null
  andar: string | null
  quartos: number | null
  banheiros: number | null
  suites: number | null
  vagas: number | null
  adicionais: AdicionalImovel[]
  /** Observação do "devolver com observação" (RE → RA). */
  observacao_revisao: string | null
  criado_por: Uuid
  criado_por_parceiro_id: Uuid | null
  imobiliaria_id: Uuid | null
  gerente_id: Uuid | null
  criado_em: DataHoraISO
  atualizado_em: DataHoraISO | null
  atualizado_por: Uuid | null
  inativado_em: DataHoraISO | null
  inativado_por: Uuid | null
  motivo_inativacao: string | null
}

/**
 * Colunas com grant de insert/update para `authenticated` (§4.2). O insert entra como `rascunho`; o update vale para o
 * criador em RA/PE e para internos (em NC o valor não muda, IMV-3). `status`, `codigo`, `criado_por` e a cadeia nunca.
 */
export interface ImovelDados {
  nome?: string | null
  matricula?: string | null
  tipo?: string | null
  descricao?: string | null
  cep?: string | null
  pais?: string
  uf?: string | null
  cidade?: string | null
  bairro?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  valor?: number | null
  area_total?: number | null
  area_construida?: number | null
  idade_anos?: number | null
  andar?: string | null
  quartos?: number | null
  banheiros?: number | null
  suites?: number | null
  vagas?: number | null
  adicionais?: AdicionalImovel[]
}

/** `public.imovel_fotos`. Leitura segue o imóvel; escrita só por RPC. Caminhos no bucket privado `imoveis` (URL assinada). */
export interface ImovelFoto {
  id: Uuid
  imovel_id: Uuid
  /** `<imovel_id>/<uuid>.webp` */
  storage_path: string
  /** `<imovel_id>/<uuid>-min.webp` */
  miniatura_path: string | null
  ordem: number
  largura: number | null
  altura: number | null
  bytes: number | null
  criado_por: Uuid | null
  criado_em: DataHoraISO
}

/** RPCs de imóveis (grant para `authenticated`). */
export interface RpcImoveis {
  /** Tabela §3.8; IMV-2 na saída do rascunho; `p_obs` obrigatória em RE → RA (vai para `observacao_revisao`). */
  imovel_mudar_status: DefRpc<{ p_id: Uuid; p_para: StatusImovel; p_obs: string | null }, void>
  /** `pode_editar_imovel`; confere quantidade (`imovel_fotos_max`) e tamanho real. Devolve o id da foto. */
  imovel_foto_registrar: DefRpc<{ p_imovel_id: Uuid; p_path: string; p_miniatura_path: string | null }, Uuid>
  imovel_foto_remover: DefRpc<{ p_id: Uuid }, void>
  /** `p_ids` = todas as fotos do imóvel, na nova ordem. */
  imovel_fotos_ordenar: DefRpc<{ p_imovel_id: Uuid; p_ids: Uuid[] }, void>
  /** I. Sem contrato ativo. */
  imovel_inativar: DefRpc<{ p_id: Uuid; p_motivo: string }, void>
}

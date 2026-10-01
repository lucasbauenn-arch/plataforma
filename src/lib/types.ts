// Tipos compartilhados do app. Os enums espelham exatamente os enums do Postgres (migrations 01 e 02,
// docs/ARQUITETURA_EXPANSAO.md §2.1 e §3.2). Os tipos de cada RPC ficam em src/modulos/<modulo>/tipos.ts.

/** Identificador uuid (texto). */
export type Uuid = string
/** Data sem hora, `YYYY-MM-DD` (coluna `date`). */
export type DataISO = string
/** Data e hora ISO 8601 com fuso (coluna `timestamptz`). */
export type DataHoraISO = string

// ---------- formas comuns dos contratos de RPC ----------

/** Definição de uma RPC: argumentos com os nomes exatos dos parâmetros SQL (todos obrigatórios; nulo quando não se aplica) e retorno. */
export interface DefRpc<A, R> { args: A; retorno: R }
/** RPC sem parâmetros. */
export type SemArgs = Record<string, never>
/**
 * Lista paginada devolvida pelas RPCs `*_listar`/`crm_kanban_coluna` etc.: `total` = total no escopo com os filtros
 * (antes da paginação), `itens` = a página pedida, já ordenada pelo servidor.
 */
export interface Pagina<T> { total: number; itens: T[] }
/**
 * Paginação dentro de `p_filtros` para as RPCs que não têm `p_limite`/`p_offset` na assinatura.
 * Padrão do servidor: `limite` 50 (máximo 200), `offset` 0.
 */
export interface FiltroPaginacao { limite?: number; offset?: number }
/** Referência curta a uma pessoa ou registro para exibição. */
export interface Ref { id: Uuid; nome: string }
/**
 * Autorização de download criada por `crm_documento_baixar`, `contrato_baixar` e `portal_contrato_baixar`
 * (grava `download_autorizacoes` e auditoria). O front chama em seguida `urlDoDownload(autorizacao)` (src/lib/rpc.ts),
 * que pede a URL assinada à Edge `baixar-arquivo` antes de `expira_em`. `createSignedUrl` direto no navegador falha:
 * os buckets não têm política de SELECT para `authenticated` (§4.3).
 */
export interface DownloadAutorizado { bucket: 'crm-documentos' | 'contratos'; path: string; expira_em: DataHoraISO }

// ---------- enums que já existiam (migration 20260921000001) + valores novos (migration 01) ----------

/** `public.papel`. `parceiro` = legado/autocadastro aguardando aprovação; o escopo nunca vem do papel, vem de `parceiros`. */
export type Papel = 'admin' | 'parceiro' | 'cliente' | 'super' | 'imobiliaria' | 'gerente' | 'corretor' | 'colaborador'
/** `public.status_parceiro`. Só `aprovado` dá escopo. `inativo` = desligamento (só por RPC). */
export type StatusParceiro = 'pendente' | 'aprovado' | 'bloqueado' | 'inativo'
export type Estagio =
  | 'futuro_lancamento' | 'lancamento' | 'obras_iniciadas' | 'obras_aceleradas'
  | 'em_construcao' | 'pronto_para_morar' | 'portfolio'
export type TipoMidia = 'fachada' | 'area_comum' | 'planta' | 'decorado' | 'obra'
export type StatusUnidade = 'disponivel' | 'reservada' | 'vendida'
export type StatusProposta = 'enviada' | 'em_analise' | 'aprovada' | 'recusada'

// ---------- enums novos (migration 02, §3.2) ----------

export type TipoParceiro = 'imobiliaria' | 'gerente' | 'corretor'
export type TipoPessoa = 'fisica' | 'juridica'
export type Genero = 'masculino' | 'feminino' | 'outros'
export type EstadoCivil = 'solteiro' | 'casado' | 'divorciado' | 'viuvo' | 'uniao_estavel'
/** Funil: NC, CI, DO, FI, PE. */
export type EtapaFunil = 'novo_contato' | 'contato_iniciado' | 'documentacao' | 'finalizado' | 'perdido'
export type OrigemCliente =
  | 'cadastro_interno' | 'pre_cadastro_link' | 'lead_site' | 'portal_admin' | 'migracao_parceiro_clientes' | 'importacao'
export type StatusLead = 'novo' | 'convertido' | 'descartado'
/** P, F. "Atrasada" é calculada, não é status. */
export type StatusTarefa = 'pendente' | 'concluida'
/** U (do cliente), C (de contrato). */
export type TipoDocumento = 'cliente' | 'contrato'
/** P, EA, A, R. */
export type StatusDocumento = 'pendente' | 'em_analise' | 'aprovado' | 'rejeitado'
export type TipoContrato = 'aquisicao'
export type FormaPagamento = 'parcelado' | 'flexivel'
/** D6: os modelos de serviço só têm pré-visualização. */
export type ModeloChave = 'parcelado' | 'flexivel' | 'servico_corretor' | 'servico_imobiliaria'
export type StatusContrato =
  | 'rascunho' | 'documentacao_pendente' | 'em_analise' | 'assinatura_pendente'
  | 'assinado' | 'recusado' | 'expirado' | 'cancelado' | 'arquivado'
export type PapelSignatario = 'cliente' | 'representante_arken' | 'corretor' | 'testemunha'
export type StatusAssinatura = 'pendente' | 'assinado' | 'recusado'
/** RA, PE, RE, AP, NC. */
export type StatusImovel = 'rascunho' | 'pendente' | 'em_revisao' | 'aprovado' | 'no_contrato'
export type CategoriaAuditoria = 'acesso' | 'operacao' | 'configuracao' | 'seguranca' | 'integracao' | 'lgpd'
export type StatusNotificacao = 'pendente' | 'enviado' | 'erro' | 'ignorado'

// ---------- valores fechados que não são enum no banco (checks em texto) ----------

/** `cliente_documentos.formatos_aceitos` ⊂ este conjunto (§3.5). */
export type FormatoDocumento = 'jpeg' | 'png' | 'pdf' | 'doc' | 'planilha'
/** `status_transicoes.entidade` (§3.8). */
export type EntidadeTransicao = 'cliente_etapa' | 'documento' | 'contrato' | 'imovel'
/** `historico_status.origem` (§3.8). */
export type OrigemHistorico = 'usuario' | 'sistema' | 'webhook' | 'migracao'
/** `lgpd_termos.tipo` (§3.9). */
export type TipoTermo = 'consentimento_cliente' | 'termos_parceiro'
/** `lgpd_consentimentos.origem` (§5.4). */
export type OrigemConsentimento = 'pre_cadastro_link' | 'declarado' | 'cadastro_parceiro' | 'portal' | 'migracao'
/** Ações de `permissoes_rede` (§3.3). A chave é o tipo do parceiro, não o papel. */
export type AcaoRede =
  | 'cadastrar_gerente' | 'cadastrar_corretor' | 'cadastrar_cliente'
  | 'editar_subordinado' | 'inativar_subordinado'
  | 'transferir_corretor' | 'transferir_cliente'
  | 'gerente_como_corretor' | 'convite_por_link'
  | 'criar_contrato' | 'analisar_documento' | 'cadastrar_imovel'

// ---------- escopo do usuário logado: formato de `meu_escopo()` ----------

/**
 * Permissões de tela devolvidas por `meu_escopo()`. Derivam do papel, do status, do vínculo em `parceiros`
 * e de `permissoes_rede`. A regra de cada uma está em `permissoesDeReferencia()` (src/lib/menu.ts), que é a
 * especificação executável do SQL. O menu é derivado delas, mas **nunca é a única barreira**: a RPC recusa.
 */
export type Permissao =
  // área de parceiros
  | 'painel.acessar'
  | 'empreendimentos.ver'
  | 'propostas.ver'
  | 'propostas.criar'
  | 'imoveis.ver'
  | 'imoveis.cadastrar'
  | 'crm.ver'
  | 'crm.cadastrar'
  | 'crm.transferir'
  | 'crm.analisar_documento'
  | 'crm.links'
  | 'contratos.ver'
  | 'contratos.criar'
  | 'rede.ver'
  | 'rede.cadastrar_gerente'
  | 'rede.cadastrar_corretor'
  | 'rede.editar_subordinado'
  | 'rede.inativar_subordinado'
  | 'rede.transferir_corretor'
  | 'rede.convite_por_link'
  | 'meu_cadastro.editar'
  // internos
  | 'admin.acessar'
  | 'relatorios.ver'
  | 'leads.ver'
  | 'propostas.responder'
  | 'rede.aprovar'
  | 'crm.duplicidades'
  | 'crm.portal'
  | 'contratos.enviar_assinatura'
  | 'imoveis.revisar'
  | 'empreendimentos.gerenciar'
  | 'auditoria.ver'
  | 'migracao.ver'
  // só o Super
  | 'config.ver'

/** Pendências de cadastro do parceiro (a tela "Meu cadastro" pede para completar). */
export type PendenciaCadastro = 'cpf' | 'creci' | 'termo'

export interface EscopoParceiro {
  id: Uuid
  tipo: TipoParceiro
  nome: string
  codigo_indicacao: string | null
  creci: string | null
  virtual: boolean
  migrado_legado: boolean
}

export interface EscopoImobiliaria {
  id: Uuid
  nome: string
  da_casa: boolean
}

/**
 * JSON devolvido por `meu_escopo()` (RPC `security definer`, `grant execute` para `authenticated`).
 * Sempre um objeto para quem está logado; lê só `profiles`, `parceiros`, `imobiliarias`, `permissoes_rede`,
 * `configuracao_geral`, `lgpd_termos`/`lgpd_consentimentos` e o JWT. Não grava auditoria.
 */
export interface Escopo {
  /** `auth.uid()`. */
  profile_id: Uuid
  /** `profiles.papel`. */
  papel: Papel
  /** `profiles.status_parceiro` (para internos e clientes vem o valor da coluna, sem significado). */
  status_parceiro: StatusParceiro
  /** `profiles.inativado_em is not null`. */
  inativado: boolean
  /** `is_admin()`: papel `admin`/`super` **e** (MFA não exigido ou sessão `aal2`). */
  interno: boolean
  /** `is_super()`: mesma regra com papel `super`. */
  super: boolean
  /** `configuracao_geral.exigir_mfa_interno` ligado e papel `admin`/`super` (independe do `aal` atual). */
  mfa_exigido: boolean
  /** `auth.jwt() ->> 'aal'` (padrão `aal1`). Com `mfa_exigido` e `aal1`, o front manda para `/admin/seguranca`. */
  aal: 'aal1' | 'aal2'
  /**
   * Vínculo ativo em `parceiros`: linha com `profile_id = auth.uid()`, `inativado_em is null` e perfil `aprovado`.
   * Nulo para internos, clientes, colaboradores, autocadastro pendente e parceiro sem vínculo.
   * `parceiro_id === parceiro?.id`.
   */
  parceiro_id: Uuid | null
  /** `parceiros.tipo` do vínculo ativo. */
  tipo: TipoParceiro | null
  /** `parceiros.imobiliaria_id` do vínculo ativo. */
  imobiliaria_id: Uuid | null
  /** Corretor: `parceiros.gerente_id`; gerente: o próprio `parceiros.id`; imobiliária e demais: nulo. */
  gerente_id: Uuid | null
  parceiro: EscopoParceiro | null
  imobiliaria: EscopoImobiliaria | null
  /** Ver `Permissao` e `permissoesDeReferencia()`. Sem repetição; a ordem não importa. */
  permissoes: Permissao[]
  /**
   * - `cpf`: vínculo ativo de tipo `gerente` ou `corretor` com `parceiros.cpf` nulo (não virtual);
   * - `creci`: vínculo ativo de tipo `corretor` com `parceiros.creci` nulo (não virtual);
   * - `termo`: papel de parceiro com status `aprovado`, existe termo vigente do tipo `termos_parceiro` e não há linha em
   *   `lgpd_consentimentos` com `titular = 'parceiro'`, `profile_id = auth.uid()`, `termo_id` = esse termo e
   *   `revogado_em is null` (o consentimento `migracao`, sem termo, não conta). Com `termo`, o painel só abre "Meu cadastro".
   */
  pendencias: PendenciaCadastro[]
  /** `configuracao_geral.sessao_inatividade_horas` (H1), usado pelo temporizador do front. */
  sessao_inatividade_horas: number
}

// ---------- linhas de tabelas lidas direto pela API (RLS) ----------

export interface Profile {
  id: string
  papel: Papel
  nome: string
  email: string | null
  telefone: string | null
  cpf: string | null
  creci: string | null
  imobiliaria: string | null
  /** `inativo` = desligamento (só por RPC; o hook de token nem emite sessão para quem está inativo). */
  status_parceiro: StatusParceiro
  created_at: string
  updated_at?: string
  /** migration 03 */
  inativado_em?: string | null
  inativado_por?: string | null
}

export interface Empreendimento {
  id: string
  slug: string
  nome: string
  chamada: string | null
  titulo_hero: string | null
  descricao: string | null
  descricao_lazer: string | null
  estagio: Estagio
  pais: string
  categoria: string | null
  construtora: string | null
  endereco: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  latitude: number | null
  longitude: number | null
  texto_localizacao: string | null
  dormitorios: string | null
  metragem: string | null
  previsao_entrega: string | null
  tagline: string | null
  titulo_lazer: string | null
  titulo_localizacao: string | null
  perspectiva_url: string | null
  tour_virtual_url: string | null
  waze_url: string | null
  mostrar_no_portfolio: boolean
  vagas: string | null
  total_unidades: number | null
  aceita_fgts: boolean
  capa_url: string | null
  logo_url: string | null
  videos: string[]
  destaque_home: boolean
  publicado: boolean
  ordem: number
}

export interface Midia { id: string; empreendimento_id: string; tipo: TipoMidia; url: string; legenda: string | null; ordem: number }
export interface Lazer {
  id: string; empreendimento_id: string; titulo: string; descricao: string | null
  /** Caminho da imagem do ícone no Storage (itens vindos do WordPress). */
  icone: string | null
  /** migration 21: chave do catálogo (src/components/app/catalogoIcones.ts). Tem prioridade sobre `icone` na exibição. */
  icone_catalogo: string | null
  imagem_url: string | null; ordem: number
}
export interface Proximidade {
  id: string; empreendimento_id: string; nome: string; distancia: string | null; tempo_pe: string | null; tempo_carro: string | null
  tempo_transporte: string | null; tempo_bike: string | null; foto_url: string | null; ordem: number
  /** migration 21: categoria (chave do catálogo de proximidades: mercado, escola, metro…). */
  icone_catalogo: string | null
}
export interface FichaItem { id: string; empreendimento_id: string; titulo: string; descricao: string | null; icone_url: string | null; ordem: number }
export interface ObraAtualizacao { id: string; empreendimento_id: string; percentual: number | null; titulo: string; descricao: string | null; fotos: string[]; data: string }

export interface EmpreendimentoCompleto extends Empreendimento {
  empreendimento_midias: Midia[]
  empreendimento_lazer: Lazer[]
  empreendimento_proximidades: Proximidade[]
  empreendimento_ficha: FichaItem[]
}

export interface Unidade {
  id: string
  empreendimento_id: string
  identificador: string
  metragem: number | null
  valor: number | null
  dormitorios: number | null
  andar: string | null
  status: StatusUnidade
}

// `clientes`, `leads`, `propostas` e `parceiro_clientes` não são lidas direto pela API depois do corte (§4.3): o formato
// de cada RPC está em src/modulos/crm/tipos.ts. Abaixo, só as tabelas de exibição do portal (políticas por meu_cliente_id).
export interface ClienteNegocio { id: string; cliente_id: string; empreendimento_id: string | null; unidade_id: string | null; descricao: string | null; status: string | null; valor: number | null; created_at: string; contrato_id?: string | null; imovel_id?: string | null; empreendimentos?: { nome: string; slug: string; capa_url: string | null } | null; unidades?: { identificador: string; metragem: number | null } | null }
export interface PortalAcesso { id: number; cliente_id: string | null; ip: string | null; user_agent: string | null; sucesso: boolean; created_at: string }
export interface ClienteArquivo { id: string; cliente_id: string; negocio_id: string | null; nome: string; storage_path: string; created_at: string }

// ---------- reexportações dos contratos dos módulos ----------

export type { RpcRede } from '@/modulos/rede/tipos'
export type { RpcCrm } from '@/modulos/crm/tipos'
export type { RpcContratos } from '@/modulos/contratos/tipos'
export type { RpcImoveis } from '@/modulos/imoveis/tipos'
export type { RpcGovernanca } from '@/modulos/governanca/tipos'
export type { RpcPortal } from '@/modulos/portal/tipos'
export type { RpcConfig } from '@/modulos/config/tipos'

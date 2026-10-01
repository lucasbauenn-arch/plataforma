// Contrato de Configurações (WP4 simulação/modelos/signatários; WP6 geral/transições/permissões/notificações/termos/
// equipe/anonimização): linhas das tabelas de configuração (leitura direta com RLS) e RPCs do Super
// (docs/ARQUITETURA_EXPANSAO.md §3.3, §3.6, §3.8, §3.9 e §4.4). Tabelas versionadas são somente inclusão.

import type {
  AcaoRede, DataHoraISO, DefRpc, EntidadeTransicao, ModeloChave, Papel, PapelSignatario, TipoParceiro, Uuid,
} from '@/lib/types'

/** `configuracao_geral` (linha única, `id = true`). Leitura: internos; parceiros leem a view `configuracao_publica`. */
export interface ConfiguracaoGeral {
  id: true
  // casa (A4): semeada na migration 04 (NOT NULL)
  imobiliaria_casa_id: Uuid
  gerente_casa_id: Uuid
  corretor_casa_id: Uuid
  // CRM
  exclusividade_dias: number
  duplicidade_bloqueios_hora: number
  documentos_basicos: string[]
  documento_max_bytes: number
  portal_libera_pre_cadastro: boolean
  // contratos
  vendedora_razao_social: string | null
  /** 14 dígitos. */
  vendedora_cnpj: string | null
  vendedora_endereco: string | null
  prazo_assinatura_dias: number | null
  // imóveis
  imovel_fotos_max: number
  imovel_foto_max_bytes: number
  // segurança
  exigir_mfa_interno: boolean
  sessao_inatividade_horas: number
  retencao_acesso_meses: number
  retencao_operacao_meses: number
  download_ttl_segundos: number
  // carimbo
  criado_em: DataHoraISO
  atualizado_em: DataHoraISO | null
  atualizado_por: Uuid | null
}

/** View `configuracao_publica` (S para parceiros): sem retenção nem MFA. */
export type ConfiguracaoPublica = Omit<ConfiguracaoGeral,
  'exigir_mfa_interno' | 'retencao_acesso_meses' | 'retencao_operacao_meses' | 'criado_em' | 'atualizado_em' | 'atualizado_por'>

/** `p` de `config_atualizar`: só as chaves enviadas mudam; ids da casa não mudam por aqui. Auditoria com antes e depois. */
export type ConfigAtualizacao = Partial<Omit<ConfiguracaoGeral,
  'id' | 'imobiliaria_casa_id' | 'gerente_casa_id' | 'corretor_casa_id' | 'criado_em' | 'atualizado_em' | 'atualizado_por'>>

/** `parametros_simulacao` (versionada; vigente = maior `vigente_desde <= now()`). Percentuais na unidade "%". */
export interface ParametrosSimulacao {
  id: Uuid
  vigente_desde: DataHoraISO
  taxa_aporte_proprio: number
  taxa_financeiro: number | null
  juros_ao_mes: number | null
  igpm_atual: number | null
  parcela_minima: number
  parcela_maxima: number
  valor_minimo: number | null
  valor_minimo_flex: number | null
  criado_em: DataHoraISO
  criado_por: Uuid | null
}

/** `p` de `config_publicar_parametros`: nova versão vigente a partir de agora. */
export type ParametrosPublicacao = Omit<ParametrosSimulacao, 'id' | 'vigente_desde' | 'criado_em' | 'criado_por'>

/** `contrato_modelos` (versionada; vigente = maior versão da chave). `conteudo` em marcação restrita `marcacao_v1`, nunca HTML. */
export interface ContratoModelo {
  id: Uuid
  chave: ModeloChave
  versao: number
  titulo: string
  conteudo: string
  variaveis: string[]
  revisado_juridico: boolean
  liberado_para_envio: boolean
  liberado_por: Uuid | null
  liberado_em: DataHoraISO | null
  publicado_em: DataHoraISO
  publicado_por: Uuid | null
}

/** `contrato_signatario_regras` (D3). E-mail nulo em regra ativa com fonte `fixo` bloqueia o envio. */
export interface ContratoSignatarioRegra {
  id: Uuid
  modelo_chave: ModeloChave
  ordem: number
  papel: PapelSignatario
  fonte: 'cliente' | 'corretor_do_cliente' | 'fixo'
  nome: string | null
  email: string | null
  ato: 'assinar' | 'testemunhar'
  ativo: boolean
}

/** Validações da lista fechada de `status_transicoes.validacoes` (§3.8). */
export type ValidacaoTransicao =
  | 'contrato_assinado' | 'campos_obrigatorios_imovel' | 'pdf_gerado' | 'signatarios_configurados' | 'vendedora_configurada'
  | 'modelo_liberado' | 'email_cliente' | 'valor_produto_atual' | 'arquivo_enviado'

/** Efeitos da lista fechada de `status_transicoes.efeitos` (§3.8). */
export type EfeitoTransicao =
  | 'solicitar_documentos_basicos' | 'limpar_motivo_perda' | 'notificar_documento_rejeitado' | 'imovel_no_contrato'
  | 'imovel_aprovado' | 'cliente_finalizado' | 'evento_contrato_assinado'

/** `status_transicoes` (S para parceiros aprovados e internos, para o menu e o kanban; o Super edita papéis, motivo e `ativa`). */
export interface StatusTransicao {
  entidade: EntidadeTransicao
  de: string
  para: string
  /** Quem aciona manualmente (`[]` = ninguém). */
  papeis: Papel[]
  permite_criador: boolean
  sistema: boolean
  exige_motivo: boolean
  validacoes: ValidacaoTransicao[]
  efeitos: EfeitoTransicao[]
  ativa: boolean
  atualizado_em: DataHoraISO
  atualizado_por: Uuid | null
}

/** `permissoes_rede` (chave `acao` + `tipo`). */
export interface PermissaoRede {
  acao: AcaoRede
  tipo: TipoParceiro
  permitido: boolean
  criado_em: DataHoraISO
  atualizado_em: DataHoraISO | null
  atualizado_por: Uuid | null
}

/** Tipos semeados em `notificacoes_config` (§3.9). Só `crm.boas_vindas` e `crm.documento_rejeitado` começam ligados (N10). */
export type TipoNotificacao =
  | 'crm.boas_vindas' | 'crm.documento_rejeitado' | 'crm.documento_solicitado' | 'crm.novo_lead_corretor'
  | 'contratos.enviado' | 'contratos.assinado' | 'rede.transferencia'
  // decisões do dono de 29/09/2026 (migrations 23 e 24)
  | 'crm.exclusividade_transferida' | 'portal.solicitacao'

/** `notificacoes_config`. */
export interface NotificacaoConfig {
  tipo: TipoNotificacao
  ativo: boolean
  descricao: string
  criado_em: DataHoraISO
  atualizado_em: DataHoraISO | null
  atualizado_por: Uuid | null
}

/** RPCs de configuração (todas só do Super, conferido no servidor). */
export interface RpcConfig {
  /** Lista de colunas permitidas; auditoria configuracao com antes e depois. */
  config_atualizar: DefRpc<{ p: ConfigAtualizacao }, void>
  config_publicar_parametros: DefRpc<{ p: ParametrosPublicacao }, void>
  /** Valida a marcação e as variáveis contra a lista permitida; devolve o id da nova versão. */
  config_publicar_modelo: DefRpc<{ p_chave: ModeloChave; p_titulo: string; p_conteudo: string }, Uuid>
  /** Libera para envio e registra a revisão jurídica. */
  config_liberar_modelo: DefRpc<{ p_id: Uuid; p_revisado_juridico: boolean }, void>
  /** Só entre `admin`, `super` e `colaborador`; nunca remove o último Super. */
  equipe_definir_papel: DefRpc<{ p_profile_id: Uuid; p_papel: Papel }, void>
}

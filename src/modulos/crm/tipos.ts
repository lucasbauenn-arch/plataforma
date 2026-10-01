// Contrato do CRM (WP2 cadastro/ficha/leads/propostas, WP3 funil/atividades): parâmetros e JSON devolvido por
// cada RPC `crm_*`, `leads_*` e `propostas_*` (docs/ARQUITETURA_EXPANSAO.md §3.4, §3.5, §4.4 e §7.3).
// Dado pessoal de cliente só sai por estas RPCs (auditadas); nenhuma tabela do CRM tem grant para `authenticated`.
// Convenções:
// - nomes de argumento = nomes exatos dos parâmetros SQL; todos são enviados (nulo quando não se aplica);
// - RPC de escrita sem retorno = `returns void`; de leitura devolve `null` fora do escopo e grava `acesso_negado`;
// - no JSON, datas de criação saem como `criado_em` (inclusive de tabelas antigas com `created_at`);
// - CPF, CNPJ, CEP e telefones saem só com dígitos (a máscara é do front);
// - nomes da cadeia acima de quem consulta (PAR-3) saem nulos: corretor não vê gerente nem imobiliária;
//   gerente não vê a imobiliária; imobiliária e internos veem tudo.

import type {
  DataHoraISO, DataISO, DefRpc, EstadoCivil, EtapaFunil, FiltroPaginacao, FormatoDocumento, Genero, OrigemCliente, OrigemConsentimento,
  Pagina, Papel, Ref, StatusContrato, StatusDocumento, StatusLead, StatusProposta, StatusTarefa, TipoDocumento,
  TipoParceiro, TipoPessoa, Uuid, DownloadAutorizado,
} from '@/lib/types'

// =====================================================================================================
// Cadastro e ficha [WP2]
// =====================================================================================================

/**
 * `p_dados` de `crm_cadastrar_cliente` e `leads_converter`. PF exige `cpf` (DV) e não aceita `cnpj`; PJ o contrário.
 * O servidor ignora qualquer chave fora desta lista (cadeia, etapa, origem e `portal_liberado` nunca vêm do front).
 */
export interface ClienteDados {
  tipo_pessoa: TipoPessoa
  nome: string
  sobrenome?: string | null
  /** 11 dígitos (PF). */
  cpf?: string | null
  /** 14 dígitos (PJ). */
  cnpj?: string | null
  rg?: string | null
  data_nascimento?: DataISO | null
  genero?: Genero | null
  estado_civil?: EstadoCivil | null
  nacionalidade?: string | null
  email?: string | null
  emails_adicionais?: string[]
  /** Só dígitos (10 ou 11). */
  telefone?: string | null
  telefones_adicionais?: string[]
  horario_contato?: string | null
  /** 8 dígitos. */
  cep?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
  pais?: string | null
  /** Mesmas opções de `INTERESSES` (src/lib/constants.ts). */
  interesses?: string[]
}

/**
 * `p_dados` de `crm_editar_cliente`: só as chaves enviadas mudam. `tipo_pessoa` não muda por aqui.
 * CPF/CNPJ só se estiver vazio (fora disso, só interno). `corretor_id` nunca muda por aqui (use a transferência).
 */
export type ClienteEdicao = Partial<Omit<ClienteDados, 'tipo_pessoa'>>

/**
 * Resultado de `crm_cadastrar_cliente` e `leads_converter` (regra A2, decidida pelo dono em 29/09/2026; migration 23):
 * - `criado`: novo cliente, `id` preenchido;
 * - `ja_na_sua_carteira`: o documento já é de um cliente no escopo de quem cadastra, `id` = esse cliente;
 * - `transferido`: o documento era de outro parceiro, mas a exclusividade (180 dias sem atividade) venceu: o cliente
 *   passou para o responsável deste cadastro (histórico, auditoria e aviso ao antigo dono no servidor), `id` = ele;
 * - `indisponivel`: o documento é de outro parceiro; `id` nulo e **nunca o dono**. `exclusividade_ate` vem só quando o
 *   motivo é o prazo; cliente com contrato ou do portal não é tomado e vem sem data.
 * Acima de `duplicidade_bloqueios_hora` bloqueios na última hora: erro `LIMITE_DUPLICIDADE`.
 */
export interface CadastroResultado {
  situacao: 'criado' | 'ja_na_sua_carteira' | 'transferido' | 'indisponivel'
  id: Uuid | null
  /** Só em `indisponivel` por exclusividade vigente. */
  exclusividade_ate?: DataHoraISO | null
}

/** `p_filtros` de `crm_listar`. O filtro por corretor/gerente/imobiliária é sempre cruzado com o escopo. */
export interface CrmFiltros {
  /** Nome, sobrenome, e-mail ou telefone. A auditoria grava só `{busca:true}`, nunca o texto. */
  busca?: string | null
  etapas?: EtapaFunil[] | null
  corretor_id?: Uuid | null
  gerente_id?: Uuid | null
  imobiliaria_id?: Uuid | null
  /** Só os clientes em que o usuário é o `corretor_id` (inclui o A1 do gerente). */
  so_meus?: boolean
  /** Filtra `criado_em` (inclusive). */
  periodo_de?: DataISO | null
  periodo_ate?: DataISO | null
  origem?: OrigemCliente | null
  /** Só internos; parceiro recebe sempre `false`. */
  incluir_inativos?: boolean
  /** Só internos: `true` = só com portal liberado. */
  portal_liberado?: boolean | null
  ordem?: 'recentes' | 'nome' | 'etapa_desde'
}

/** Cadeia do cliente para exibição (PAR-3: nível acima de quem consulta vem nulo). */
export interface CadeiaCliente {
  corretor: Ref | null
  gerente: Ref | null
  imobiliaria: (Ref & { da_casa: boolean }) | null
}

/** Item de `crm_listar`. Sem CPF/CNPJ (minimização): o documento só sai na ficha. */
export interface ClienteResumo extends CadeiaCliente {
  id: Uuid
  tipo_pessoa: TipoPessoa
  nome: string
  sobrenome: string | null
  email: string | null
  telefone: string | null
  etapa: EtapaFunil
  etapa_desde: DataHoraISO
  origem: OrigemCliente
  portal_liberado: boolean
  exclusividade_ate: DataHoraISO | null
  /** Documentos `pendente` ou `rejeitado`. */
  documentos_pendentes: number
  tarefas_atrasadas: number
  criado_em: DataHoraISO
  inativado_em: DataHoraISO | null
}

/** Item de `crm_clientes_opcoes(p_busca)`: até 20, para seletores (propostas, contratos). */
export interface ClienteOpcao {
  id: Uuid
  /** Nome e sobrenome. */
  nome: string
  etapa: EtapaFunil
  corretor_nome: string | null
}

/** Todos os campos do cliente, como gravados (só dígitos em documentos, CEP e telefones). */
export interface ClienteFicha {
  id: Uuid
  tipo_pessoa: TipoPessoa
  nome: string
  sobrenome: string | null
  cpf: string | null
  cnpj: string | null
  rg: string | null
  data_nascimento: DataISO | null
  genero: Genero | null
  estado_civil: EstadoCivil | null
  nacionalidade: string | null
  email: string | null
  emails_adicionais: string[]
  telefone: string | null
  telefones_adicionais: string[]
  horario_contato: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  pais: string
  interesses: string[]
  etapa: EtapaFunil
  etapa_desde: DataHoraISO
  motivo_perda: string | null
  origem: OrigemCliente
  exclusividade_ate: DataHoraISO | null
  portal_liberado: boolean
  /** Só internos: há usuário do portal vinculado (`clientes.user_id`). Parceiro recebe `false`. */
  tem_login_portal: boolean
  criado_em: DataHoraISO
  atualizado_em: DataHoraISO | null
  inativado_em: DataHoraISO | null
  motivo_inativacao: string | null
  anonimizado_em: DataHoraISO | null
}

/**
 * Destino de etapa que **quem consulta** pode acionar manualmente a partir da etapa atual
 * (linhas ativas de `status_transicoes` com o papel dele; `sistema`-only ficam de fora).
 */
export interface DestinoEtapa {
  para: EtapaFunil
  exige_motivo: boolean
  /** Nomes da lista fechada da §3.8 (ex.: `contrato_assinado`). */
  validacoes: string[]
  /** Nomes da lista fechada da §3.8 (ex.: `solicitar_documentos_basicos`). */
  efeitos: string[]
}

/** O que a tela pode oferecer; o servidor confere de novo em cada RPC. */
export interface PermissoesFicha {
  editar: boolean
  /** CPF/CNPJ vazio, ou interno. */
  editar_documento: boolean
  mudar_etapa: boolean
  criar_nota: boolean
  criar_tarefa: boolean
  solicitar_documento: boolean
  /** Enviar arquivo em nome do cliente. */
  enviar_documento: boolean
  /** `tem_permissao('analisar_documento')` + escopo (F4). */
  analisar_documento: boolean
  baixar_documento: boolean
  /** `tem_permissao('transferir_cliente')` e escopo de gestor, ou interno. */
  transferir: boolean
  /** `tem_permissao('criar_contrato')`. */
  criar_contrato: boolean
  criar_proposta: boolean
  /** Interno. */
  inativar: boolean
  /** Interno e PF com CPF. */
  liberar_portal: boolean
  /** Interno (aba Portal). */
  ver_portal: boolean
}

export interface ContadoresFicha {
  documentos_pendentes: number
  documentos_em_analise: number
  tarefas_pendentes: number
  tarefas_atrasadas: number
  notas: number
  /** Contratos fora de `recusado`, `expirado`, `cancelado` e `arquivado`. */
  contratos_ativos: number
  propostas: number
}

/** Vínculo do cliente com vigência (`cliente_vinculos_historico`), para a aba Afiliados. PAR-3 nos nomes. */
export interface VinculoClienteHistorico extends CadeiaCliente {
  vigente_de: DataHoraISO
  vigente_ate: DataHoraISO | null
  motivo: string | null
}

/** Consentimento LGPD do cliente (`lgpd_consentimentos`, titular `cliente`), mais recente primeiro. */
export interface ConsentimentoCliente {
  id: Uuid
  /** Nulo só na origem `migracao` (sem termo aceito de fato ⚑). */
  termo_id: Uuid | null
  termo_versao: string | null
  origem: OrigemConsentimento
  aceito_em: DataHoraISO
  /** Quem declarou (origem `declarado`); nulo quando foi o próprio titular. */
  registrado_por: Ref | null
  revogado_em: DataHoraISO | null
  motivo_revogacao: string | null
}

/** `crm_ficha(p_id)`: registra `acesso/consultar` com `cliente_id`. Fora do escopo: `null` e `acesso_negado`. */
export interface CrmFicha {
  cliente: ClienteFicha
  cadeia: CadeiaCliente
  destinos_etapa: DestinoEtapa[]
  permissoes: PermissoesFicha
  contadores: ContadoresFicha
  historico_vinculos: VinculoClienteHistorico[]
  consentimentos: ConsentimentoCliente[]
}

// ---------- duplicidades (internos) ----------

/** `cliente_duplicidades.resultado`. */
export type ResultadoDuplicidade =
  | 'bloqueado_exclusividade' | 'bloqueado_contrato' | 'bloqueado_pos_prazo' | 'mesmo_dono'
  /** Exclusividade vencida: o cliente passou para quem tentou (já resolvida, migration 23). */
  | 'transferido_exclusividade'
/** `p_decisao` de `crm_duplicidade_resolver`: `transferir` usa a mesma lógica de `rede_transferir_clientes`, para quem tentou. */
export type DecisaoDuplicidade = 'manter' | 'transferir'

export interface DuplicidadesFiltros extends FiltroPaginacao {
  /** `true` = só `resolvido_em is null`. */
  pendentes?: boolean
  resultado?: ResultadoDuplicidade | null
}

export interface DuplicidadeItem {
  id: Uuid
  /** O cliente que já existe. */
  cliente: {
    id: Uuid
    nome: string
    etapa: EtapaFunil
    corretor: Ref
    imobiliaria: Ref
    exclusividade_ate: DataHoraISO | null
  }
  /** Nulo quando veio do pré-cadastro público. */
  tentado_por: { profile_id: Uuid; nome: string; papel: Papel } | null
  tentado_por_parceiro: { id: Uuid; nome: string; tipo: TipoParceiro; imobiliaria: Ref } | null
  origem: OrigemCliente
  resultado: ResultadoDuplicidade
  ocorrido_em: DataHoraISO
  resolvido_em: DataHoraISO | null
  resolvido_por: Ref | null
  decisao: DecisaoDuplicidade | null
  motivo_decisao: string | null
  /** Há parceiro ativo que pode receber o cliente. */
  pode_transferir: boolean
}

// ---------- leads do site (internos) ----------

export interface LeadsFiltros extends FiltroPaginacao {
  status?: StatusLead | null
  /** Nome, e-mail ou telefone (não vai para a auditoria). */
  busca?: string | null
  empreendimento_id?: Uuid | null
  de?: DataISO | null
  ate?: DataISO | null
}

export interface LeadItem {
  id: Uuid
  nome: string
  email: string | null
  telefone: string | null
  mensagem: string | null
  origem: string | null
  empreendimento: Ref | null
  status: StatusLead
  cliente_id: Uuid | null
  tratado_por: Ref | null
  tratado_em: DataHoraISO | null
  motivo_descarte: string | null
  criado_em: DataHoraISO
}

// ---------- propostas ----------

export interface PropostasFiltros extends FiltroPaginacao {
  status?: StatusProposta | null
  empreendimento_id?: Uuid | null
  cliente_id?: Uuid | null
}

export interface PropostaItem extends CadeiaCliente {
  id: Uuid
  empreendimento: Ref
  unidade: { id: Uuid; identificador: string } | null
  cliente: Ref | null
  /** Quem enviou (`propostas.parceiro_id`, id do perfil). */
  autor: Ref
  texto: string
  status: StatusProposta
  resposta_admin: string | null
  criado_em: DataHoraISO
  atualizado_em: DataHoraISO | null
  /** Interno. */
  pode_responder: boolean
}

// ---------- pré-cadastro público (service role) ----------

/** `p_dados` de `crm_pre_cadastro` (montado pela Edge `pre-cadastro`, §6.1). */
export interface PreCadastroDados {
  tipo_pessoa: TipoPessoa
  nome: string
  sobrenome: string | null
  /** CPF (11) ou CNPJ (14) conforme `tipo_pessoa`, só dígitos. */
  documento: string
  email: string | null
  telefone: string
}

/**
 * A Edge responde 200 para `criado` e `duplicado` (iguais), 404 para `codigo_invalido`, 503 para `termo_invalido`
 * (sem termo revisado), 409 para `termo_desatualizado` (outro termo vigente: a página relê) e 429 para `limite`
 * (limite A2 de bloqueios por hora do link).
 */
export interface PreCadastroResultado {
  situacao: 'criado' | 'duplicado' | 'codigo_invalido' | 'termo_invalido' | 'termo_desatualizado' | 'limite'
}

// =====================================================================================================
// Funil e atividades [WP3]
// =====================================================================================================

/** `p_filtros` de `crm_kanban` e `crm_kanban_coluna`. */
export interface KanbanFiltros {
  /** Por nome (não vai para a auditoria). */
  busca?: string | null
  corretor_id?: Uuid | null
  gerente_id?: Uuid | null
  imobiliaria_id?: Uuid | null
  so_meus?: boolean
  /** Período dos contadores de finalizados/perdidos (`etapa_desde`); sem período = acumulado. */
  periodo_de?: DataISO | null
  periodo_ate?: DataISO | null
}

export interface KanbanCartao {
  id: Uuid
  /** Nome e sobrenome. */
  nome: string
  /** Só dígitos, para `whatsappBR`. */
  telefone: string | null
  /** Para gestores e internos; nulo quando quem consulta é o próprio corretor. */
  corretor: Ref | null
  etapa: EtapaFunil
  etapa_desde: DataHoraISO
  dias_na_etapa: number
  /** Documentos `pendente` ou `rejeitado`. */
  documentos_pendentes: number
  tarefa_atrasada: boolean
  /** Só em `perdido`. */
  motivo_perda: string | null
}

/** Uma coluna do kanban. `total` = total da etapa no escopo com os filtros. */
export interface KanbanColuna extends Pagina<KanbanCartao> {
  etapa: EtapaFunil
}

export interface KanbanContadores {
  /** Clientes ativos no escopo (todas as etapas). */
  total: number
  /** Entraram em `finalizado` no período. */
  finalizados: number
  /** Entraram em `perdido` no período. */
  perdidos: number
}

/** `crm_kanban`: as 5 colunas na ordem do funil (`perdido` por último), cada uma com até `p_limite_coluna` cartões. */
export interface KanbanResultado {
  colunas: KanbanColuna[]
  contadores: KanbanContadores
}

/** `crm_mudar_etapa`. */
export interface MudancaEtapa {
  de: EtapaFunil
  para: EtapaFunil
  etapa_desde: DataHoraISO
  /** Nomes das solicitações criadas pelo efeito `solicitar_documentos_basicos` (vazio se nenhuma). */
  documentos_solicitados: string[]
}

/** `cliente_eventos.tipo` (lista fechada do F3, §3.5). */
export type TipoEventoCliente =
  | 'cadastro' | 'pre_cadastro' | 'etapa' | 'nota' | 'tarefa_criada' | 'tarefa_concluida'
  | 'documento_solicitado' | 'documento_enviado' | 'documento_analisado'
  | 'contrato_gerado' | 'contrato_enviado' | 'contrato_assinado' | 'contrato_encerrado'
  | 'transferencia' | 'proposta_enviada' | 'proposta_respondida' | 'consentimento' | 'migracao' | 'tentativa_duplicada'

/** `cliente_eventos.dados` por tipo: só ids, etapas, status e motivo (nunca dado pessoal). */
export interface DadosEventoCliente {
  cadastro: { origem: OrigemCliente }
  pre_cadastro: { corretor_id: Uuid }
  etapa: { de: EtapaFunil; para: EtapaFunil; motivo: string | null }
  nota: { nota_id: Uuid }
  tarefa_criada: { tarefa_id: Uuid }
  tarefa_concluida: { tarefa_id: Uuid }
  documento_solicitado: { documento_id: Uuid }
  documento_enviado: { documento_id: Uuid; arquivo_id: Uuid }
  documento_analisado: { documento_id: Uuid; status: 'aprovado' | 'rejeitado' }
  contrato_gerado: { contrato_id: Uuid }
  contrato_enviado: { contrato_id: Uuid }
  contrato_assinado: { contrato_id: Uuid }
  contrato_encerrado: { contrato_id: Uuid; status: StatusContrato }
  transferencia: { de_corretor_id: Uuid | null; para_corretor_id: Uuid }
  proposta_enviada: { proposta_id: Uuid }
  proposta_respondida: { proposta_id: Uuid; status: StatusProposta }
  consentimento: { termo_id: Uuid; origem: string }
  migracao: { origem: string }
  /** O dono vê a tentativa sem saber por quem. */
  tentativa_duplicada: { resultado: ResultadoDuplicidade }
}

/** Evento da timeline, discriminado por `tipo`. `id` é `bigint` (número). */
export type TimelineEvento = {
  [T in TipoEventoCliente]: {
    id: number
    tipo: T
    ocorrido_em: DataHoraISO
    /** Sem dado pessoal (ex.: "Documento solicitado: CNH"). */
    titulo: string
    /**
     * Nome do ator. PAR-3: nome real só de quem consulta e de quem está abaixo dele na rede; acima, ao lado ou em outra
     * cadeia vem genérico ("Imobiliária", "Gerência", "Corretor", "Equipe Arken"); nulo = sistema.
     */
    ator_nome: string | null
    ator_papel: Papel | null
    dados: DadosEventoCliente[T]
  }
}[TipoEventoCliente]

/** `crm_timeline(p_id, p_antes, p_limite)`: eventos com `ocorrido_em < p_antes` (nulo = agora), do mais novo ao mais antigo. */
export interface TimelinePagina {
  itens: TimelineEvento[]
  /** Há eventos mais antigos. */
  mais: boolean
}

/** Item de `crm_notas` (mais nova primeiro). O texto é exibido escapado (sem HTML). */
export interface ClienteNota {
  id: Uuid
  texto: string
  autor_nome: string | null
  autor_papel: Papel | null
  criado_em: DataHoraISO
  migrado_legado: boolean
  removido_lgpd: boolean
  /** Escrita por quem consulta. */
  minha: boolean
}

/** Item de `crm_tarefas` (pendentes primeiro, por prazo). `Ref.id` de pessoas = id do perfil. */
export interface ClienteTarefa {
  id: Uuid
  cliente_id: Uuid
  titulo: string
  descricao: string | null
  /** Nulo se o perfil do responsável foi removido. */
  responsavel: Ref | null
  prazo: DataISO | null
  status: StatusTarefa
  /** `status = 'pendente'` e `prazo < hoje` (fuso America/Sao_Paulo). */
  atrasada: boolean
  concluida_em: DataHoraISO | null
  concluida_por: Ref | null
  criado_em: DataHoraISO
  criado_por: Ref | null
  pode_editar: boolean
  pode_concluir: boolean
}

/** `p_dados` de `crm_tarefa_editar`: só as chaves enviadas mudam; o novo responsável precisa ter escopo sobre o cliente. */
export interface TarefaEdicao {
  titulo?: string
  descricao?: string | null
  responsavel_id?: Uuid
  prazo?: DataISO | null
}

/** Item de `crm_responsaveis(p_cliente_id)`: quem tem escopo sobre o cliente e pode ser responsável. */
export interface Responsavel {
  profile_id: Uuid
  nome: string
  papel: Papel
  tipo: TipoParceiro | null
}

/** `p_filtros` de `crm_minhas_tarefas`. Só voltam tarefas cujo cliente ainda está no escopo. */
export interface TarefasFiltros extends FiltroPaginacao {
  /** `minhas` = responsável é quem consulta; `equipe` = de clientes no escopo (gestores e internos). */
  escopo?: 'minhas' | 'equipe'
  status?: StatusTarefa | null
  atrasadas?: boolean
  prazo_ate?: DataISO | null
  cliente_id?: Uuid | null
  responsavel_id?: Uuid | null
}

export interface TarefaItem extends ClienteTarefa {
  cliente: Ref
}

/** Versão do arquivo de um documento (todas ficam, inclusive as rejeitadas). Sem caminho: baixar é por `crm_documento_baixar`. */
export interface DocumentoArquivo {
  id: Uuid
  mime_type: string
  tamanho_bytes: number
  enviado_em: DataHoraISO
  /** "Cliente" quando enviado pelo portal. */
  enviado_por_nome: string | null
  /** É o `arquivo_atual_id` do documento. */
  atual: boolean
  /** Removido pela anonimização. */
  removido: boolean
}

/** Item de `crm_documentos(p_id)` (só solicitações ativas). */
export interface ClienteDocumento {
  id: Uuid
  cliente_id: Uuid
  tipo: TipoDocumento
  nome: string
  formatos_aceitos: FormatoDocumento[]
  status: StatusDocumento
  basico: boolean
  contrato_id: Uuid | null
  analisado_em: DataHoraISO | null
  analisado_por: Ref | null
  motivo_rejeicao: string | null
  criado_em: DataHoraISO
  arquivos: DocumentoArquivo[]
}

// =====================================================================================================
// RPCs
// =====================================================================================================

/** RPCs do CRM que o front chama (grant para `authenticated`). */
export interface RpcCrm {
  // cadastro, ficha, lista [WP2]
  crm_cadastrar_cliente: DefRpc<{ p_dados: ClienteDados; p_corretor_id: Uuid | null; p_termo_id: Uuid }, CadastroResultado>
  crm_editar_cliente: DefRpc<{ p_id: Uuid; p_dados: ClienteEdicao }, void>
  crm_listar: DefRpc<{ p_filtros: CrmFiltros; p_limite: number; p_offset: number }, Pagina<ClienteResumo>>
  crm_clientes_opcoes: DefRpc<{ p_busca: string | null }, ClienteOpcao[]>
  crm_ficha: DefRpc<{ p_id: Uuid }, CrmFicha | null>
  /** I. Sem contrato ativo. */
  crm_inativar_cliente: DefRpc<{ p_id: Uuid; p_motivo: string }, void>
  /** I. PF com CPF. */
  crm_liberar_portal: DefRpc<{ p_id: Uuid; p_liberar: boolean }, void>
  crm_duplicidades_listar: DefRpc<{ p_filtros: DuplicidadesFiltros }, Pagina<DuplicidadeItem>>
  crm_duplicidade_resolver: DefRpc<{ p_id: Uuid; p_decisao: DecisaoDuplicidade; p_motivo: string }, void>
  leads_listar: DefRpc<{ p_filtros: LeadsFiltros }, Pagina<LeadItem>>
  leads_converter: DefRpc<{ p_lead_id: Uuid; p_corretor_id: Uuid | null; p_dados: ClienteDados; p_termo_id: Uuid }, CadastroResultado>
  leads_descartar: DefRpc<{ p_lead_id: Uuid; p_motivo: string }, void>
  /** Só `status = 'novo'` (spam). */
  leads_excluir: DefRpc<{ p_lead_id: Uuid }, void>
  /** Exportação auditada: todas as linhas que passam nos filtros (sem paginação; máximo 5.000). */
  leads_exportar: DefRpc<{ p_filtros: LeadsFiltros }, LeadItem[]>
  propostas_listar: DefRpc<{ p_filtros: PropostasFiltros }, Pagina<PropostaItem>>
  /** P aprovado com o cliente no escopo (ou sem cliente). Devolve o id. */
  propostas_criar: DefRpc<{ p_empreendimento_id: Uuid; p_cliente_id: Uuid | null; p_unidade_id: Uuid | null; p_texto: string }, Uuid>
  /** I. */
  propostas_responder: DefRpc<{ p_id: Uuid; p_status: StatusProposta; p_resposta: string | null }, void>

  // funil e atividades [WP3]
  crm_kanban: DefRpc<{ p_filtros: KanbanFiltros; p_limite_coluna: number }, KanbanResultado>
  /** Próxima página de uma coluna (limite fixo de 50). */
  crm_kanban_coluna: DefRpc<{ p_etapa: EtapaFunil; p_filtros: KanbanFiltros; p_offset: number }, KanbanColuna>
  crm_mudar_etapa: DefRpc<{ p_id: Uuid; p_para: EtapaFunil; p_motivo: string | null }, MudancaEtapa>
  crm_timeline: DefRpc<{ p_id: Uuid; p_antes: DataHoraISO | null; p_limite: number }, TimelinePagina | null>
  crm_notas: DefRpc<{ p_id: Uuid }, ClienteNota[] | null>
  crm_tarefas: DefRpc<{ p_id: Uuid }, ClienteTarefa[] | null>
  crm_documentos: DefRpc<{ p_id: Uuid }, ClienteDocumento[] | null>
  crm_nota_criar: DefRpc<{ p_cliente_id: Uuid; p_texto: string }, Uuid>
  crm_tarefa_criar: DefRpc<{ p_cliente_id: Uuid; p_titulo: string; p_descricao: string | null; p_responsavel_id: Uuid; p_prazo: DataISO | null }, Uuid>
  crm_tarefa_editar: DefRpc<{ p_id: Uuid; p_dados: TarefaEdicao }, void>
  crm_tarefa_concluir: DefRpc<{ p_id: Uuid }, void>
  crm_responsaveis: DefRpc<{ p_cliente_id: Uuid }, Responsavel[] | null>
  crm_minhas_tarefas: DefRpc<{ p_filtros: TarefasFiltros }, Pagina<TarefaItem>>
  /** `p_formatos` ⊂ `FormatoDocumento`; `p_contrato_id` só para documento de contrato. */
  crm_documento_solicitar: DefRpc<{ p_cliente_id: Uuid; p_nome: string; p_formatos: FormatoDocumento[]; p_contrato_id: Uuid | null }, void>
  crm_documento_cancelar: DefRpc<{ p_id: Uuid; p_motivo: string }, void>
  /**
   * Depois do upload em `crm-documentos/<cliente_id>/<documento_id>/<uuid>.<ext>`: confere prefixo, existência,
   * tamanho e MIME reais e leva o documento a `em_analise`. Também usada pelo titular no portal.
   */
  crm_documento_registrar_envio: DefRpc<{ p_documento_id: Uuid; p_path: string }, void>
  crm_documento_analisar: DefRpc<{ p_id: Uuid; p_aprovar: boolean; p_motivo: string | null }, void>
  /** P+I com escopo (o titular não baixa). */
  crm_documento_baixar: DefRpc<{ p_arquivo_id: Uuid }, DownloadAutorizado>
}

/** RPC de sistema: **só `service_role`** (Edge `pre-cadastro`). O front não chama. */
export interface RpcCrmServico {
  crm_pre_cadastro: DefRpc<{ p_codigo: string; p_dados: PreCadastroDados; p_termo_id: Uuid; p_ip: string | null; p_user_agent: string | null }, PreCadastroResultado>
}

// =====================================================================================================
// Front: props comuns das abas da ficha (src/modulos/crm/ficha/Aba*.tsx)
// =====================================================================================================

/** Chave do TanStack Query da ficha (invalide depois de ações que mudam etapa, contadores ou permissões). */
export const chaveFicha = (clienteId: Uuid) => ['crm-ficha', clienteId] as const

export interface PropsAbaFicha {
  clienteId: Uuid
  ficha: CrmFicha
  /** Recarrega `crm_ficha` (contadores, destinos e permissões) depois de uma ação. */
  recarregarFicha: () => void
}

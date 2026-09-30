// Contrato do módulo Rede (WP1): linhas lidas pela API com RLS e parâmetros/retorno de cada RPC `rede_*`
// (docs/ARQUITETURA_EXPANSAO.md §3.3, §4.2 e §4.4). Os corpos SQL devolvem exatamente estes formatos.
// Convenções: nomes de argumento = nomes exatos dos parâmetros SQL; RPC de escrita sem retorno = `returns void`;
// RPC de leitura devolve `null` quando o registro não existe **ou** está fora do escopo (não revela existência).

import type {
  DataHoraISO, DefRpc, Escopo, Papel, Ref, SemArgs, StatusParceiro, TipoParceiro, Uuid,
} from '@/lib/types'

export type { Escopo } from '@/lib/types'

// ---------- linhas (RLS) ----------

/** `public.imobiliarias`. Parceiros leem só a sua; internos leem todas. Escrita só por RPC. */
export interface Imobiliaria {
  id: Uuid
  nome: string
  razao_social: string | null
  /** 14 dígitos, sem máscara. Nulo só na casa (⚑ N7). */
  cnpj: string | null
  creci_pj: string | null
  email: string | null
  telefone: string | null
  /** 8 dígitos, sem máscara. */
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  da_casa: boolean
  criado_em: DataHoraISO
  criado_por: Uuid | null
  atualizado_em: DataHoraISO | null
  atualizado_por: Uuid | null
  inativado_em: DataHoraISO | null
  inativado_por: Uuid | null
  motivo_inativacao: string | null
}

/**
 * `public.parceiros` com as colunas liberadas por grant de coluna (**sem `cpf`**; o CPF só sai por
 * `rede_parceiro_detalhe`, auditada). Política "parceiros: escopo lê": interno; o próprio; a imobiliária inteira;
 * o gerente e os corretores dele.
 */
export interface Parceiro {
  id: Uuid
  profile_id: Uuid | null
  tipo: TipoParceiro
  imobiliaria_id: Uuid
  /** Obrigatório para `corretor`, nulo para os demais tipos. */
  gerente_id: Uuid | null
  nome: string
  creci: string | null
  email: string | null
  telefone: string | null
  /** 10 caracteres `[a-z2-7]`; nulo depois de inativado. */
  codigo_indicacao: string | null
  virtual: boolean
  migrado_legado: boolean
  imobiliaria_declarada: string | null
  criado_em: DataHoraISO
  inativado_em: DataHoraISO | null
}

/** Colunas que a API pode ler em `parceiros` (use em `.select(COLUNAS_PARCEIRO)`; `*` falha por causa do grant de coluna). */
export const COLUNAS_PARCEIRO =
  'id, profile_id, tipo, imobiliaria_id, gerente_id, nome, creci, email, telefone, codigo_indicacao, virtual, migrado_legado, imobiliaria_declarada, criado_em, inativado_em'

// ---------- entradas (p_dados) ----------

/** `p_dados` de `rede_cadastrar_imobiliaria`. CNPJ (DV e único) e CRECI PJ obrigatórios (PAR-4). */
export interface ImobiliariaDados {
  nome: string
  razao_social?: string | null
  /** 14 dígitos. */
  cnpj: string
  creci_pj: string
  email?: string | null
  telefone?: string | null
  /** 8 dígitos. */
  cep?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
}

/** `p_dados` de `rede_editar_imobiliaria`: só as chaves enviadas são alteradas. */
export type ImobiliariaEdicao = Partial<ImobiliariaDados>

/**
 * `p_dados` de `rede_cadastrar_parceiro`. PAR-4: gerente e corretor exigem CPF (DV, único); corretor exige CRECI PF.
 * Imobiliária (usuário da organização) não exige CPF.
 */
export interface ParceiroDados {
  nome: string
  /** 11 dígitos. */
  cpf?: string | null
  creci?: string | null
  email?: string | null
  telefone?: string | null
}

/**
 * `p_dados` de `rede_editar_parceiro` e `rede_atualizar_meu_cadastro`: só as chaves enviadas são alteradas.
 * CPF só é aceito se estiver vazio; o e-mail não muda se já houver login (é do Auth).
 */
export type ParceiroEdicao = Partial<ParceiroDados>

/** `p_dados` de `rede_aprovar_autocadastro`: completa o cadastro PAR-4 do corretor aprovado. */
export interface AprovacaoDados {
  /** 11 dígitos. [WP1] Vazio (`''`) = usa o CPF declarado no autocadastro (que o servidor valida e tira dos metadados do Auth). */
  cpf: string
  /** [WP1] Vazio (`''`) = usa o CRECI informado no autocadastro. */
  creci: string
  nome?: string | null
  telefone?: string | null
}

// ---------- saídas ----------

/** Vínculo com vigência (`parceiro_vinculos_historico`). Nomes fora do escopo de quem consulta (PAR-3) vêm nulos. */
export interface VinculoParceiroHistorico {
  imobiliaria: Ref | null
  gerente: Ref | null
  vigente_de: DataHoraISO
  vigente_ate: DataHoraISO | null
  motivo: string | null
}

/** `rede_parceiro_detalhe(p_id)`: registra `acesso/consultar`. `null` fora do escopo. */
export interface ParceiroDetalhe {
  id: Uuid
  profile_id: Uuid | null
  tipo: TipoParceiro
  nome: string
  /** 11 dígitos; é o motivo de esta leitura ser auditada. */
  cpf: string | null
  creci: string | null
  email: string | null
  telefone: string | null
  codigo_indicacao: string | null
  virtual: boolean
  migrado_legado: boolean
  imobiliaria_declarada: string | null
  imobiliaria: { id: Uuid; nome: string; da_casa: boolean }
  /** Gerente do corretor; nulo para gerente e imobiliária, e para quem está abaixo dele (PAR-3). */
  gerente: Ref | null
  /** `profiles.status_parceiro` do login; nulo sem login. */
  status_parceiro: StatusParceiro | null
  /** Papel do perfil vinculado; nulo sem login. */
  papel: Papel | null
  tem_login: boolean
  /** `auth.users.last_sign_in_at`; nulo se nunca entrou ou sem login. */
  ultimo_acesso_em: DataHoraISO | null
  /** Convite enviado e ainda não aceito (`invited_at` preenchido e `last_sign_in_at` nulo). */
  convite_pendente: boolean
  criado_em: DataHoraISO
  inativado_em: DataHoraISO | null
  motivo_inativacao: string | null
  /** Só para gerente: corretores ativos sob ele. */
  corretores_ativos: number
  /** Clientes ativos em que ele é o `corretor_id` (inclui o A1 do gerente). */
  clientes_ativos: number
  historico: VinculoParceiroHistorico[]
  /**
   * [WP1, aditivo] Histórico do status de acesso (`parceiro_status_historico`: aprovação, recusa, bloqueio, inativação,
   * reativação, vínculo por convite), com o motivo. Só para internos; nulo para os demais.
   */
  status_historico?: StatusParceiroHistorico[] | null
}

/** [WP1, aditivo] Linha de `parceiro_status_historico` devolvida em `ParceiroDetalhe.status_historico`. */
export interface StatusParceiroHistorico {
  de: StatusParceiro | null
  para: StatusParceiro
  /** Texto livre (bloqueio, recusa, inativação); fica fora da auditoria. */
  motivo: string | null
  ocorrido_em: DataHoraISO
}

/**
 * `rede_pode_convidar(p_parceiro_id)`, chamada com o JWT de quem convida (também pela Edge `convidar-parceiros`).
 * - `novo`: sem login e e-mail livre no Auth;
 * - `reenviar`: login vinculado a este parceiro e que nunca entrou (único caso de link para conta existente);
 * - `email_em_uso`: o e-mail já tem conta que não é deste parceiro (nenhum link é gerado);
 * - `ja_ativo`: já entrou alguma vez ("use Esqueci a senha");
 * - `sem_email`: parceiro sem e-mail cadastrado;
 * - `indisponivel`: parceiro virtual ou inativo.
 * `pode` = `situacao in ('novo','reenviar')`. `modo_link` = `tem_permissao('convite_por_link')`.
 * Fora da matriz ou do escopo: erro `42501`.
 */
export interface PodeConvidar {
  pode: boolean
  situacao: 'novo' | 'reenviar' | 'email_em_uso' | 'ja_ativo' | 'sem_email' | 'indisponivel'
  email: string | null
  nome: string
  modo_link: boolean
  /** [WP1, aditivo] Perfil já vinculado (em `reenviar`, a Edge confere que o Auth devolveu esta mesma conta). */
  profile_id?: Uuid | null
}

/** `rede_link_publico(p_codigo)` (anon). Mesma resposta (`null`) para código inexistente e inativo. */
export interface LinkPublico {
  nome_corretor: string
  /** Nulo quando é a Imobiliária Arken (casa). */
  nome_imobiliaria: string | null
}

// ---------- RPCs ----------

/** RPCs de rede que o front chama (grant para `authenticated`; `rede_link_publico` também para `anon`). */
export interface RpcRede {
  /** Escopo do usuário logado. Ver `Escopo` em src/lib/types.ts. */
  meu_escopo: DefRpc<SemArgs, Escopo>
  /** I. Devolve o id. Auditoria operacao/criar. */
  rede_cadastrar_imobiliaria: DefRpc<{ p_dados: ImobiliariaDados }, Uuid>
  /** I. Auditoria operacao/editar (nomes dos campos). */
  rede_editar_imobiliaria: DefRpc<{ p_id: Uuid; p_dados: ImobiliariaEdicao }, void>
  /**
   * Matriz §3.3 + escopo. `p_imobiliaria_id`: obrigatório para interno; parceiro envia a própria (ou nulo, que o
   * servidor completa). `p_gerente_id`: obrigatório para `corretor` (o gerente que cadastra só pode indicar a si).
   * Devolve o id do parceiro.
   * [WP1, WP1R-04] Para parceiros (não internos), CPF que já é de outro parceiro devolve `null` (nada criado; a
   * tentativa fica na auditoria e conta no limite por hora, erro `LIMITE_DUPLICIDADE` acima dele): trate como
   * `DOCUMENTO_INDISPONIVEL`. Internos recebem o erro `DOCUMENTO_INDISPONIVEL`.
   */
  rede_cadastrar_parceiro: DefRpc<{ p_tipo: TipoParceiro; p_dados: ParceiroDados; p_imobiliaria_id: Uuid | null; p_gerente_id: Uuid | null }, Uuid | null>
  /** [WP1R-04] Completar o CPF vazio de outro parceiro é só dos internos. */
  rede_editar_parceiro: DefRpc<{ p_id: Uuid; p_dados: ParceiroEdicao }, void>
  /**
   * O próprio parceiro (tela "Meu cadastro").
   * [WP1R-04] CPF que já é de outro parceiro: nada muda e a chamada termina sem erro (a tentativa fica na auditoria e
   * conta no limite por hora; acima dele, `LIMITE_DUPLICIDADE`). Quem envia `cpf` confere depois se ele ficou gravado.
   */
  rede_atualizar_meu_cadastro: DefRpc<{ p_dados: ParceiroEdicao }, void>
  rede_parceiro_detalhe: DefRpc<{ p_id: Uuid }, ParceiroDetalhe | null>
  /**
   * I. Perfil `parceiro` pendente sem linha em `parceiros` → corretor sob `p_gerente_id` (nulo = Gerência Arken, a casa).
   * Papel → `corretor`, status → `aprovado`. Devolve o id do parceiro criado.
   */
  rede_aprovar_autocadastro: DefRpc<{ p_profile_id: Uuid; p_gerente_id: Uuid | null; p_dados: AprovacaoDados }, Uuid>
  /** I. Status → `bloqueado`. */
  rede_recusar_autocadastro: DefRpc<{ p_profile_id: Uuid; p_motivo: string }, void>
  rede_bloquear_parceiro: DefRpc<{ p_id: Uuid; p_motivo: string }, void>
  rede_desbloquear_parceiro: DefRpc<{ p_id: Uuid }, void>
  rede_pode_convidar: DefRpc<{ p_parceiro_id: Uuid }, PodeConvidar>
  /** Devolve quantos clientes foram transferidos. Motivo ≥ 5 caracteres. */
  rede_transferir_clientes: DefRpc<{ p_cliente_ids: Uuid[]; p_novo_corretor_id: Uuid; p_motivo: string }, number>
  rede_transferir_corretor: DefRpc<{ p_corretor_id: Uuid; p_novo_gerente_id: Uuid; p_motivo: string }, void>
  /**
   * I (o corpo do WP1 restringe ao Super, §2.1 ⚑). PAR-6: a carteira vai antes para `p_destino_carteira_id` (corretor
   * da imobiliária de origem). [WP1] Nulo só quando o corretor não tem cliente ativo.
   */
  rede_mudar_imobiliaria_corretor: DefRpc<{ p_corretor_id: Uuid; p_novo_gerente_id: Uuid; p_destino_carteira_id: Uuid | null; p_motivo: string }, void>
  /** Super. Só `migrado_legado` na casa, uma vez (N3). `p_levar_clientes` sem padrão. */
  rede_regularizar_legado: DefRpc<{ p_corretor_id: Uuid; p_novo_gerente_id: Uuid; p_levar_clientes: boolean }, void>
  /**
   * Corretor: destino = corretor ativo (mesma imobiliária, no escopo) ou o gerente dele. Gerente: destino = gerente da
   * mesma imobiliária. [WP1] Nulo só quando não há nada a mover (sem cliente nem corretor ativo; usuário de imobiliária).
   */
  rede_inativar_parceiro: DefRpc<{ p_id: Uuid; p_destino_id: Uuid | null; p_motivo: string }, void>
  rede_reativar_parceiro: DefRpc<{ p_id: Uuid }, void>
  rede_inativar_imobiliaria: DefRpc<{ p_id: Uuid; p_motivo: string }, void>
  /** Corretor (ou gerente com A1). Invalida o anterior e devolve o novo código. */
  rede_gerar_codigo_indicacao: DefRpc<SemArgs, string>
  rede_link_publico: DefRpc<{ p_codigo: string }, LinkPublico | null>
}

/** RPCs de sistema da rede: **só `service_role`** (Edge `convidar-parceiros`). O front não chama. */
export interface RpcRedeServico {
  /** Vincula o perfil recém-criado pelo convite; papel = `parceiros.tipo`, status `aprovado`. */
  rede_vincular_login: DefRpc<{ p_parceiro_id: Uuid; p_profile_id: Uuid }, void>
  /** Auditoria seguranca/link_gerado (sem o link). */
  rede_registrar_convite: DefRpc<{ p_parceiro_id: Uuid; p_modo: 'email' | 'link'; p_ator: Uuid }, void>
}

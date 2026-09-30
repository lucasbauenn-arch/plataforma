// Contrato do módulo Contratos (WP4): parâmetros e JSON de cada RPC `contrato_*`/`contratos_*`
// (docs/ARQUITETURA_EXPANSAO.md §3.6, §3.8, §4.4 e §6.3–6.5). Contratos não têm grant para `authenticated`:
// tudo passa por RPC com escopo e auditoria.
// Convenções: dinheiro e percentuais saem como número JSON (numeric(14,2) e numeric(7,4) na unidade "%": 8.5 = 8,5%);
// o servidor é a única fonte de verdade da simulação (o front nunca envia valores calculados nem o valor do produto);
// RPC de escrita sem retorno = `returns void`; leitura fora do escopo = `null`.

import type {
  DataHoraISO, DefRpc, DownloadAutorizado, FormaPagamento, ModeloChave, Pagina, PapelSignatario, Ref,
  StatusAssinatura, StatusContrato, TipoContrato, Uuid, FiltroPaginacao,
} from '@/lib/types'
import type { CadeiaCliente } from '@/modulos/crm/tipos'

/** Produto do contrato: exatamente um (N4). É o `p_produto` jsonb de `contrato_simular` e `contrato_criar`. */
export type ProdutoRef = { unidade_id: Uuid; imovel_id?: never } | { imovel_id: Uuid; unidade_id?: never }

/** Produto para exibição. `valor` = valor atual do produto (unidade de tabela ou imóvel), lido no servidor. */
export interface ProdutoResumo {
  tipo: 'unidade' | 'imovel'
  id: Uuid
  /** Unidade: "<empreendimento> · <identificador>"; imóvel: nome. */
  nome: string
  /** Só imóvel: `imoveis.codigo` (exibido como #0000007). */
  codigo: number | null
  empreendimento: Ref | null
  valor: number | null
}

/** Limites vigentes de `parametros_simulacao`. */
export interface LimitesSimulacao {
  parcela_minima: number
  parcela_maxima: number
  valor_minimo: number | null
  /** Nulo = plano flexível bloqueado (N14). */
  valor_minimo_flex: number | null
}

/**
 * `contrato_simular` (não grava). Cálculo FIN-1/FIN-2 de `calcular_simulacao()` (§3.6):
 * `valor_aporte = round(valor × perc/100, 2)`; `base_parcelada = valor_aporte − entrada`;
 * `valor_parcela = round(base / n × (1 + taxa/100), 2)`; `valor_total_parcelas = round(base × (1 + taxa/100), 2)`;
 * `residuo = valor_total_parcelas − valor_parcela × n`; `valor_restante = valor − valor_aporte` (informativo, N17).
 * Campos do parcelado vêm nulos no flexível. Fora dos limites: erro `SIMULACAO_INVALIDA` (detalhe com os motivos).
 */
export interface SimulacaoResultado {
  forma: FormaPagamento
  produto: ProdutoResumo
  parametros_id: Uuid
  valor_imovel: number
  perc_aporte: number
  valor_aporte: number
  valor_entrada: number
  base_parcelada: number
  valor_restante: number
  n_parcelas: number | null
  taxa_aporte: number | null
  valor_parcela: number | null
  valor_total_parcelas: number | null
  residuo: number | null
  valor_minimo_flex: number | null
  limites: LimitesSimulacao
}

/** Motivos em `detalhe.motivos` do erro `SIMULACAO_INVALIDA`. */
export type MotivoSimulacaoInvalida =
  | 'n_parcelas_fora_do_limite' | 'entrada_maior_que_aporte' | 'entrada_invalida' | 'valor_abaixo_do_minimo'
  | 'flexivel_sem_minimo' | 'percentual_invalido' | 'produto_sem_valor' | 'forma_invalida'

/** `p_filtros` de `contratos_listar`. */
export interface ContratosFiltros extends FiltroPaginacao {
  status?: StatusContrato[] | null
  cliente_id?: Uuid | null
  /** Produto do contrato (o servidor cruza com o escopo de quem consulta: imóvel de outra cadeia devolve lista vazia). */
  imovel_id?: Uuid | null
  unidade_id?: Uuid | null
  forma?: FormaPagamento | null
  /** Código ("#123" ou "123") ou nome do cliente/produto (não vai para a auditoria). */
  busca?: string | null
  corretor_id?: Uuid | null
}

/** Item de `contratos_listar`. */
export interface ContratoResumo extends CadeiaCliente {
  id: Uuid
  /** Exibido como #0000123. */
  codigo: number
  cliente: Ref
  status: StatusContrato
  forma_pagamento: FormaPagamento
  produto: ProdutoResumo
  valor_imovel: number
  n_parcelas: number | null
  valor_parcela: number | null
  pdf_desatualizado: boolean
  criado_em: DataHoraISO
  enviado_assinatura_em: DataHoraISO | null
  assinado_em: DataHoraISO | null
}

/** Nomes das validações de envio para assinatura (lista fechada da §3.8). */
export type BloqueioEnvio =
  | 'pdf_gerado' | 'modelo_liberado' | 'signatarios_configurados' | 'vendedora_configurada' | 'email_cliente' | 'valor_produto_atual'

export interface ContratoSignatario {
  id: Uuid
  ordem: number
  papel: PapelSignatario
  nome: string
  email: string
  ato: 'assinar' | 'testemunhar'
  status: StatusAssinatura
  assinado_em: DataHoraISO | null
  recusado_em: DataHoraISO | null
  motivo: string | null
}

/** Destino de status que quem consulta pode acionar manualmente (linhas de `status_transicoes`). */
export interface DestinoStatusContrato {
  para: StatusContrato
  exige_motivo: boolean
  validacoes: string[]
  efeitos: string[]
}

export interface PermissoesContrato {
  /** Em `rascunho`, `criar_contrato` + escopo. */
  editar_simulacao: boolean
  /** Em `rascunho`, `documentacao_pendente` ou `em_analise` (Edge `contrato-gerar`). */
  gerar_pdf: boolean
  /** P+I: `rascunho`/`documentacao_pendente` → `em_analise`. */
  enviar_analise: boolean
  /** I, em `em_analise` (Edge `contrato-assinatura`). */
  enviar_assinatura: boolean
  /** I, em `assinatura_pendente`. */
  cancelar_envio: boolean
  /** I, em `assinatura_pendente`: reconsulta o D4Sign. */
  atualizar_assinatura: boolean
  /** I; nunca `assinado`. */
  arquivar: boolean
  baixar_minuta: boolean
  baixar_assinado: boolean
}

/** `contrato_detalhe(p_id)`: registra `acesso/consultar`. `null` fora do escopo. */
export interface ContratoDetalhe {
  id: Uuid
  codigo: number
  tipo: TipoContrato
  status: StatusContrato
  forma_pagamento: FormaPagamento
  cliente: Ref & { email_presente: boolean }
  produto: ProdutoResumo
  modelo: { id: Uuid; chave: ModeloChave; versao: number; titulo: string; revisado_juridico: boolean; liberado_para_envio: boolean }
  cadeia: CadeiaCliente
  parametros_id: Uuid
  valor_imovel: number
  perc_aporte: number
  valor_aporte: number
  valor_entrada: number
  base_parcelada: number
  valor_restante: number
  n_parcelas: number | null
  taxa_aporte: number | null
  valor_parcela: number | null
  valor_total_parcelas: number | null
  valor_minimo_flex: number | null
  /** Valor atual do produto difere de `valor_imovel` (bloqueia o envio: `valor_produto_atual`). */
  valor_produto_alterado: boolean
  /**
   * Minuta atual. `versao` = número do arquivo atual (0 = sem PDF); `versoes` = números das minutas guardadas no bucket,
   * da mais nova para a mais antiga (inclui a atual). Os números podem pular: mudar a simulação avança a versão esperada
   * do próximo PDF, para que um PDF montado com os dados antigos não seja registrado (WP4R-04).
   */
  pdf: { versao: number; gerado_em: DataHoraISO | null; desatualizado: boolean; disponivel: boolean; versoes: number[] }
  pdf_assinado_disponivel: boolean
  d4sign_enviado: boolean
  /** `envio_lock_em` com menos de 15 min. */
  envio_em_andamento: boolean
  signatarios: ContratoSignatario[]
  /** Validações que hoje impedem o envio para assinatura (vazio = pode enviar). Calculado para todos; só I envia. */
  bloqueios_envio: BloqueioEnvio[]
  destinos_status: DestinoStatusContrato[]
  permissoes: PermissoesContrato
  observacao: string | null
  criado_em: DataHoraISO
  criado_por: Ref | null
  enviado_assinatura_em: DataHoraISO | null
  enviado_por: Ref | null
  assinado_em: DataHoraISO | null
  encerrado_em: DataHoraISO | null
}

/** Variáveis permitidas nos modelos (§6.3): as da doc + as acrescentadas ⚑. */
export type VariavelModelo =
  | 'codigo' | 'nome' | 'sobrenome' | 'cpf-cnpj' | 'logradouro' | 'numero' | 'bairro' | 'cidade' | 'estado' | 'cep'
  | 'valor-propriedade' | 'valor-parcela'
  | 'data' | 'rg' | 'estado-civil' | 'nacionalidade' | 'complemento' | 'produto' | 'produto-matricula'
  | 'percentual-aporte' | 'valor-aporte' | 'valor-entrada' | 'base-parcelada' | 'numero-parcelas' | 'taxa-aporte'
  | 'valor-minimo-flex' | 'corretor-nome' | 'corretor-creci' | 'imobiliaria-nome'
  | 'vendedora-razao-social' | 'vendedora-cnpj' | 'vendedora-endereco'

/**
 * `contrato_dados_modelo(p_id)` (status `rascunho`, `documentacao_pendente` ou `em_analise`; auditoria operacao/gerar).
 * `variaveis` traz **todas** as chaves de `VariavelModelo`, com o valor cru ou nulo: dinheiro e percentuais como número,
 * CPF/CNPJ e CEP só dígitos, `data` = hoje (America/Sao_Paulo) em `YYYY-MM-DD`, `estado-civil` = valor do enum,
 * `codigo` = número. A formatação é do `renderizarModelo()` em `_shared/modelo-contrato.ts`.
 */
export interface ContratoDadosModelo {
  modelo: { id: Uuid; chave: ModeloChave; versao: number; titulo: string; conteudo: string }
  variaveis: Record<VariavelModelo, string | number | null>
  codigo: number
  pdf_versao: number
}

/** RPCs de contratos que o front chama (grant para `authenticated`). */
export interface RpcContratos {
  contrato_simular: DefRpc<{ p_forma: FormaPagamento; p_produto: ProdutoRef; p_perc_aporte: number; p_entrada: number; p_n_parcelas: number | null }, SimulacaoResultado>
  /** Recalcula tudo no servidor e devolve o id. */
  contrato_criar: DefRpc<{ p_cliente_id: Uuid; p_forma: FormaPagamento; p_produto: ProdutoRef; p_perc_aporte: number; p_entrada: number; p_n_parcelas: number | null }, Uuid>
  /** Só em `rascunho`; relê o valor do produto. */
  contrato_atualizar_simulacao: DefRpc<{ p_id: Uuid; p_forma: FormaPagamento; p_perc_aporte: number; p_entrada: number; p_n_parcelas: number | null }, void>
  contrato_mudar_status: DefRpc<{ p_id: Uuid; p_para: StatusContrato; p_motivo: string | null }, void>
  /** Também usada pela Edge `contrato-gerar` com o JWT do usuário. */
  contrato_dados_modelo: DefRpc<{ p_id: Uuid }, ContratoDadosModelo>
  contratos_listar: DefRpc<{ p_filtros: ContratosFiltros }, Pagina<ContratoResumo>>
  contrato_detalhe: DefRpc<{ p_id: Uuid }, ContratoDetalhe | null>
  /** `p_tipo = 'minuta'` com `p_versao` (nulo = a atual) ou `'assinado'` (`p_versao` ignorado). */
  contrato_baixar: DefRpc<{ p_id: Uuid; p_tipo: 'minuta' | 'assinado'; p_versao: number | null }, DownloadAutorizado>
}

// ---------- chamadas das Edge Functions (não usar no front) ----------

/** Signatário resolvido pelas regras de `contrato_signatario_regras` (D3). */
export interface SignatarioResolvido {
  ordem: number
  papel: PapelSignatario
  nome: string
  email: string
  ato: 'assinar' | 'testemunhar'
}

/** `contrato_preparar_envio`: valida, trava `envio_lock_em` (15 min) e resolve os signatários. */
export interface PreparoEnvio {
  contrato_id: Uuid
  codigo: number
  pdf_path: string
  pdf_sha256: string
  /** Reaproveitado num reenvio depois de falha. */
  d4sign_uuid: string | null
  signatarios: SignatarioResolvido[]
  /** [WP4, aditivo] sha256 do texto que gerou a minuta: a Edge confere se o texto com os dados atuais ainda é o mesmo. */
  texto_sha256: string
  /** [WP4, aditivo] Quando a minuta foi gerada (a data do texto, `{{data}}`, é a desse dia em Brasília). */
  pdf_gerado_em: DataHoraISO
}

/** Signatário devolvido pelo D4Sign, em `p_signatarios` de `contrato_registrar_envio`. */
export interface SignatarioEnviado extends SignatarioResolvido {
  d4sign_chave: string
}

/** Situação de um signatário em `p_signatarios` de `contrato_registrar_retorno`. */
export interface SignatarioRetorno {
  email: string
  status: StatusAssinatura
  assinado_em: DataHoraISO | null
  recusado_em: DataHoraISO | null
  motivo: string | null
}

/** Status do documento no D4Sign já mapeado para o nosso vocabulário. */
export type StatusRetornoD4sign = 'assinatura_pendente' | 'assinado' | 'recusado' | 'expirado' | 'cancelado'

/** Chamadas com o JWT de um interno, feitas só pela Edge `contrato-assinatura` (efeito colateral: trava o envio). */
export interface RpcContratosEdgeUsuario {
  contrato_preparar_envio: DefRpc<{ p_id: Uuid }, PreparoEnvio>
}

/** RPCs de sistema: **só `service_role`** (Edges `contrato-gerar`, `contrato-assinatura`, `d4sign-webhook`, `d4sign-reconciliar`). */
export interface RpcContratosServico {
  /** Concorrência: falha se `p_versao` não for `pdf_versao + 1` (erro `CONFLITO_VERSAO`). */
  contrato_registrar_documento: DefRpc<{ p_id: Uuid; p_versao: number; p_path: string; p_sha256: string; p_texto_sha256: string }, void>
  contrato_registrar_d4sign_uuid: DefRpc<{ p_id: Uuid; p_uuid: string }, void>
  /**
   * NOVA (WP4R-01, migration 13): logo antes do disparo no D4Sign, reconfere com a linha travada que o envio ainda vale
   * (em análise, trava de 15 min valendo, `p_uuid` = documento registrado, validações do envio). Não grava nada.
   */
  contrato_confirmar_envio: DefRpc<{ p_id: Uuid; p_uuid: string }, void>
  contrato_registrar_envio: DefRpc<{ p_id: Uuid; p_signatarios: SignatarioEnviado[]; p_webhook_token_hash: string }, void>
  contrato_falha_envio: DefRpc<{ p_id: Uuid; p_erro: string }, void>
  /** Idempotente: estado igual não faz nada; `assinado` seguido de `recusado` é ignorado. */
  contrato_registrar_retorno: DefRpc<{ p_d4sign_uuid: string; p_status: StatusRetornoD4sign; p_signatarios: SignatarioRetorno[]; p_pdf_assinado_path: string | null; p_sha256: string | null }, void>
}

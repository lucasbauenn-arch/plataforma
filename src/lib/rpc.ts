// Chamadas tipadas às RPCs `security definer` (docs/ARQUITETURA_EXPANSAO.md §4.4). Cada wrapper recebe um objeto com
// os NOMES EXATOS dos parâmetros SQL (`p_…`), todos obrigatórios (nulo quando não se aplica: o PostgREST só acha a
// função com o conjunto completo de parâmetros), e devolve o formato definido em src/modulos/<modulo>/tipos.ts.
// Erros saem traduzidos (`ErroRpc`, src/lib/erros.ts).
//
// Ficam de fora, de propósito:
// - RPCs de sistema (só `service_role`): `crm_pre_cadastro`, `rede_vincular_login`, `rede_registrar_convite`,
//   `contrato_registrar_*`, `contrato_falha_envio`, `portal_localizar_cliente`;
// - RPCs que só as Edge Functions chamam com o JWT do usuário, porque têm efeito que a Edge completa:
//   `contrato_preparar_envio` (trava o envio → Edge `contrato-assinatura`) e `lgpd_anonimizar_cliente`
//   (→ Edge `lgpd-anonimizar`, que apaga os arquivos e o usuário do portal);
// - tarefas do pg_cron: `notificacoes_reenviar`, `auditoria_purgar`, `limpar_temporarios`.

import { supabase } from './supabase'
import { ErroRpc, mensagemErroEdge, traduzirErro, type CodigoErro } from './erros'
import type { DownloadAutorizado } from './types'
import type { RpcRede } from '@/modulos/rede/tipos'
import type { RpcCrm } from '@/modulos/crm/tipos'
import type { RpcContratos } from '@/modulos/contratos/tipos'
import type { RpcImoveis } from '@/modulos/imoveis/tipos'
import type { RpcGovernanca } from '@/modulos/governanca/tipos'
import type { RpcPortal } from '@/modulos/portal/tipos'
import type { RpcConfig } from '@/modulos/config/tipos'

export type Rpcs = RpcRede & RpcCrm & RpcContratos & RpcImoveis & RpcGovernanca & RpcPortal & RpcConfig
export type NomeRpc = keyof Rpcs
export type ArgsRpc<N extends NomeRpc> = Rpcs[N]['args']
export type RetornoRpc<N extends NomeRpc> = Rpcs[N]['retorno']

/** Chama uma RPC por POST. Lança `ErroRpc` com a mensagem em pt-BR. */
export async function chamarRpc<N extends NomeRpc>(nome: N, args: ArgsRpc<N>): Promise<RetornoRpc<N>> {
  let resposta
  try {
    resposta = await supabase.rpc(nome, args as Record<string, unknown>)
  } catch (e) {
    throw traduzirErro(e, nome)
  }
  if (resposta.error) throw traduzirErro(resposta.error, nome)
  return (resposta.data ?? null) as RetornoRpc<N>
}

const rpc = <N extends NomeRpc>(nome: N) => (args: ArgsRpc<N>) => chamarRpc(nome, args)
const rpcSemArgs = <N extends NomeRpc>(nome: N) => () => chamarRpc(nome, {} as ArgsRpc<N>)

/** Edge Function que troca a autorização de download por uma URL assinada (supabase/functions/baixar-arquivo). */
export const EDGE_DOWNLOAD = 'baixar-arquivo'

/**
 * URL assinada de um download autorizado por `crm_documento_baixar`, `contrato_baixar` ou `portal_contrato_baixar`.
 * Chame logo depois da RPC, com o objeto que ela devolveu. Quem assina é a Edge `baixar-arquivo` (service role), e a
 * URL vale só até `expira_em` da autorização: `crm-documentos` e `contratos` não têm política de SELECT para
 * `authenticated`, então `supabase.storage…createSignedUrl` direto no navegador sempre falha (§4.3).
 */
export async function urlDoDownload(a: DownloadAutorizado): Promise<string> {
  let resposta
  try {
    resposta = await supabase.functions.invoke<{ url?: unknown }>(EDGE_DOWNLOAD, { body: { bucket: a.bucket, path: a.path } })
  } catch (e) {
    throw traduzirErro(e, EDGE_DOWNLOAD)
  }
  const { data, error } = resposta
  if (error) {
    const status = (error as { context?: { status?: unknown } }).context?.status
    const codigo: CodigoErro = status === 401 ? 'SESSAO_EXPIRADA' : status === 403 || status === 404 ? 'SEM_ACESSO' : 'DESCONHECIDO'
    throw new ErroRpc(codigo, await mensagemErroEdge(error), { rpc: EDGE_DOWNLOAD })
  }
  if (!data || typeof data.url !== 'string' || !data.url) {
    throw new ErroRpc('DESCONHECIDO', 'Não foi possível gerar o link de download. Tente de novo.', { rpc: EDGE_DOWNLOAD })
  }
  return data.url
}

// ---------- rede [WP0/WP1] ----------
export const meuEscopo = rpcSemArgs('meu_escopo')
export const redeCadastrarImobiliaria = rpc('rede_cadastrar_imobiliaria')
export const redeEditarImobiliaria = rpc('rede_editar_imobiliaria')
export const redeCadastrarParceiro = rpc('rede_cadastrar_parceiro')
export const redeEditarParceiro = rpc('rede_editar_parceiro')
export const redeAtualizarMeuCadastro = rpc('rede_atualizar_meu_cadastro')
export const redeParceiroDetalhe = rpc('rede_parceiro_detalhe')
export const redeAprovarAutocadastro = rpc('rede_aprovar_autocadastro')
export const redeRecusarAutocadastro = rpc('rede_recusar_autocadastro')
export const redeBloquearParceiro = rpc('rede_bloquear_parceiro')
export const redeDesbloquearParceiro = rpc('rede_desbloquear_parceiro')
export const redePodeConvidar = rpc('rede_pode_convidar')
export const redeTransferirClientes = rpc('rede_transferir_clientes')
export const redeTransferirCorretor = rpc('rede_transferir_corretor')
export const redeMudarImobiliariaCorretor = rpc('rede_mudar_imobiliaria_corretor')
export const redeRegularizarLegado = rpc('rede_regularizar_legado')
export const redeInativarParceiro = rpc('rede_inativar_parceiro')
export const redeReativarParceiro = rpc('rede_reativar_parceiro')
export const redeInativarImobiliaria = rpc('rede_inativar_imobiliaria')
export const redeGerarCodigoIndicacao = rpcSemArgs('rede_gerar_codigo_indicacao')
export const redeLinkPublico = rpc('rede_link_publico')

// ---------- CRM: cadastro, ficha, leads, propostas [WP2] ----------
export const crmCadastrarCliente = rpc('crm_cadastrar_cliente')
export const crmEditarCliente = rpc('crm_editar_cliente')
export const crmListar = rpc('crm_listar')
export const crmClientesOpcoes = rpc('crm_clientes_opcoes')
export const crmFicha = rpc('crm_ficha')
export const crmInativarCliente = rpc('crm_inativar_cliente')
export const crmLiberarPortal = rpc('crm_liberar_portal')
export const crmDuplicidadesListar = rpc('crm_duplicidades_listar')
export const crmDuplicidadeResolver = rpc('crm_duplicidade_resolver')
export const leadsListar = rpc('leads_listar')
export const leadsConverter = rpc('leads_converter')
export const leadsDescartar = rpc('leads_descartar')
export const leadsExcluir = rpc('leads_excluir')
export const leadsExportar = rpc('leads_exportar')
export const propostasListar = rpc('propostas_listar')
export const propostasCriar = rpc('propostas_criar')
export const propostasResponder = rpc('propostas_responder')

// ---------- CRM: funil e atividades [WP3] ----------
export const crmKanban = rpc('crm_kanban')
export const crmKanbanColuna = rpc('crm_kanban_coluna')
export const crmMudarEtapa = rpc('crm_mudar_etapa')
export const crmTimeline = rpc('crm_timeline')
export const crmNotas = rpc('crm_notas')
export const crmTarefas = rpc('crm_tarefas')
export const crmDocumentos = rpc('crm_documentos')
export const crmNotaCriar = rpc('crm_nota_criar')
export const crmTarefaCriar = rpc('crm_tarefa_criar')
export const crmTarefaEditar = rpc('crm_tarefa_editar')
export const crmTarefaConcluir = rpc('crm_tarefa_concluir')
export const crmResponsaveis = rpc('crm_responsaveis')
export const crmMinhasTarefas = rpc('crm_minhas_tarefas')
export const crmDocumentoSolicitar = rpc('crm_documento_solicitar')
export const crmDocumentoCancelar = rpc('crm_documento_cancelar')
export const crmDocumentoRegistrarEnvio = rpc('crm_documento_registrar_envio')
export const crmDocumentoAnalisar = rpc('crm_documento_analisar')
export const crmDocumentoBaixar = rpc('crm_documento_baixar')

// ---------- contratos [WP4] ----------
export const contratoSimular = rpc('contrato_simular')
export const contratoCriar = rpc('contrato_criar')
export const contratoAtualizarSimulacao = rpc('contrato_atualizar_simulacao')
export const contratoMudarStatus = rpc('contrato_mudar_status')
export const contratoDadosModelo = rpc('contrato_dados_modelo')
export const contratosListar = rpc('contratos_listar')
export const contratoDetalhe = rpc('contrato_detalhe')
export const contratoBaixar = rpc('contrato_baixar')

// ---------- imóveis [WP5] ----------
export const imovelMudarStatus = rpc('imovel_mudar_status')
export const imovelFotoRegistrar = rpc('imovel_foto_registrar')
export const imovelFotoRemover = rpc('imovel_foto_remover')
export const imovelFotosOrdenar = rpc('imovel_fotos_ordenar')
export const imovelInativar = rpc('imovel_inativar')

// ---------- governança, LGPD, painel [WP6/WP7] ----------
export const auditoriaConsultar = rpc('auditoria_consultar')
export const lgpdTermoVigente = rpc('lgpd_termo_vigente')
export const lgpdPublicarTermo = rpc('lgpd_publicar_termo')
export const lgpdAceitarTermo = rpc('lgpd_aceitar_termo')
export const lgpdRevogarConsentimento = rpc('lgpd_revogar_consentimento')
export const painelResumo = rpcSemArgs('painel_resumo')
export const migracaoPendenciasResolver = rpc('migracao_pendencias_resolver')

// ---------- portal do cliente [WP6] ----------
export const portalMeusDados = rpcSemArgs('portal_meus_dados')
export const portalMeuCorretor = rpcSemArgs('portal_meu_corretor')
export const portalDocumentos = rpcSemArgs('portal_documentos')
export const portalContratos = rpcSemArgs('portal_contratos')
export const portalContratoBaixar = rpc('portal_contrato_baixar')
export const portalLinhaDoTempo = rpcSemArgs('portal_linha_do_tempo')
export const portalSolicitacoes = rpcSemArgs('portal_solicitacoes')
export const portalSolicitar = rpc('portal_solicitar')
// equipe (só internos): marcos da compra e fila de solicitações do portal
export const crmPortalMarcos = rpc('crm_portal_marcos')
export const crmPortalMarcoSalvar = rpc('crm_portal_marco_salvar')
export const crmPortalSolicitacoes = rpc('crm_portal_solicitacoes')
export const crmPortalSolicitacaoAtualizar = rpc('crm_portal_solicitacao_atualizar')

// ---------- configurações (Super) [WP4/WP6] ----------
export const configAtualizar = rpc('config_atualizar')
export const configPublicarParametros = rpc('config_publicar_parametros')
export const configPublicarModelo = rpc('config_publicar_modelo')
export const configLiberarModelo = rpc('config_liberar_modelo')
export const equipeDefinirPapel = rpc('equipe_definir_papel')

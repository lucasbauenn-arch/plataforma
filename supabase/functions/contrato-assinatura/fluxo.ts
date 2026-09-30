// Fluxo da Edge Function contrato-assinatura (docs/ARQUITETURA_EXPANSAO.md §6.4), sem Deno nem npm: o index.ts só
// liga as portas (Supabase com o JWT do usuário e com a service role, Storage, segredos do D4Sign). Testado no Vitest
// com dublês em _shared/d4sign.fluxos.test.ts (WP4R-09).
//
// Só internos: a permissão é SEMPRE das RPCs chamadas com o JWT de quem pediu (contrato_preparar_envio exige is_admin,
// com MFA quando exigida; contrato_detalhe devolve as permissões da tela; contrato_mudar_status confere a tabela de
// transições). A service role só lê a situação do contrato, baixa/grava arquivos no bucket contratos, registra
// integracao_chamadas e chama as RPCs de sistema contrato_registrar_*, contrato_confirmar_envio e contrato_falha_envio.
//
// POST { acao: "enviar", contrato_id }
// POST { acao: "cancelar", contrato_id, motivo }   — cancela no D4Sign ANTES e só então muda o status (R1-03)
// POST { acao: "atualizar", contrato_id }          — reconsulta o documento e os signatários
import { lerJson, mensagemSegura, type Respostas } from "../_shared/http.ts";
import { sha256Hex } from "../_shared/chaves.ts";
import { renderizarModelo, type ValorVariavel } from "../_shared/modelo-contrato.ts";
import {
  type ArgsRetorno, type ChamarRpc, diaEmBrasilia, enviarParaAssinatura, erroDaRpc, type ErroPostgrest,
  erroLimpo, ErroRpcSistema, exigirRpc, type FabricaD4sign, linhaChamada, type LinhaChamada, nomeDocumento, prazoAssinatura,
  reconsultarDocumento, type RegistrarChamada, type SignatarioResolvido,
} from "../_shared/d4sign.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Operação da prova de cancelamento que contrato_mudar_status exige (só esta Edge grava, e só depois do D4Sign). */
export const OPERACAO_PROVA_CANCELAMENTO = "cancelar_confirmado";

export interface PortasAssinatura {
  /** Valida o JWT no Auth; devolve as RPCs com o JWT do usuário ou a resposta de erro pronta (401/503). */
  autenticar(req: Request, r: Respostas): Promise<{ rpc: ChamarRpc } | Response>;
  /** RPCs de sistema (service role). */
  sistema: ChamarRpc;
  d4sign: FabricaD4sign;
  /** Insere em integracao_chamadas (service role). Lança se não gravar. */
  gravarChamada(linha: LinhaChamada): Promise<void>;
  /** Baixa a minuta do bucket contratos. */
  baixarMinuta(caminho: string): Promise<Uint8Array>;
  /** Grava o PDF assinado no bucket contratos (mesmo caminho = mesmo conteúdo: "já existe" não é erro). */
  salvarPdfAssinado(caminho: string, pdf: Uint8Array): Promise<void>;
  /** configuracao_geral.prazo_assinatura_dias. */
  prazoAssinaturaDias(): Promise<number | null>;
  /** Situação do contrato lida pela service role. */
  situacao(id: string): Promise<{ status: string; d4sign_uuid: string | null } | null>;
  /** URL do webhook com o token (…/functions/v1/d4sign-webhook?t=<token>). */
  urlWebhook(token: string): string;
  gerarToken?: () => string;
  /** Log sem segredo (a mensagem já passa por mensagemSegura). */
  log(mensagem: string): void;
}

interface Preparo {
  contrato_id: string;
  codigo: number;
  pdf_path: string;
  pdf_sha256: string;
  texto_sha256: string;
  pdf_gerado_em: string;
  d4sign_uuid: string | null;
  signatarios: SignatarioResolvido[];
}

interface Detalhe {
  status: string;
  permissoes: { cancelar_envio: boolean; atualizar_assinatura: boolean };
}

const respostaRpc = (r: Respostas, e: ErroPostgrest) => {
  const x = erroDaRpc(e);
  return r.erro(x.status, x.mensagem, { codigo: "rpc", detalhes: x.detalhes });
};

export async function tratarAssinatura(req: Request, r: Respostas, portas: PortasAssinatura): Promise<Response> {
  const quem = await portas.autenticar(req, r);
  if (quem instanceof Response) return quem;

  const corpo = await lerJson(req);
  if (!corpo.ok) return r.erro(corpo.status, corpo.erro, { codigo: corpo.codigo });
  const acao = corpo.valor.acao;
  const id = typeof corpo.valor.contrato_id === "string" ? corpo.valor.contrato_id.toLowerCase() : "";
  if (!UUID.test(id) || (acao !== "enviar" && acao !== "cancelar" && acao !== "atualizar")) {
    return r.erro(422, "Pedido inválido.");
  }
  const motivo = typeof corpo.valor.motivo === "string" ? corpo.valor.motivo.trim() : "";
  if (acao === "cancelar" && (motivo.length < 3 || motivo.length > 2000)) {
    return r.erro(422, "Informe o motivo do cancelamento (mínimo de 3 caracteres).");
  }

  // registro genérico de cada chamada ao D4Sign (nunca derruba a operação; nunca é prova de nada)
  const registrarChamada: RegistrarChamada = async (c) => {
    try {
      await portas.gravarChamada(linhaChamada(c, id));
    } catch (e) {
      portas.log(`integracao_chamadas: ${mensagemSegura(e)}`);
    }
  };

  if (acao === "enviar") return await enviar(id, quem.rpc, r, portas, registrarChamada);

  // ---------- cancelar e atualizar: permissão pela tela do contrato (JWT) ----------
  const det = await quem.rpc("contrato_detalhe", { p_id: id });
  if (det.error) return respostaRpc(r, det.error);
  const detalhe = det.data as Detalhe | null;
  if (!detalhe) return r.erro(403, "Você não tem acesso a este registro.", { codigo: "sem_acesso" });
  const pode = acao === "cancelar" ? detalhe.permissoes.cancelar_envio : detalhe.permissoes.atualizar_assinatura;
  if (!pode) return r.erro(403, "Esta ação não está disponível para este contrato.", { codigo: "sem_permissao" });
  if (!portas.d4sign.ok) {
    portas.log(`configuração do D4Sign: ${portas.d4sign.erro}`);
    return r.erro(503, "A assinatura digital ainda não está configurada. Fale com a equipe técnica.", { codigo: "d4sign_nao_configurado" });
  }
  const uuid = (await portas.situacao(id))?.d4sign_uuid ?? null;
  if (!uuid) return r.erro(409, "Este contrato não tem documento no D4Sign.", { codigo: "sem_documento" });

  const api = portas.d4sign.criar(registrarChamada);
  const portasRetorno = {
    api,
    salvarPdfAssinado: portas.salvarPdfAssinado,
    async registrarRetorno(args: ArgsRetorno) {
      await exigirRpc(portas.sistema, "contrato_registrar_retorno", { ...args });
    },
  };

  if (acao === "atualizar") {
    try {
      const status = await reconsultarDocumento(portasRetorno, id, uuid);
      return r.json({ ok: true, status });
    } catch (e) {
      portas.log(`atualizar: ${mensagemSegura(e)}`);
      return r.erro(502, "Não foi possível consultar o D4Sign agora. Tente de novo em instantes.", { codigo: "falha_consulta" });
    }
  }

  // cancelar: primeiro no D4Sign; a prova só é gravada depois de o D4Sign CONFIRMAR (documento com status 6)
  try {
    let doc = await api.documento(uuid);
    if (doc.statusId === "4") {
      await reconsultarDocumento(portasRetorno, id, uuid);
      return r.erro(409, "Todos já assinaram este contrato no D4Sign; ele não pode mais ser cancelado.", { codigo: "ja_assinado" });
    }
    const inicio = Date.now();
    if (doc.statusId !== "6") {
      await api.cancelar(uuid, "Envio cancelado pela Arken Incorporadora.", "cancelar");
      doc = await api.documento(uuid);
    }
    if (doc.statusId !== "6") {
      return r.erro(502, "O D4Sign ainda não confirmou o cancelamento. Nada foi alterado; tente de novo em instantes.", {
        codigo: "cancelamento_nao_confirmado",
      });
    }
    await portas.gravarChamada(
      linhaChamada({ operacao: OPERACAO_PROVA_CANCELAMENTO, http_status: 200, duracao_ms: Date.now() - inicio, erro: null }, id),
    );
  } catch (e) {
    portas.log(`cancelar: ${mensagemSegura(e)}`);
    return r.erro(502, "Não foi possível cancelar no D4Sign agora. Nada foi alterado; tente de novo.", { codigo: "falha_cancelamento" });
  }
  const mudanca = await quem.rpc("contrato_mudar_status", { p_id: id, p_para: "cancelado", p_motivo: motivo });
  if (mudanca.error) return respostaRpc(r, mudanca.error);
  return r.json({ ok: true, status: "cancelado" });
}

async function enviar(id: string, rpc: ChamarRpc, r: Respostas, portas: PortasAssinatura, registrarChamada: RegistrarChamada): Promise<Response> {
  // trava de 15 min, validações e signatários: com o JWT do interno
  const prep = await rpc("contrato_preparar_envio", { p_id: id });
  if (prep.error) return respostaRpc(r, prep.error);
  const p = prep.data as Preparo;

  // qualquer desistência daqui em diante libera a trava (o contrato continua em análise) e registra o motivo
  const falhar = async (motivo: string, resposta: Response) => {
    const { error } = await portas.sistema("contrato_falha_envio", { p_id: id, p_erro: erroLimpo(motivo, 1000) });
    if (error) portas.log(`contrato_falha_envio: ${mensagemSegura(error.message)}`);
    return resposta;
  };
  if (!portas.d4sign.ok) {
    portas.log(`configuração do D4Sign: ${portas.d4sign.erro}`);
    return await falhar(`configuração: ${portas.d4sign.erro}`,
      r.erro(503, "A assinatura digital ainda não está configurada. Fale com a equipe técnica.", { codigo: "d4sign_nao_configurado" }));
  }

  try {
    // o PDF gerado ainda corresponde aos dados atuais? (cliente, corretor, vendedora podem ter mudado depois)
    const dm = await rpc("contrato_dados_modelo", { p_id: id });
    if (dm.error) return await falhar(`dados do modelo: ${dm.error.code}`, respostaRpc(r, dm.error));
    const dados = dm.data as { modelo: { conteudo: string }; variaveis: Record<string, ValorVariavel> };
    const render = renderizarModelo(dados.modelo.conteudo, { ...dados.variaveis, data: diaEmBrasilia(p.pdf_gerado_em) });
    if (!render.ok || (await sha256Hex(render.texto)) !== p.texto_sha256) {
      return await falhar("texto desatualizado", r.erro(409,
        "Os dados do contrato mudaram depois que o PDF foi gerado. Gere o PDF de novo antes de enviar.", { codigo: "pdf_desatualizado" }));
    }
    const pdf = await portas.baixarMinuta(p.pdf_path);
    if ((await sha256Hex(pdf)) !== p.pdf_sha256) {
      return await falhar("minuta com hash diferente",
        r.erro(409, "O arquivo do PDF não confere com o registrado. Gere o PDF de novo.", { codigo: "pdf_divergente" }));
    }
    const prazo = prazoAssinatura(await portas.prazoAssinaturaDias());
    const numero = String(p.codigo).padStart(7, "0");
    await enviarParaAssinatura({
      api: portas.d4sign.criar(registrarChamada),
      async registrarUuid(uuid) {
        await exigirRpc(portas.sistema, "contrato_registrar_d4sign_uuid", { p_id: id, p_uuid: uuid });
      },
      async confirmarEnvio(uuid) {
        await exigirRpc(portas.sistema, "contrato_confirmar_envio", { p_id: id, p_uuid: uuid });
      },
      async registrarEnvio(signatarios, hash, uuid) {
        const { error } = await portas.sistema("contrato_registrar_envio", { p_id: id, p_signatarios: signatarios, p_webhook_token_hash: hash });
        if (!error) return;
        // a resposta pode ter se perdido depois de o banco gravar: com o contrato já em assinatura com este documento,
        // o envio está registrado (e não pode ser cancelado no D4Sign)
        const agora = await portas.situacao(id).catch(() => null);
        if (agora?.status === "assinatura_pendente" && agora.d4sign_uuid === uuid) return;
        throw new ErroRpcSistema("contrato_registrar_envio", error);
      },
      urlWebhook: portas.urlWebhook,
      gerarToken: portas.gerarToken,
    }, {
      nome: nomeDocumento(p.codigo, p.pdf_path),
      pdf,
      d4signUuid: p.d4sign_uuid,
      signatarios: p.signatarios,
      mensagem: `Contrato nº ${numero} da Arken Incorporadora para assinatura eletrônica.`,
      prazo,
    });
    return r.json({ ok: true, status: "assinatura_pendente" });
  } catch (e) {
    portas.log(`envio: ${mensagemSegura(e)}`);
    if (e instanceof ErroRpcSistema && e.rpc === "contrato_confirmar_envio") {
      // o contrato mudou durante o envio (valor do produto, signatários, modelo…): nada saiu para os signatários
      const x = erroDaRpc(e.erro);
      return await falhar(e.message, r.erro(x.status >= 500 ? 409 : x.status,
        "O contrato mudou durante o envio e nada foi enviado aos signatários. Confira e tente de novo.", { codigo: "rpc", detalhes: x.detalhes }));
    }
    return await falhar(mensagemSegura(e), r.erro(502,
      "Não foi possível enviar para assinatura agora. O contrato continua em análise; tente de novo em instantes.", { codigo: "falha_envio" }));
  }
}

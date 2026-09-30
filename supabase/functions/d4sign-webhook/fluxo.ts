// Fluxo da Edge Function d4sign-webhook (docs/ARQUITETURA_EXPANSAO.md §6.5), sem Deno nem npm: o index.ts liga as
// portas (service role e segredos). Testado no Vitest em _shared/d4sign.fluxos.test.ts (WP4R-09).
//
// URL cadastrada no documento pela contrato-assinatura: …/functions/v1/d4sign-webhook?t=<token aleatório de 32 bytes>.
// Ordem (nada é gravado antes de o pedido provar que veio de quem tem o token do contrato):
// 1. corpo cru com limite (64 KB) → identifica o documento (uuid); nada do corpo é aceito como verdade;
// 2. o sha256 de `t` precisa bater com contratos.webhook_token_hash DO DOCUMENTO recebido (tempo constante);
// 3. com D4SIGN_HMAC_SECRET configurado, o cabeçalho Content-Hmac também é exigido;
// 4. idempotência: integracao_eventos (provedor, chave = sha256(uuid|type_post|email|sha256(corpo canônico))), sem o
//    e-mail no payload; evento repetido (mesmos campos, qualquer codificação) e já processado responde 200 sem refazer;
// 5. RECONSULTA o documento e os signatários na API e registra (contrato_registrar_retorno, idempotente). Todos
//    assinaram: baixa o PDF assinado e grava <contrato>/assinado-<sha8>.pdf.
// Resposta: 200 depois de gravar e processar o evento; 401 para token/HMAC inválidos (mesma resposta para documento
// desconhecido); 500 se o processamento falhar (o erro fica no evento e a reconciliação de hora em hora cobre).
import { lerBytes, mensagemSegura, type Respostas } from "../_shared/http.ts";
import { tokenConfereComHash } from "../_shared/chaves.ts";
import {
  type ChamarRpc, chaveIdempotencia, erroLimpo, exigirRpc, type FabricaD4sign, hmacWebhookConfere, lerEventoWebhook, linhaChamada,
  type LinhaChamada, reconsultarDocumento,
} from "../_shared/d4sign.ts";

export const LIMITE_CORPO = 64 * 1024;

export interface PortasWebhook {
  /** Contrato do documento (service role): id e o sha256 do token do webhook. */
  contratoDoDocumento(uuid: string): Promise<{ id: string; webhook_token_hash: string | null } | null>;
  /** D4SIGN_HMAC_SECRET (nulo = a conta não assina os webhooks). */
  segredoHmac: string | null;
  /** integracao_eventos: grava o evento (on conflict do nothing) e devolve o id e se já foi processado. */
  registrarEvento(evento: { chave: string; tipo: string | null; documento: string }): Promise<{ id: number; processado_em: string | null }>;
  concluirEvento(id: number, resultado: string): Promise<void>;
  falharEvento(id: number, erro: string): Promise<void>;
  d4sign: FabricaD4sign;
  /** Insere em integracao_chamadas. Lança se não gravar. */
  gravarChamada(linha: LinhaChamada): Promise<void>;
  salvarPdfAssinado(caminho: string, pdf: Uint8Array): Promise<void>;
  /** RPCs de sistema (service role). */
  sistema: ChamarRpc;
  log(mensagem: string): void;
}

export async function tratarWebhook(req: Request, r: Respostas, portas: PortasWebhook): Promise<Response> {
  const naoAutorizado = () => r.erro(401, "Não autorizado");
  const token = new URL(req.url).searchParams.get("t");
  if (!token || token.length > 200) return naoAutorizado();

  const lido = await lerBytes(req, LIMITE_CORPO);
  if (!lido.ok) return r.erro(lido.status, lido.erro, { codigo: lido.codigo });
  const evento = await lerEventoWebhook(lido.valor, req.headers.get("content-type"));
  if (!evento) return naoAutorizado();

  const k = await portas.contratoDoDocumento(evento.uuid);
  if (!k || !(await tokenConfereComHash(token, k.webhook_token_hash))) return naoAutorizado();
  if (portas.segredoHmac && !(await hmacWebhookConfere(req.headers.get("content-hmac"), portas.segredoHmac, evento.uuid, lido.valor))) {
    return naoAutorizado();
  }

  // idempotência (on conflict do nothing) e estado do evento
  const chave = await chaveIdempotencia(evento);
  const registro = await portas.registrarEvento({ chave, tipo: evento.typePost, documento: evento.uuid });
  if (registro.processado_em) return r.json({ ok: true, repetido: true });

  try {
    if (!portas.d4sign.ok) throw new Error(`configuração do D4Sign: ${portas.d4sign.erro}`);
    const api = portas.d4sign.criar(async (c) => {
      try {
        await portas.gravarChamada(linhaChamada(c, k.id));
      } catch (e) {
        portas.log(`integracao_chamadas: ${mensagemSegura(e)}`);
      }
    });
    const status = await reconsultarDocumento({
      api,
      salvarPdfAssinado: portas.salvarPdfAssinado,
      async registrarRetorno(args) {
        await exigirRpc(portas.sistema, "contrato_registrar_retorno", { ...args });
      },
    }, k.id, evento.uuid);
    await portas.concluirEvento(registro.id, status ?? "sem_mudanca");
    return r.json({ ok: true });
  } catch (e) {
    portas.log(`processamento: ${mensagemSegura(e)}`);
    try {
      await portas.falharEvento(registro.id, erroLimpo(e, 2000));
    } catch (f) {
      portas.log(`integracao_eventos: ${mensagemSegura(f)}`);
    }
    return r.erro(500, "Falha ao processar o evento");
  }
}

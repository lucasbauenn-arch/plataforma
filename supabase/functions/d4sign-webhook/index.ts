// Edge Function d4sign-webhook (docs/ARQUITETURA_EXPANSAO.md §6.5): pública (verify_jwt = false), validada por segredo.
// O fluxo (puro, testado no Vitest: token → HMAC → idempotência → reconsulta) está em ./fluxo.ts; aqui só se ligam as
// portas: service role (contratos, integracao_eventos, integracao_chamadas, Storage, contrato_registrar_retorno) e os
// segredos do D4Sign.
import { criarRota } from "../_shared/http.ts";
import { emProducao, lerEnv } from "../_shared/ambiente.ts";
import { clienteAdmin } from "../_shared/supabase.ts";
import { configD4sign, criarClienteD4sign, type FabricaD4sign } from "../_shared/d4sign.ts";
import { tratarWebhook } from "./fluxo.ts";

Deno.serve(criarRota({ nome: "d4sign-webhook" }, (req, r) => {
  const admin = clienteAdmin();
  const cfg = configD4sign({
    url: lerEnv("D4SIGN_URL"), token: lerEnv("D4SIGN_TOKEN"), cryptKey: lerEnv("D4SIGN_CRYPT_KEY"), cofre: lerEnv("D4SIGN_COFRE_UUID"),
  }, emProducao());
  const d4sign: FabricaD4sign = cfg.ok
    ? { ok: true, criar: (registrar) => criarClienteD4sign(cfg.config, { registrar }) }
    : { ok: false, erro: cfg.erro };

  return tratarWebhook(req, r, {
    async contratoDoDocumento(uuid) {
      const { data, error } = await admin.from("contratos").select("id, webhook_token_hash").eq("d4sign_uuid", uuid).maybeSingle();
      if (error) throw new Error(`contratos: ${error.message}`);
      return (data as { id: string; webhook_token_hash: string | null } | null) ?? null;
    },
    segredoHmac: lerEnv("D4SIGN_HMAC_SECRET"),
    async registrarEvento({ chave, tipo, documento }) {
      const novo = await admin.from("integracao_eventos").upsert({
        provedor: "d4sign", chave_idempotencia: chave, tipo, documento_ref: documento, payload: { uuid: documento, type_post: tipo },
      }, { onConflict: "provedor,chave_idempotencia", ignoreDuplicates: true });
      if (novo.error) throw new Error(`integracao_eventos: ${novo.error.message}`);
      const { data, error } = await admin.from("integracao_eventos").select("id, processado_em")
        .eq("provedor", "d4sign").eq("chave_idempotencia", chave).single();
      if (error) throw new Error(`integracao_eventos: ${error.message}`);
      return data as { id: number; processado_em: string | null };
    },
    async concluirEvento(id, resultado) {
      const { error } = await admin.from("integracao_eventos")
        .update({ processado_em: new Date().toISOString(), resultado, erro: null }).eq("id", id);
      if (error) throw new Error(`integracao_eventos: ${error.message}`);
    },
    async falharEvento(id, erro) {
      const { error } = await admin.from("integracao_eventos").update({ erro }).eq("id", id);
      if (error) throw new Error(`integracao_eventos: ${error.message}`);
    },
    d4sign,
    async gravarChamada(linha) {
      const { error } = await admin.from("integracao_chamadas").insert(linha);
      if (error) throw new Error(`integracao_chamadas: ${error.message}`);
    },
    async salvarPdfAssinado(caminho, pdf) {
      const { error } = await admin.storage.from("contratos").upload(caminho, pdf, { contentType: "application/pdf", upsert: false });
      if (error && !/exist|duplicate/i.test(error.message)) throw new Error(`upload do PDF assinado: ${error.message}`);
    },
    sistema: (nome, args) => admin.rpc(nome, args),
    log: (mensagem) => console.error(`[d4sign-webhook] ${mensagem}`),
  });
}));

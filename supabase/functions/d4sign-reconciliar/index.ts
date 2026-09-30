// Edge Function d4sign-reconciliar (docs/ARQUITETURA_EXPANSAO.md §6.5): chamada de hora em hora pelo pg_cron
// (pg_net, cabeçalho x-cron-secret = CRON_SEGREDO do Vault; agendamento na migration 16 do WP6). verify_jwt = false.
// O fluxo (puro, testado no Vitest) está em ./fluxo.ts; aqui só se ligam as portas (service role e segredos).
import { criarRota } from "../_shared/http.ts";
import { cabecalhoSecretoConfere, emProducao, lerEnv } from "../_shared/ambiente.ts";
import { clienteAdmin } from "../_shared/supabase.ts";
import { configD4sign, criarClienteD4sign, type FabricaD4sign } from "../_shared/d4sign.ts";
import { tratarReconciliacao } from "./fluxo.ts";

Deno.serve(criarRota({ nome: "d4sign-reconciliar" }, (req, r) => {
  const admin = clienteAdmin();
  const cfg = configD4sign({
    url: lerEnv("D4SIGN_URL"), token: lerEnv("D4SIGN_TOKEN"), cryptKey: lerEnv("D4SIGN_CRYPT_KEY"), cofre: lerEnv("D4SIGN_COFRE_UUID"),
  }, emProducao());
  const d4sign: FabricaD4sign = cfg.ok
    ? { ok: true, criar: (registrar) => criarClienteD4sign(cfg.config, { registrar }) }
    : { ok: false, erro: cfg.erro };

  return tratarReconciliacao(req, r, {
    autorizado: (req) => cabecalhoSecretoConfere(req, "x-cron-secret", "CRON_SEGREDO"),
    d4sign,
    async pendentes(limite) {
      const { data, error } = await admin.from("contratos").select("id, d4sign_uuid")
        .eq("status", "assinatura_pendente").not("d4sign_uuid", "is", null)
        .or(`atualizado_em.is.null,atualizado_em.lt."${limite}"`)
        .order("atualizado_em", { ascending: true, nullsFirst: true }).limit(500);
      if (error) throw new Error(`contratos: ${error.message}`);
      return (data ?? []) as { id: string; d4sign_uuid: string }[];
    },
    async ultimasConsultas(ids, desde) {
      const { data } = await admin.from("integracao_chamadas").select("entidade_id, criado_em")
        .eq("provedor", "d4sign").eq("operacao", "consultar_documento").eq("entidade", "contrato")
        .in("entidade_id", ids).gte("criado_em", desde);
      return (data ?? []) as { entidade_id: string; criado_em: string }[];
    },
    async gravarChamada(linha) {
      const { error } = await admin.from("integracao_chamadas").insert(linha);
      if (error) throw new Error(`integracao_chamadas: ${error.message}`);
    },
    async salvarPdfAssinado(caminho, pdf) {
      const { error } = await admin.storage.from("contratos").upload(caminho, pdf, { contentType: "application/pdf", upsert: false });
      if (error && !/exist|duplicate/i.test(error.message)) throw new Error(`upload do PDF assinado: ${error.message}`);
    },
    sistema: (nome, args) => admin.rpc(nome, args),
    log: (mensagem) => console.error(`[d4sign-reconciliar] ${mensagem}`),
  });
}));

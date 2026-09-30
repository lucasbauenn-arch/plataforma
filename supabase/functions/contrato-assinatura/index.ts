// Edge Function contrato-assinatura (docs/ARQUITETURA_EXPANSAO.md §6.4): envio para assinatura no D4Sign, cancelamento
// e "Atualizar status". O fluxo (puro, testado no Vitest) está em ./fluxo.ts; aqui só se ligam as portas: Supabase com o
// JWT do usuário (permissão e auditoria das RPCs) e com a service role (RPCs de sistema, Storage, integracao_chamadas),
// e os segredos do D4Sign.
//
// O D4Sign leva token e chave na URL: as chamadas são só entre servidores e a URL nunca vai para log nem para o banco.
import { criarRota } from "../_shared/http.ts";
import { corsDoSite, emProducao, exigirEnv, lerEnv } from "../_shared/ambiente.ts";
import { clienteAdmin, exigirUsuario } from "../_shared/supabase.ts";
import { configD4sign, criarClienteD4sign, type FabricaD4sign } from "../_shared/d4sign.ts";
import { tratarAssinatura } from "./fluxo.ts";

Deno.serve(criarRota({ nome: "contrato-assinatura", cors: corsDoSite() }, (req, r) => {
  const admin = clienteAdmin();
  const cfg = configD4sign({
    url: lerEnv("D4SIGN_URL"), token: lerEnv("D4SIGN_TOKEN"), cryptKey: lerEnv("D4SIGN_CRYPT_KEY"), cofre: lerEnv("D4SIGN_COFRE_UUID"),
  }, emProducao());
  const d4sign: FabricaD4sign = cfg.ok
    ? { ok: true, criar: (registrar) => criarClienteD4sign(cfg.config, { registrar }) }
    : { ok: false, erro: cfg.erro };

  return tratarAssinatura(req, r, {
    async autenticar(req, r) {
      const quem = await exigirUsuario(req, r);
      return quem instanceof Response ? quem : { rpc: (nome, args) => quem.db.rpc(nome, args) };
    },
    sistema: (nome, args) => admin.rpc(nome, args),
    d4sign,
    async gravarChamada(linha) {
      const { error } = await admin.from("integracao_chamadas").insert(linha);
      if (error) throw new Error(`integracao_chamadas: ${error.message}`);
    },
    async baixarMinuta(caminho) {
      const { data, error } = await admin.storage.from("contratos").download(caminho);
      if (error || !data) throw new Error(`download da minuta: ${error?.message ?? "vazio"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async salvarPdfAssinado(caminho, pdf) {
      const { error } = await admin.storage.from("contratos").upload(caminho, pdf, { contentType: "application/pdf", upsert: false });
      if (error && !/exist|duplicate/i.test(error.message)) throw new Error(`upload do PDF assinado: ${error.message}`);
    },
    async prazoAssinaturaDias() {
      const { data } = await admin.from("configuracao_geral").select("prazo_assinatura_dias").maybeSingle();
      return (data as { prazo_assinatura_dias?: number | null } | null)?.prazo_assinatura_dias ?? null;
    },
    async situacao(id) {
      const { data, error } = await admin.from("contratos").select("status, d4sign_uuid").eq("id", id).maybeSingle();
      if (error) throw new Error(`contratos: ${error.message}`);
      return (data as { status: string; d4sign_uuid: string | null } | null) ?? null;
    },
    urlWebhook: (token) => `${exigirEnv("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1/d4sign-webhook?t=${encodeURIComponent(token)}`,
    log: (mensagem) => console.error(`[contrato-assinatura] ${mensagem}`),
  });
}));

// Edge Function contrato-gerar (docs/ARQUITETURA_EXPANSAO.md §6.3): gera o PDF da minuta de um contrato.
//
// Autenticação: verify_jwt = false no config.toml; o JWT é validado no Auth (exigirUsuario) e a PERMISSÃO é da RPC
// contrato_dados_modelo, chamada com o JWT do usuário. O fluxo (puro, testado no Vitest) está em ./fluxo.ts; aqui só se
// ligam as portas: Supabase com o JWT e com a service role (Storage e contrato_registrar_documento) e o pdf-lib.
import { criarRota } from "../_shared/http.ts";
import { corsDoSite } from "../_shared/ambiente.ts";
import { clienteAdmin, exigirUsuario } from "../_shared/supabase.ts";
import { tratarGeracao } from "./fluxo.ts";
import { gerarPdf } from "./pdf-lib.ts";

Deno.serve(criarRota({ nome: "contrato-gerar", cors: corsDoSite() }, (req, r) => {
  const admin = clienteAdmin();
  return tratarGeracao(req, r, {
    async autenticar(req, r) {
      const quem = await exigirUsuario(req, r);
      return quem instanceof Response ? quem : { rpc: (nome, args) => quem.db.rpc(nome, args) };
    },
    sistema: (nome, args) => admin.rpc(nome, args),
    desenharPdf: (blocos, meta) => gerarPdf(blocos, meta),
    async salvarMinuta(caminho, pdf) {
      // o bucket contratos só aceita gravação da service role
      const { error } = await admin.storage.from("contratos").upload(caminho, pdf, { contentType: "application/pdf", upsert: false });
      const jaExistia = !!error && /exist|duplicate/i.test(error.message);
      if (error && !jaExistia) throw new Error(`upload da minuta: ${error.message}`);
      return { jaExistia };
    },
    async removerMinuta(caminho) {
      await admin.storage.from("contratos").remove([caminho]);
    },
  });
}));

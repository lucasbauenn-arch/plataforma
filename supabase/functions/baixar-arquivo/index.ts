// Edge Function baixar-arquivo (docs/ARQUITETURA_EXPANSAO.md §4.3): URL assinada de curta duração para um arquivo
// de crm-documentos ou contratos, SEMPRE depois de uma RPC auditada.
//
// Fluxo do front (src/lib/rpc.ts, urlDoDownload):
//   1. crm_documento_baixar / contrato_baixar / portal_contrato_baixar com o JWT do usuário → confere o escopo,
//      grava a auditoria e a autorização em download_autorizacoes (validade = download_ttl_segundos);
//   2. POST desta função com { bucket, path } e o mesmo JWT.
// Aqui: o JWT é validado no Auth; a autorização vigente DESSE usuário para o mesmo bucket e caminho é resgatada; a
// URL é assinada com a service role e vale só até o fim da autorização. A service role não decide permissão: quem
// decidiu foi a RPC, com o JWT do usuário. Os buckets não têm política de SELECT para authenticated (migration 09),
// então ninguém assina URL longa por conta própria.
import { criarRota, lerJson } from "../_shared/http.ts";
import { corsDoSite } from "../_shared/ambiente.ts";
import { clienteAdmin, exigirUsuario } from "../_shared/supabase.ts";
import { lerPedidoDownload, segundosRestantes } from "../_shared/download.ts";

Deno.serve(criarRota({ nome: "baixar-arquivo", cors: corsDoSite() }, async (req, r) => {
  const quem = await exigirUsuario(req, r);
  if (quem instanceof Response) return quem;

  const corpo = await lerJson(req);
  if (!corpo.ok) return r.erro(corpo.status, corpo.erro, { codigo: corpo.codigo });
  const pedido = lerPedidoDownload(corpo.valor);
  if (!pedido.ok) return r.erro(422, pedido.erro);
  const { bucket, path } = pedido.valor;

  const admin = clienteAdmin();
  const agora = Date.now();
  const { data, error } = await admin
    .from("download_autorizacoes")
    .select("expira_em")
    .eq("profile_id", quem.usuario.id)
    .eq("bucket", bucket)
    .eq("path", path)
    .gt("expira_em", new Date(agora).toISOString())
    .order("expira_em", { ascending: false })
    .limit(1);
  if (error) throw new Error(`download_autorizacoes: ${error.message}`);

  const linha = (data ?? [])[0] as { expira_em?: unknown } | undefined;
  const segundos = segundosRestantes(typeof linha?.expira_em === "string" ? linha.expira_em : null, agora);
  if (segundos === 0) {
    return r.erro(403, "O link de download expirou. Tente baixar de novo.", { codigo: "download_nao_autorizado" });
  }

  const assinada = await admin.storage.from(bucket).createSignedUrl(path, segundos);
  if (assinada.error || !assinada.data?.signedUrl) {
    return r.erro(404, "Arquivo não encontrado.", { codigo: "arquivo_nao_encontrado" });
  }
  return r.json({ url: assinada.data.signedUrl, expira_em: new Date(agora + segundos * 1000).toISOString() });
}));

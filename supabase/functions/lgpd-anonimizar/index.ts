// Edge Function lgpd-anonimizar (docs/ARQUITETURA_EXPANSAO.md §5.5, §6.7): anonimização a pedido do titular.
// POST { cliente_id, protocolo } com o JWT do Super.
//   1. chama lgpd_anonimizar_cliente COM O JWT de quem pediu: o banco confere is_super() (com aal2 quando a 2FA dos
//      internos é exigida), anonimiza, audita e devolve os caminhos dos arquivos e o usuário do portal;
//   2. apaga os arquivos pela API do Storage (apagar storage.objects por SQL deixaria o arquivo órfão): crm-documentos
//      (`paths`) e, do portal antigo, cliente-arquivos (`paths_portal`, WP7R1-03);
//   3. remove o usuário Auth do portal (a RPC só devolve usuário cujo perfil é de cliente).
// A RPC é idempotente: se o Storage ou o Auth falharem, repetir o pedido completa a remoção. A service role só entra
// nos passos 2 e 3; quem decide a permissão é a RPC.
import { criarRota, lerJson, mensagemSegura } from "../_shared/http.ts";
import { corsDoSite } from "../_shared/ambiente.ts";
import { clienteAdmin, exigirUsuario } from "../_shared/supabase.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROTOCOLO = /^[A-Za-z0-9][A-Za-z0-9._/#-]{2,59}$/;
const BUCKET_DOCUMENTOS = "crm-documentos";
const BUCKET_PORTAL = "cliente-arquivos";
const LOTE = 100;

type Resultado = { paths?: unknown; paths_portal?: unknown; user_id?: unknown };
const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((p): p is string => typeof p === "string" && p.length > 0) : []);

Deno.serve(criarRota({ nome: "lgpd-anonimizar", cors: corsDoSite() }, async (req, r) => {
  const quem = await exigirUsuario(req, r);
  if (quem instanceof Response) return quem;

  const corpo = await lerJson(req);
  if (!corpo.ok) return r.erro(corpo.status, corpo.erro, { codigo: corpo.codigo });
  const clienteId = typeof corpo.valor.cliente_id === "string" ? corpo.valor.cliente_id.trim() : "";
  const protocolo = typeof corpo.valor.protocolo === "string" ? corpo.valor.protocolo.trim() : "";
  if (!UUID.test(clienteId)) return r.erro(422, "Cliente inválido.");
  if (!PROTOCOLO.test(protocolo)) {
    return r.erro(422, "Informe o protocolo do pedido (3 a 60 caracteres: letras, números, ponto, barra, # ou hífen).");
  }

  // 1. a permissão e a anonimização são da RPC, com o JWT do Super
  const { data, error } = await quem.db.rpc("lgpd_anonimizar_cliente", { p_cliente_id: clienteId, p_protocolo: protocolo });
  if (error) {
    if (error.code === "42501") return r.erro(403, "Você não tem acesso a este registro.", { codigo: "sem_permissao" });
    if (error.code === "P0001") {
      return r.erro(422, error.message === "DADOS_INVALIDOS" ? "Dados inválidos." : error.message, { codigo: "regra_de_negocio" });
    }
    throw new Error(`lgpd_anonimizar_cliente: ${error.code ?? ""} ${error.message}`);
  }
  const resultado = (data ?? {}) as Resultado;
  const paths = textos(resultado.paths);
  const pathsPortal = textos(resultado.paths_portal);
  const usuarioPortal = typeof resultado.user_id === "string" && UUID.test(resultado.user_id) ? resultado.user_id : null;

  const admin = clienteAdmin();

  // 2. arquivos (em lotes, por bucket): os registrados e os objetos sem registro sob <cliente_id>/ (a RPC lê os buckets,
  // WP6R-02 e WP7R1-03). Caminho de outro cliente nunca é aceito (defesa extra: o 1º segmento é o cliente, comparado
  // sem caixa, como na RPC); o caminho segue para o Storage exatamente como está gravado.
  let apagados = 0;
  let falhas = 0;
  const daqui = (p: string) => p.split("/")[0].toLowerCase() === clienteId.toLowerCase();
  const doCliente = [
    { bucket: BUCKET_DOCUMENTOS, paths: paths.filter(daqui) },
    { bucket: BUCKET_PORTAL, paths: pathsPortal.filter(daqui) },
  ];
  for (const { bucket, paths: caminhos } of doCliente) {
    for (let i = 0; i < caminhos.length; i += LOTE) {
      const lote = caminhos.slice(i, i + LOTE);
      const { data: removidos, error: e } = await admin.storage.from(bucket).remove(lote);
      if (e) {
        falhas += lote.length;
        console.error(`[lgpd-anonimizar] storage (${bucket}): ${mensagemSegura(e)}`);
      } else {
        // só o que o Storage de fato removeu: numa repetição, os caminhos já apagados voltam sem erro e sem objeto
        apagados += Array.isArray(removidos) ? removidos.length : 0;
      }
    }
  }
  const totalArquivos = doCliente.reduce((n, b) => n + b.paths.length, 0);

  // 3. usuário do portal (já removido numa tentativa anterior: segue)
  let usuarioRemovido = false;
  let falhaUsuario = false;
  if (usuarioPortal) {
    const { error: e } = await admin.auth.admin.deleteUser(usuarioPortal);
    const status = (e as { status?: number } | null)?.status;
    if (!e || status === 404) {
      usuarioRemovido = true;
    } else {
      falhaUsuario = true;
      console.error(`[lgpd-anonimizar] auth: ${mensagemSegura(e)}`);
    }
  }

  // registro da conclusão (sem dado pessoal; o log da RPC já tem o protocolo e os campos)
  const { error: erroAuditoria } = await admin.from("auditoria").insert({
    categoria: "lgpd", acao: "anonimizar", entidade: "clientes", entidade_id: clienteId, cliente_id: clienteId,
    ator_id: quem.usuario.id, origem: "edge:lgpd-anonimizar",
    detalhe: { etapa: "arquivos_e_usuario", arquivos: totalArquivos, arquivos_apagados: apagados, arquivos_falha: falhas,
               usuario_portal: usuarioPortal !== null, usuario_removido: usuarioRemovido },
  });
  if (erroAuditoria) console.error(`[lgpd-anonimizar] auditoria: ${erroAuditoria.code ?? ""} ${erroAuditoria.message}`);

  if (falhas > 0 || falhaUsuario) {
    return r.erro(502, "Os dados foram anonimizados, mas a remoção de arquivos ou do acesso ao portal não terminou. Tente de novo para concluir.", {
      codigo: "remocao_incompleta",
      detalhes: { arquivos_pendentes: falhas, usuario_pendente: falhaUsuario },
    });
  }
  return r.json({ ok: true, arquivos_apagados: apagados, usuario_removido: usuarioRemovido });
}));

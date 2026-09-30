// Edge Function convidar-parceiros (docs/ARQUITETURA_EXPANSAO.md §6.2; §10.1: só a versão nova, sem o corpo v1).
//
// POST { parceiro_ids: uuid[] (1..50), modo: "email" | "link", origem?: string }
//   -> 200 { resultados: [{ parceiro_id, nome, email, status, mensagem, link? }] }
// Quem pode convidar quem é decidido SEMPRE pela RPC rede_pode_convidar, chamada com o JWT de quem pediu (matriz,
// escopo, aal2 e o limite por hora de respostas "email_em_uso" aplicados pelo banco). A service role (clienteAdmin) só:
//   - cria a conta no Auth (generateLink invite, sem e-mail) e envia o e-mail (inviteUserByEmail) — os metadados levam
//     só o nome, nunca papel ou cadeia;
//   - chama as RPCs de sistema rede_vincular_login (aceita só o perfil recém-criado por ESTE convite) e
//     rede_registrar_convite (auditoria de quem gerou, para quem e o modo; nunca o link);
//   - apaga a conta que ESTE convite criou quando o vínculo falha, e só se ela continua sem vínculo e sem uso
//     (lê parceiros.profile_id e o usuário no Auth para decidir; não decide permissão) [WP1R-02].
// A ordem (conta sem e-mail → vínculo → auditoria → entrega) e as situações estão em ./fluxo.ts (módulo puro, com
// testes em src/lib/convites.test.ts):
//   novo          → cria a conta, vincula ao parceiro (papel = tipo; acesso aprovado), audita e entrega;
//   reenviar      → conta deste parceiro que nunca entrou: novo convite para a MESMA conta (o id é conferido);
//   email_em_uso  → o e-mail é de outra conta: nenhum link;
//   ja_ativo      → já entrou: nenhum link ("use Esqueci a senha");
//   sem_email / indisponivel → nada a fazer; limite → muitas respostas "email_em_uso" na última hora.
// O link devolvido (modo "link", só com rede.convite_por_link) NÃO é o action_link do Auth: é
// <origem>/parceiros/definir-senha?token_hash=<hashed_token>&type=invite, e a página só consome o token quando a
// pessoa clica em "Continuar" (pré-visualização do WhatsApp e antivírus de e-mail não queimam o convite). No modo
// "email" o Auth envia o template supabase/templates/convite.html, que monta o mesmo endereço com {{ .TokenHash }}.
// O token do Supabase é aleatório, de uso único e vale 24 h (otp_expiry = 86400).
import { type SupabaseClient } from "../_shared/supabase-js.ts";
import { criarRota, lerJson, mensagemSegura, origemPermitida } from "../_shared/http.ts";
import { corsDoSite } from "../_shared/ambiente.ts";
import { type Autenticado, clienteAdmin, exigirUsuario } from "../_shared/supabase.ts";
import {
  convidarUm, type ContaAuth, type Dependencias, type ErroApi, lerPedido, MENSAGENS, type PodeConvidar, type Resultado,
} from "./fluxo.ts";

const NOME = "convidar-parceiros";

function registrarErro(etapa: string, parceiroId: string, erro: unknown) {
  // nunca o e-mail nem o link: só a etapa, o parceiro e a mensagem limpa
  console.error(`[${NOME}] ${etapa} (parceiro ${parceiroId}): ${mensagemSegura(erro)}`);
}

const erroApi = (e: { code?: string | null; message?: string | null; details?: string | null } | null | undefined): ErroApi =>
  e ? { code: e.code ?? null, message: e.message ?? null, details: e.details ?? null } : null;

const conta = (u: ContaAuth | null | undefined): ContaAuth | null =>
  u ? {
    id: u.id, created_at: u.created_at ?? null, invited_at: u.invited_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null, email_confirmed_at: u.email_confirmed_at ?? null,
  } : null;

function dependencias(quem: Autenticado, admin: SupabaseClient): Dependencias {
  return {
    podeConvidar: async (id) => {
      const r = await quem.db.rpc("rede_pode_convidar", { p_parceiro_id: id });
      return { data: (r.data as PodeConvidar | null) ?? null, error: erroApi(r.error) };
    },
    gerarConvite: async (email, nome, redirectTo) => {
      const g = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { nome }, redirectTo } });
      return { conta: conta(g.data?.user), tokenHash: g.data?.properties?.hashed_token ?? null, error: erroApi(g.error) };
    },
    enviarConvite: async (email, nome, redirectTo) => {
      const c = await admin.auth.admin.inviteUserByEmail(email, { data: { nome }, redirectTo });
      return { conta: conta(c.data?.user), error: erroApi(c.error) };
    },
    vincular: async (id, contaId) => {
      const v = await admin.rpc("rede_vincular_login", { p_parceiro_id: id, p_profile_id: contaId });
      return { error: erroApi(v.error) };
    },
    registrar: async (id, modo) => {
      const a = await admin.rpc("rede_registrar_convite", { p_parceiro_id: id, p_modo: modo, p_ator: quem.usuario.id });
      return { error: erroApi(a.error) };
    },
    vinculoDaConta: async (contaId) => {
      const r = await admin.from("parceiros").select("id").eq("profile_id", contaId).maybeSingle();
      return { parceiroId: (r.data as { id: string } | null)?.id ?? null, error: erroApi(r.error) };
    },
    buscarConta: async (contaId) => {
      const r = await admin.auth.admin.getUserById(contaId);
      return { conta: conta(r.data?.user), error: erroApi(r.error) };
    },
    apagarConta: async (contaId) => {
      const r = await admin.auth.admin.deleteUser(contaId);
      return { error: erroApi(r.error) };
    },
    agora: () => Date.now(),
    registrarErro,
  };
}

Deno.serve(criarRota({ nome: NOME, cors: corsDoSite() }, async (req, r) => {
  const quem = await exigirUsuario(req, r);
  if (quem instanceof Response) return quem;

  const corpo = await lerJson(req);
  if (!corpo.ok) return r.erro(corpo.status, corpo.erro, { codigo: corpo.codigo });
  const pedido = lerPedido(corpo.valor);
  if (!pedido.ok) return r.erro(422, pedido.erro);
  const { ids, modo, origem } = pedido.valor;

  // o link aponta para uma origem da lista do CORS (SITE_URL, com/sem www; localhost só fora de produção)
  const cors = corsDoSite();
  const base = origem && origemPermitida(origem, cors) ? origem : cors.origens[0];

  const deps = dependencias(quem, clienteAdmin());
  const resultados: Resultado[] = [];
  // um por vez: respeita o limite de e-mails do Auth e mantém a ordem pedida
  for (const id of ids) {
    try {
      resultados.push(await convidarUm(deps, id, modo, base));
    } catch (erro) {
      registrarErro("inesperado", id, erro);
      resultados.push({ parceiro_id: id, nome: null, email: null, status: "erro", mensagem: MENSAGENS.erro });
    }
  }
  return r.json({ resultados });
}));

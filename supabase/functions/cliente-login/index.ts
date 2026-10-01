// Portal do Cliente — login SÓ COM CPF (decisão do usuário em 21/09/2026, risco aceito: PRD 4.3 e docs/ARQUITETURA_EXPANSAO.md
// §1.2 N1, §6.7). POST { cpf } -> { access_token, refresh_token }.
// Mitigações (regras em portal.ts, testadas em portal.test.ts):
//   - limite de tentativas por IP (IPv6 pela rede /64; sem IP, balde comum) e um teto global de falhas, sobre
//     tentativas_publicas; todo acesso fica também em portal_acessos (auditoria: quem entrou, de onde);
//   - a conta do Auth do cliente é criada aqui, com app_metadata.portal_cliente_id, e uma conta que já tenha o e-mail
//     interno do cliente sem esse marcador NUNCA é adotada (WP7R1-02);
//   - o cliente é localizado pela RPC de sistema portal_localizar_cliente (só service role), que só devolve pessoa física
//     com portal_liberado, não inativada e não anonimizada — qualquer outro caso recebe a mesma resposta de "não
//     encontrado", sem revelar o motivo. Enquanto a migration 15 não foi aplicada (RPC ainda é esqueleto, 0A000), a leitura
//     direta com o mesmo filtro faz o mesmo: é o que permite publicar esta função ANTES do db push (DEP-01; ver
//     scripts/migracao/DEPLOY.md). Remover o desvio depois do deploy completo é opcional.
import { agenteUsuario, criarRota, ipCliente, lerJson, mensagemSegura } from "../_shared/http.ts";
import { corsDoSite, exigirEnv } from "../_shared/ambiente.ts";
import { respostaDoBloqueio } from "../_shared/limite-ip.ts";
import { armazemTentativas, chaveApi, clienteAdmin } from "../_shared/supabase.ts";
import { createClient, type SupabaseClient } from "../_shared/supabase-js.ts";
import {
  type ContaAuth, type GatewayPortal, type PortaLocalizar, REGRA_PORTAL_IP, cpfValido, respostaSemAcesso, situacaoDoCpf,
  localizarClientePortal, reservarLoginPortal, resolverContaDoPortal, soDigitos,
} from "./portal.ts";

const DIRETO = "id, nome, user_id";

function portaLocalizar(admin: SupabaseClient): PortaLocalizar {
  return {
    rpc: async (cpf) => {
      const { data, error } = await admin.rpc("portal_localizar_cliente", { p_cpf: cpf });
      return { data, error };
    },
    direto: async (cpf) => {
      const { data, error } = await admin.from("clientes").select(DIRETO).eq("cpf", cpf).eq("tipo_pessoa", "fisica")
        .eq("portal_liberado", true).is("inativado_em", null).is("anonimizado_em", null).limit(1);
      return { data, error };
    },
  };
}

type UsuarioAuth = { id: string; email?: string; app_metadata?: Record<string, unknown>; email_confirmed_at?: string; created_at?: string };
const comoConta = (u: UsuarioAuth | null | undefined): ContaAuth | null =>
  u ? { id: u.id, email: u.email ?? null, app_metadata: u.app_metadata ?? null, email_confirmed_at: u.email_confirmed_at ?? null, created_at: u.created_at ?? null } : null;

function gatewayPortal(admin: SupabaseClient): GatewayPortal {
  const contaPorId = async (id: string) => comoConta((await admin.auth.admin.getUserById(id)).data?.user as UsuarioAuth | undefined);
  return {
    contaPorId,
    async contasPorEmail(email) {
      const { data } = await admin.from("profiles").select("id").eq("email", email).limit(5);
      const contas = await Promise.all(((data ?? []) as { id: string }[]).map((p) => contaPorId(p.id)));
      return contas.filter((c): c is ContaAuth => c !== null && (c.email ?? "").toLowerCase() === email.toLowerCase());
    },
    async criarConta(clienteId, nome) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `cliente-${clienteId}@portal.arkenincorporadora.com.br`, email_confirm: true,
        app_metadata: { portal_cliente_id: clienteId }, user_metadata: { nome },
      });
      return { conta: error ? null : comoConta(data?.user as UsuarioAuth | undefined) };
    },
    async papelDoPerfil(userId) {
      const { data } = await admin.from("profiles").select("papel").eq("id", userId).maybeSingle();
      return (data as { papel?: string } | null)?.papel ?? null;
    },
    async promoverPerfil(userId, nome) {
      const { error } = await admin.from("profiles").update({ papel: "cliente", nome }).eq("id", userId);
      if (error) throw new Error(`profiles: ${error.code ?? ""} ${error.message}`);
    },
    async ligarAoCliente(clienteId, userId) {
      const { data, error } = await admin.from("clientes").update({ user_id: userId }).eq("id", clienteId).is("user_id", null).select("id");
      if (error) throw new Error(`clientes: ${error.code ?? ""} ${error.message}`);
      return (data ?? []).length > 0;
    },
    async userIdDoCliente(clienteId) {
      const { data } = await admin.from("clientes").select("user_id").eq("id", clienteId).maybeSingle();
      return (data as { user_id?: string | null } | null)?.user_id ?? null;
    },
    async estamparMarcador(userId, clienteId) {
      const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { portal_cliente_id: clienteId } });
      if (error) console.error(`[cliente-login] marcador da conta legada: ${mensagemSegura(error)}`);
    },
  };
}

Deno.serve(criarRota({ nome: "cliente-login", cors: corsDoSite() }, async (req, r) => {
  const admin = clienteAdmin();
  const ip = ipCliente(req);
  const userAgent = agenteUsuario(req);
  const armazem = armazemTentativas(admin);

  // Reserva ATÔMICA da tentativa nos dois baldes (IP e global), ANTES de qualquer trabalho (FR1-01): o banco serializa
  // as requisições do mesmo IP, então uma rajada simultânea não passa do limite. A reserva já vale como falha; o
  // sucesso a confirma no fim. Sem conseguir reservar, não libera (falha fechada: "indisponivel" → 503).
  const limite = await reservarLoginPortal(armazem, ip);
  if (!limite.permitido) {
    const b = respostaDoBloqueio(limite, REGRA_PORTAL_IP);
    return r.erro(b.status, b.mensagem, { codigo: b.codigo, cabecalhos: b.cabecalhos });
  }

  // auditoria (portal_acessos: quem entrou, de onde) + fechamento da reserva do limite (tentativas_publicas)
  const registrar = async (sucesso: boolean, cliente_id: string | null = null) => {
    const { error } = await admin.from("portal_acessos").insert({ cliente_id, ip, user_agent: userAgent, sucesso });
    if (error) console.error(`[cliente-login] portal_acessos: ${error.code ?? ""} ${error.message}`);
    await limite.concluir(sucesso);
  };

  const corpo = await lerJson(req);
  if (!corpo.ok) {
    await limite.concluir(false);
    return r.erro(corpo.status, corpo.erro, { codigo: corpo.codigo });
  }
  const cpf = soDigitos(corpo.valor.cpf);
  if (!cpfValido(cpf)) {
    await registrar(false);
    return r.erro(400, "CPF inválido");
  }

  const cliente = await localizarClientePortal(portaLocalizar(admin), cpf);
  if (!cliente) {
    await registrar(false);
    // CPF existe mas sem acesso: diz o motivo (suspenso ou inativo); inexistente e anonimizado seguem "não encontrado"
    const sem = respostaSemAcesso(await situacaoDoCpf(async (c) => await admin.rpc("portal_situacao_cpf", { p_cpf: c }), cpf));
    return r.erro(sem.status, sem.mensagem, { codigo: sem.codigo });
  }

  // conta Auth própria do cliente, com e-mail interno (nunca usado para envio) e o marcador do cliente. Não reaproveita
  // o e-mail real (coincidiria com o de um admin/parceiro) nem adota conta alheia com o e-mail interno.
  const conta = await resolverContaDoPortal(gatewayPortal(admin), cliente);
  if (!conta.ok) {
    console.error(`[cliente-login] conta do portal recusada (${conta.motivo}) para o cliente ${cliente.id}`);
    const { error } = await admin.from("auditoria").insert({
      categoria: "seguranca", acao: "portal_conta_recusada", entidade: "clientes", entidade_id: cliente.id, cliente_id: cliente.id,
      origem: "edge:cliente-login", detalhe: { motivo: conta.motivo },
    });
    if (error) console.error(`[cliente-login] auditoria: ${error.code ?? ""} ${error.message}`);
    await registrar(false, cliente.id);
    return r.erro(403, "Acesso indisponível para este cadastro. Fale com nosso atendimento.");
  }

  // sessão gerada no servidor: o link mágico é criado e consumido aqui, sem envio de e-mail
  const anon = createClient(exigirEnv("SUPABASE_URL"), chaveApi("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: link, error: erroLink } = await admin.auth.admin.generateLink({ type: "magiclink", email: conta.email });
  const tokenHash = link?.properties?.hashed_token;
  const { data, error } = tokenHash && !erroLink
    ? await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" })
    : { data: null, error: erroLink };
  if (error || !data?.session) return r.erro(500, "Não foi possível entrar agora. Tente novamente.");

  await registrar(true, cliente.id);
  return r.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}));

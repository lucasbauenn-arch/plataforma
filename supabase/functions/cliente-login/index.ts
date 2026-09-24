// Portal do Cliente — login só com CPF (decisão do cliente em 21/09/2026, risco aceito: ver PRD 4.3).
// POST { cpf } -> { access_token, refresh_token }
// Mitigações: limite de tentativas por IP e registro de todo acesso em portal_acessos.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const soDigitos = (v: string) => (v ?? "").replace(/\D/g, "");

function cpfValido(cpf: string) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(cpf[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

// chaves novas (sb_secret_/sb_publishable_) com fallback para as legadas, desativadas no fim de 2026
const chave = (novas: string, legada: string) => {
  try {
    const k = JSON.parse(Deno.env.get(novas) ?? "{}").default;
    if (k) return k as string;
  } catch { /* usa a legada */ }
  return Deno.env.get(legada)!;
};

// limites por IP numa janela de 15 min: erros (varredura de CPFs) e total
const JANELA_MS = 15 * 60_000;
const MAX_ERROS = 10;
const MAX_TOTAL = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, chave("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), opcoes);
  const anon = createClient(url, chave("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), opcoes);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
  const registrar = (sucesso: boolean, cliente_id: string | null = null) =>
    admin.from("portal_acessos").insert({ cliente_id, ip, user_agent: userAgent, sucesso });

  if (ip) {
    const { data: recentes } = await admin.from("portal_acessos").select("sucesso")
      .eq("ip", ip).gte("created_at", new Date(Date.now() - JANELA_MS).toISOString());
    const erros = (recentes ?? []).filter((r) => !r.sucesso).length;
    if (erros >= MAX_ERROS || (recentes ?? []).length >= MAX_TOTAL) {
      return json({ erro: "Muitas tentativas. Aguarde 15 minutos e tente de novo." }, 429);
    }
  }

  const { cpf: cpfBruto } = await req.json().catch(() => ({}));
  const cpf = soDigitos(cpfBruto);
  if (!cpfValido(cpf)) { await registrar(false); return json({ erro: "CPF inválido" }, 400); }

  const { data: cliente } = await admin.from("clientes").select("id, nome, user_id").eq("cpf", cpf).maybeSingle();
  if (!cliente) { await registrar(false); return json({ erro: "CPF não encontrado. Fale com nosso atendimento." }, 404); }

  // conta Auth própria do cliente, com e-mail interno (nunca usado para envio). Não reaproveita o e-mail real:
  // se coincidisse com o de um admin/parceiro, o CPF daria acesso àquela conta.
  let userId = cliente.user_id as string | null;
  if (!userId) {
    const email = `cliente-${cliente.id}@portal.arkenincorporadora.com.br`;
    const { data: criado, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { nome: cliente.nome } });
    userId = criado?.user?.id ?? null;
    if (error) {
      const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      userId = lista?.users.find((u) => u.email === email)?.id ?? null;
    }
    if (!userId) return json({ erro: "Não foi possível preparar o acesso" }, 500);
    await admin.from("profiles").update({ papel: "cliente", nome: cliente.nome }).eq("id", userId);
    await admin.from("clientes").update({ user_id: userId }).eq("id", cliente.id);
  }

  const [{ data: perfil }, { data: usuario }] = await Promise.all([
    admin.from("profiles").select("papel").eq("id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  // nunca emitir sessão de admin/parceiro a partir de um CPF
  if (perfil?.papel !== "cliente" || !usuario?.user?.email) {
    await registrar(false, cliente.id);
    return json({ erro: "Acesso indisponível para este cadastro. Fale com nosso atendimento." }, 403);
  }

  // sessão gerada no servidor: o link mágico é criado e consumido aqui, sem envio de e-mail
  const { data: link, error: erroLink } = await admin.auth.admin.generateLink({ type: "magiclink", email: usuario.user.email });
  const tokenHash = link?.properties?.hashed_token;
  const { data, error } = tokenHash && !erroLink
    ? await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" })
    : { data: null, error: erroLink };
  if (error || !data?.session) return json({ erro: "Não foi possível entrar agora. Tente novamente." }, 500);

  await registrar(true, cliente.id);
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});

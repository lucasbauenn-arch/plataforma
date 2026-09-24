// Admin convida parceiros (ex.: os do WordPress, cujas senhas não migram): cria o usuário já aprovado e devolve
// o link para definir a senha — o admin manda pelo WhatsApp, ou o Supabase envia por e-mail (exige SMTP próprio).
// POST { parceiros: [{ nome, email, telefone?, creci?, imobiliaria? }], enviarEmail?: boolean, origem: string }
//   -> { resultados: [{ email, nome, telefone, status: 'convidado' | 'ja_existe' | 'erro', link?, erro? }] }
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const chave = (novas: string, legada: string) => {
  try {
    const k = JSON.parse(Deno.env.get(novas) ?? "{}").default;
    if (k) return k as string;
  } catch { /* usa a legada */ }
  return Deno.env.get(legada)!;
};

// origens aceitas para o link de retorno (as mesmas liberadas no Auth)
const ORIGENS = [/^https:\/\/(www\.)?arkenincorporadora\.com\.br$/, /^http:\/\/localhost:\d+$/];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Parceiro = { nome?: string; email?: string; telefone?: string; creci?: string; imobiliaria?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, chave("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // só admin (verify_jwt desligado: a checagem é feita aqui, também funciona com as chaves novas)
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: quem } = await admin.auth.getUser(jwt);
  if (!quem?.user) return json({ erro: "Faça login como administrador" }, 401);
  const { data: perfil } = await admin.from("profiles").select("papel").eq("id", quem.user.id).maybeSingle();
  if (perfil?.papel !== "admin") return json({ erro: "Apenas administradores podem convidar parceiros" }, 403);

  const { parceiros, enviarEmail = false, origem } = await req.json().catch(() => ({})) as
    { parceiros?: Parceiro[]; enviarEmail?: boolean; origem?: string };
  if (!Array.isArray(parceiros) || parceiros.length === 0) return json({ erro: "Nenhum parceiro informado" }, 400);
  if (parceiros.length > 200) return json({ erro: "Máximo de 200 parceiros por vez" }, 400);
  const base = origem && ORIGENS.some((r) => r.test(origem)) ? origem : "https://arkenincorporadora.com.br";
  const redirectTo = `${base}/parceiros/nova-senha`;

  const resultados = [];
  for (const p of parceiros) {
    const email = (p.email ?? "").trim().toLowerCase();
    const nome = (p.nome ?? "").trim();
    const base = { email, nome, telefone: p.telefone?.trim() || null };
    if (!EMAIL.test(email)) { resultados.push({ ...base, status: "erro", erro: "E-mail inválido" }); continue; }

    const dados = { nome, telefone: p.telefone?.trim() || null, creci: p.creci?.trim() || null, imobiliaria: p.imobiliaria?.trim() || null };
    const r = enviarEmail
      ? await admin.auth.admin.inviteUserByEmail(email, { data: dados, redirectTo })
      : await admin.auth.admin.generateLink({ type: "invite", email, options: { data: dados, redirectTo } });

    if (r.error) {
      const jaExiste = /already|registered|exists/i.test(r.error.message);
      resultados.push({ ...base, status: jaExiste ? "ja_existe" : "erro", erro: jaExiste ? "Já tem conta — use \"Esqueci a senha\"" : r.error.message });
      continue;
    }
    // convidado pela Arken já entra aprovado
    await admin.from("profiles").update({ status_parceiro: "aprovado" }).eq("id", r.data.user!.id);
    const link = "properties" in r.data ? r.data.properties?.action_link : undefined;
    resultados.push({ ...base, status: "convidado", link: enviarEmail ? undefined : link });
  }
  return json({ resultados });
});

// Formulário de contato do site: valida o Cloudflare Turnstile e grava o lead com a service role
// (o insert direto em public.leads foi revogado para anon/authenticated — ver migration _leads_via_funcao).
// POST { nome, telefone, email?, mensagem?, empreendimento_id?, captcha } -> { ok: true }
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

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function captchaValido(token: string, ip: string | null) {
  const segredo = Deno.env.get("TURNSTILE_SECRET");
  if (!segredo) return true; // sem segredo configurado (dev): não bloqueia — configurar em produção
  if (!token) return false;
  const corpo = new FormData();
  corpo.append("secret", segredo);
  corpo.append("response", token);
  if (ip) corpo.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: corpo });
  const dados = await r.json().catch(() => ({}));
  return dados.success === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  const corpo = await req.json().catch(() => ({}));
  const nome = texto(corpo.nome, 120);
  const telefone = texto(corpo.telefone, 30);
  const email = texto(corpo.email, 160).toLowerCase();
  const mensagem = texto(corpo.mensagem, 2000);
  const empreendimentoId = UUID.test(String(corpo.empreendimento_id ?? "")) ? corpo.empreendimento_id : null;

  if (nome.length < 2) return json({ erro: "Informe seu nome" }, 400);
  if (telefone.replace(/\D/g, "").length < 10) return json({ erro: "Telefone inválido" }, 400);
  if (email && !EMAIL.test(email)) return json({ erro: "E-mail inválido" }, 400);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  if (!(await captchaValido(texto(corpo.captcha, 2048), ip))) {
    return json({ erro: "Não conseguimos confirmar que você não é um robô. Recarregue a página e tente de novo." }, 403);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, chave("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.from("leads").insert({
    nome, telefone, email: email || null, mensagem: mensagem || null,
    empreendimento_id: empreendimentoId, origem: empreendimentoId ? "pagina_empreendimento" : "site",
  });
  if (error) return json({ erro: "Não foi possível enviar agora" }, 500);
  return json({ ok: true });
});

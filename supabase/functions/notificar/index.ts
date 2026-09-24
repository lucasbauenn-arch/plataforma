// Chamada pelos gatilhos do banco (migration _notificacoes) via pg_net. Envia e-mail pelo Resend:
//   admin ← novo parceiro, nova proposta, novo lead · parceiro ← proposta com novo status/resposta
// Segredos: WEBHOOK_SECRET (igual ao 'notificar_secret' do Vault), RESEND_API_KEY, NOTIFICAR_PARA (e-mails da equipe,
// separados por vírgula), NOTIFICAR_REMETENTE, SITE_URL. Sem RESEND_API_KEY só registra no log.
import { createClient } from "npm:@supabase/supabase-js@2";

type Registro = Record<string, unknown>;
type Evento = { tabela: string; evento: "INSERT" | "UPDATE"; registro: Registro; anterior: Registro | null };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const chave = (novas: string, legada: string) => {
  try {
    const k = JSON.parse(Deno.env.get(novas) ?? "{}").default;
    if (k) return k as string;
  } catch { /* usa a legada */ }
  return Deno.env.get(legada)!;
};

const SITE = Deno.env.get("SITE_URL") ?? "https://arkenincorporadora.com.br";
const PARA_EQUIPE = (Deno.env.get("NOTIFICAR_PARA") ?? "vendas@arkenincorporadora.com.br").split(",").map((s) => s.trim()).filter(Boolean);
const REMETENTE = Deno.env.get("NOTIFICAR_REMETENTE") ?? "Arken Incorporadora <nao-responda@arkenincorporadora.com.br>";
const STATUS: Record<string, string> = { enviada: "Enviada", em_analise: "Em análise", aprovada: "Aprovada", recusada: "Recusada" };

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const linhas = (pares: [string, unknown][]) =>
  pares.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b6760">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("");

function email(titulo: string, corpo: string, botao?: { texto: string; url: string }) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px 16px;background:#f5f1ea;font-family:Jost,Arial,Helvetica,sans-serif;color:#15181d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;padding:28px">
<tr><td style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b0703f;font-weight:700">Arken Incorporadora</td></tr>
<tr><td style="padding-top:8px;font-size:24px;font-weight:500">${esc(titulo)}</td></tr>
<tr><td style="padding-top:16px;font-size:15px;line-height:1.6">${corpo}</td></tr>
${botao ? `<tr><td style="padding-top:24px"><a href="${botao.url}" style="display:inline-block;background:#15181d;color:#fff;text-decoration:none;padding:12px 24px;font-weight:700;font-size:14px">${esc(botao.texto)}</a></td></tr>` : ""}
</table></body></html>`;
}

async function enviar(para: string[], assunto: string, html: string) {
  const chaveResend = Deno.env.get("RESEND_API_KEY");
  if (!chaveResend || para.length === 0) {
    console.log(`[sem envio] ${assunto} → ${para.join(", ") || "(ninguém)"}`);
    return { enviado: false };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chaveResend}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: REMETENTE, to: para, subject: assunto, html }),
  });
  if (!r.ok) console.error(`Resend ${r.status}: ${await r.text()}`);
  return { enviado: r.ok };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);
  const segredo = Deno.env.get("WEBHOOK_SECRET");
  if (!segredo || req.headers.get("x-webhook-secret") !== segredo) return json({ erro: "Não autorizado" }, 401);

  const { tabela, evento, registro: r, anterior } = (await req.json()) as Evento;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, chave("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const nomeEmp = async (id: unknown) =>
    id ? ((await db.from("empreendimentos").select("nome").eq("id", id).maybeSingle()).data?.nome ?? null) : null;

  if (tabela === "profiles" && evento === "INSERT") {
    return json(await enviar(PARA_EQUIPE, `Novo parceiro aguardando aprovação: ${r.nome || r.email}`, email(
      "Novo parceiro cadastrado",
      `<p>Um corretor se cadastrou na área do parceiro e aguarda aprovação.</p><table>${linhas([
        ["Nome", r.nome], ["E-mail", r.email], ["Telefone", r.telefone], ["CRECI", r.creci], ["Imobiliária", r.imobiliaria],
      ])}</table>`,
      { texto: "Aprovar no painel", url: `${SITE}/admin/parceiros` },
    )));
  }

  if (tabela === "leads" && evento === "INSERT") {
    const emp = await nomeEmp(r.empreendimento_id);
    const tel = String(r.telefone ?? "").replace(/\D/g, "");
    return json(await enviar(PARA_EQUIPE, `Novo contato pelo site${emp ? ` — ${emp}` : ""}: ${r.nome}`, email(
      "Novo contato pelo site",
      `<table>${linhas([["Nome", r.nome], ["Telefone", r.telefone], ["E-mail", r.email], ["Empreendimento", emp], ["Mensagem", r.mensagem]])}</table>`,
      tel ? { texto: "Responder no WhatsApp", url: `https://wa.me/55${tel}` } : { texto: "Ver leads", url: `${SITE}/admin/leads` },
    )));
  }

  if (tabela === "propostas") {
    const [emp, { data: parceiro }] = await Promise.all([
      nomeEmp(r.empreendimento_id),
      db.from("profiles").select("nome, email").eq("id", r.parceiro_id).maybeSingle(),
    ]);
    if (evento === "INSERT") {
      return json(await enviar(PARA_EQUIPE, `Nova proposta de ${parceiro?.nome || parceiro?.email} — ${emp}`, email(
        "Nova proposta de parceiro",
        `<table>${linhas([["Parceiro", parceiro?.nome], ["E-mail", parceiro?.email], ["Empreendimento", emp]])}</table><p style="white-space:pre-wrap">${esc(r.texto)}</p>`,
        { texto: "Responder no painel", url: `${SITE}/admin/propostas` },
      )));
    }
    // UPDATE: avisa o parceiro (status ou resposta mudou)
    if (!parceiro?.email) return json({ enviado: false, motivo: "parceiro sem e-mail" });
    const status = STATUS[String(r.status)] ?? r.status;
    const mudouStatus = anterior?.status !== r.status;
    return json(await enviar([parceiro.email], `Sua proposta para ${emp}: ${status}`, email(
      mudouStatus ? `Proposta ${String(status).toLowerCase()}` : "Nova resposta na sua proposta",
      `<p>Olá${parceiro.nome ? `, ${esc(String(parceiro.nome).split(" ")[0])}` : ""}! Sua proposta para <strong>${esc(emp)}</strong> está <strong>${esc(status)}</strong>.</p>` +
        (r.resposta_admin ? `<p style="white-space:pre-wrap;background:#f5f1ea;padding:12px">${esc(r.resposta_admin)}</p>` : ""),
      { texto: "Ver minhas propostas", url: `${SITE}/parceiros/painel/propostas` },
    )));
  }

  return json({ enviado: false, motivo: "evento ignorado" });
});

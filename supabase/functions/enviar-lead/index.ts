// Formulário de contato do site: valida o Cloudflare Turnstile e grava o lead com a service role
// (o insert direto em public.leads foi revogado para anon/authenticated — ver migration _leads_via_funcao).
// POST { nome, telefone, email?, mensagem?, empreendimento_id?, captcha } -> { ok: true }
// Mesmo padrão das funções públicas novas (pre-cadastro), WP7R1-05: CORS só do site, corpo com limite de tamanho e JSON,
// limite por IP em tentativas_publicas, com reserva atômica no banco (10 erros ou 20 envios em 15 min → 429) e
// Turnstile com falha FECHADA em produção (sem TURNSTILE_SECRET a função recusa com 503 em vez de liberar; fora de
// produção dispensa, para o desenvolvimento local).
import { criarRota, ipCliente, lerJson } from "../_shared/http.ts";
import { corsDoSite, validarCaptcha } from "../_shared/ambiente.ts";
import { MENSAGEM_TURNSTILE, statusFalhaTurnstile } from "../_shared/turnstile.ts";
import { REGRA_ENVIAR_LEAD, reservarTentativa, respostaDoBloqueio } from "../_shared/limite-ip.ts";
import { armazemTentativas, clienteAdmin } from "../_shared/supabase.ts";

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(criarRota({ nome: "enviar-lead", cors: corsDoSite() }, async (req, r) => {
  const ip = ipCliente(req);
  const armazem = armazemTentativas();
  // reserva atômica (FR1-01): conferir e gravar num passo só, no banco; uma rajada simultânea não passa do limite.
  // A reserva já vale como falha; só o envio aceito a confirma como sucesso.
  const limite = await reservarTentativa(armazem, [{ regra: REGRA_ENVIAR_LEAD, ip }]);
  if (!limite.permitido) {
    const b = respostaDoBloqueio(limite, REGRA_ENVIAR_LEAD);
    return r.erro(b.status, b.mensagem, { codigo: b.codigo, cabecalhos: b.cabecalhos });
  }
  const registrar = (sucesso: boolean) => limite.concluir(sucesso);
  const falhar = async (resposta: Response) => {
    await registrar(false);
    return resposta;
  };

  const corpo = await lerJson(req);
  if (!corpo.ok) return falhar(r.erro(corpo.status, corpo.erro, { codigo: corpo.codigo }));
  const c = corpo.valor;

  const nome = texto(c.nome, 120);
  const telefone = texto(c.telefone, 30);
  const email = texto(c.email, 160).toLowerCase();
  const mensagem = texto(c.mensagem, 2000);
  const empreendimentoId = UUID.test(String(c.empreendimento_id ?? "")) ? String(c.empreendimento_id) : null;

  if (nome.length < 2) return falhar(r.erro(400, "Informe seu nome"));
  if (telefone.replace(/\D/g, "").length < 10) return falhar(r.erro(400, "Telefone inválido"));
  if (email && !EMAIL.test(email)) return falhar(r.erro(400, "E-mail inválido"));

  const captcha = await validarCaptcha(texto(c.captcha, 2048), ip);
  if (!captcha.ok) return falhar(r.erro(statusFalhaTurnstile(captcha), MENSAGEM_TURNSTILE));

  const { error } = await clienteAdmin().from("leads").insert({
    nome, telefone, email: email || null, mensagem: mensagem || null,
    empreendimento_id: empreendimentoId, origem: empreendimentoId ? "pagina_empreendimento" : "site",
  });
  if (error) return falhar(r.erro(500, "Não foi possível enviar agora"));
  await registrar(true);
  return r.json({ ok: true });
}));

// Chamada pelos gatilhos do banco via pg_net (notificar_evento, migration 20260921000005) e pelo pg_cron
// (notificacoes_reenviar, a cada 10 min). Envia e-mail pelo Resend.
//   gatilhos atuais (sem mudança de regra): admin ← novo parceiro, nova proposta, novo lead · parceiro ← proposta com
//   novo status/resposta
//   fila `notificacoes` (docs/ARQUITETURA_EXPANSAO.md §6.6): os tipos de notificacoes_config. Para cada linha:
//     1. reserva (tentativas + 1 e reservado_em, comparando com o valor lido: gatilho e reenvio nunca mandam duas vezes);
//     2. resolve os destinatários pelos ids (perfis) ou, com destinatários vazios, o e-mail do próprio cliente
//        (consentimento revogado ou titular anonimizado → 'ignorado', sem envio); a confirmação do pré-cadastro
//        (crm.boas_vindas sem cliente, dados.aviso_id) vai para o e-mail digitado, lido de pre_cadastro_avisos e
//        apagado quando a linha termina;
//     3. monta o modelo (notificar/modelos.ts: só ids nos dados; nada de nome de terceiro);
//     4. envia um e-mail por destinatário (ninguém vê o endereço de outro) e marca o status.
//   Resend não configurado ou domínio ainda não verificado (401/403): a linha volta para a fila sem gastar tentativa e
//   sai sozinha depois; mensagem com mais de 7 dias não sai mais ('ignorado') ⚑.
// Segredos: WEBHOOK_SECRET (igual ao 'notificar_secret' do Vault), RESEND_API_KEY, NOTIFICAR_PARA (e-mails da equipe,
// separados por vírgula), NOTIFICAR_REMETENTE, SITE_URL. Sem RESEND_API_KEY os gatilhos antigos só registram no log.
// RESEND_URL (opcional, só fora de produção): simulador local do Resend da stack de teste (modelos.ts, urlResend).
import { type SupabaseClient } from "../_shared/supabase-js.ts";
import { criarRota, lerJson, mensagemSegura, type Respostas } from "../_shared/http.ts";
import { iguaisTempoConstante } from "../_shared/chaves.ts";
import { emProducao, lerEnv } from "../_shared/ambiente.ts";
import { clienteAdmin } from "../_shared/supabase.ts";
import {
  type DadosModelo, emailValido, esc, ehTipoFila, falhaDeConfiguracao, layoutEmail, montarEmail, primeiroNome, type Publico,
  urlResend, VALIDADE_FILA_MS,
} from "./modelos.ts";

type Registro = Record<string, unknown>;

const SITE = (lerEnv("SITE_URL") ?? "https://arkenincorporadora.com.br").replace(/\/+$/, "");
const PARA_EQUIPE = (lerEnv("NOTIFICAR_PARA") ?? "vendas@arkenincorporadora.com.br").split(",").map((s) => s.trim()).filter(Boolean);
const REMETENTE = lerEnv("NOTIFICAR_REMETENTE") ?? "Arken Incorporadora <nao-responda@arkenincorporadora.com.br>";
// nulo = RESEND_URL fora do permitido: nada é enviado (falha de configuração, a linha fica na fila)
const URL_ENVIO = urlResend(lerEnv("RESEND_URL"), emProducao());
const STATUS: Record<string, string> = { enviada: "Enviada", em_analise: "Em análise", aprovada: "Aprovada", recusada: "Recusada" };
const DOMINIO_PORTAL = "@portal.arkenincorporadora.com.br";
const MAX_TENTATIVAS = 5;
const RESERVA_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const linhas = (pares: [string, unknown][]) =>
  pares.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b6760">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("");

type ResultadoEnvio = { ok: boolean; status: number | null; erro: string | null; duracaoMs: number };

async function enviar(para: string[], assunto: string, html: string): Promise<ResultadoEnvio> {
  const chaveResend = lerEnv("RESEND_API_KEY");
  if (!chaveResend || !URL_ENVIO || para.length === 0) {
    const motivo = !chaveResend ? "RESEND_API_KEY ausente" : !URL_ENVIO ? "RESEND_URL inválida" : "sem destinatário";
    console.log(`[notificar] sem envio (${motivo}): ${assunto.slice(0, 80)}`);
    return { ok: false, status: null, erro: motivo, duracaoMs: 0 };
  }
  const inicio = Date.now();
  try {
    const r = await fetch(URL_ENVIO, {
      method: "POST",
      headers: { Authorization: `Bearer ${chaveResend}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: REMETENTE, to: para, subject: assunto, html }),
    });
    const duracaoMs = Date.now() - inicio;
    if (r.ok) return { ok: true, status: r.status, erro: null, duracaoMs };
    // só o NOME do erro do Resend (a mensagem pode trazer o endereço do destinatário)
    const nome = await r.json().then((j: { name?: unknown }) => (typeof j?.name === "string" ? j.name.slice(0, 80) : null)).catch(() => null);
    console.error(`[notificar] Resend ${r.status}${nome ? ` (${nome})` : ""}`);
    return { ok: false, status: r.status, erro: `Resend ${r.status}${nome ? ` ${nome}` : ""}`, duracaoMs };
  } catch (e) {
    console.error(`[notificar] Resend indisponível: ${mensagemSegura(e)}`);
    return { ok: false, status: 0, erro: "Resend indisponível", duracaoMs: Date.now() - inicio };
  }
}

const idsDe = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v]).filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 50);

// ============ fila `notificacoes` ============

type LinhaFila = {
  id: number; tipo: string; destinatarios_ids: string[] | null; cliente_id: string | null; dados: Registro | null;
  status: string; tentativas: number; criado_em: string; reservado_em: string | null;
};
type Destinatario = { email: string; publico: Publico; primeiroNome: string | null };
type ClienteFila = { id: string; nome: string | null; email: string | null; portal_liberado: boolean; corretor_id: string | null };
/** `pre_cadastro_avisos` (migration do WP2): o e-mail digitado no pré-cadastro, só para a confirmação. */
type AvisoPreCadastro = { id: string; email: unknown; primeiro_nome: string | null; parceiro_id: string; portal: boolean };

async function processarFila(db: SupabaseClient, registro: Registro, r: Respostas): Promise<Response> {
  const id = Number(registro.id);
  if (!Number.isSafeInteger(id) || id <= 0) return r.json({ enviado: false, motivo: "registro inválido" });

  // 1. reserva (compare-and-set em tentativas e reservado_em)
  const { data: lida, error: erroLeitura } = await db.from("notificacoes")
    .select("id, tipo, destinatarios_ids, cliente_id, dados, status, tentativas, criado_em, reservado_em").eq("id", id).maybeSingle();
  if (erroLeitura) throw new Error(`notificacoes: ${erroLeitura.message}`);
  const n = lida as LinhaFila | null;
  if (!n) return r.json({ enviado: false, motivo: "inexistente" });
  const agora = Date.now();
  if (!["pendente", "erro"].includes(n.status) || n.tentativas >= MAX_TENTATIVAS) return r.json({ enviado: false, motivo: "fora da fila" });
  if (n.reservado_em && Date.parse(n.reservado_em) > agora - RESERVA_MS) return r.json({ enviado: false, motivo: "reservada" });
  let reserva = db.from("notificacoes")
    .update({ tentativas: n.tentativas + 1, reservado_em: new Date(agora).toISOString() })
    .eq("id", id).eq("tentativas", n.tentativas).in("status", ["pendente", "erro"]);
  reserva = n.reservado_em ? reserva.eq("reservado_em", n.reservado_em) : reserva.is("reservado_em", null);
  const { data: reservadas, error: erroReserva } = await reserva.select("id");
  if (erroReserva) throw new Error(`notificacoes (reserva): ${erroReserva.message}`);
  if (!reservadas?.length) return r.json({ enviado: false, motivo: "reservada" });

  const dados = (n.dados ?? {}) as Registro;
  // confirmação do pré-cadastro (crm.boas_vindas do WP2): o e-mail DIGITADO fica em pre_cadastro_avisos (só a service
  // role lê e apaga) e a fila guarda só o id, igual para cadastro criado e duplicado (§6.1); apagado quando a linha
  // termina (enviada, ignorada ou sem mais tentativas)
  const idAviso = n.tipo === "crm.boas_vindas" ? idsDe(dados.aviso_id)[0] ?? null : null;

  // `opcoes.devolverTentativa`: falha de configuração do Resend não gasta tentativa; `opcoes.destinatarios` vai só para
  // o registro de auditoria (a fila não tem essa coluna)
  const concluir = async (
    status: "enviado" | "erro" | "ignorado" | "pendente", ultimoErro: string | null,
    opcoes: { devolverTentativa?: boolean; destinatarios?: number } = {},
  ) => {
    const patch: Registro = { status, ultimo_erro: ultimoErro ? ultimoErro.slice(0, 2000) : null, reservado_em: null };
    if (status === "enviado") patch.enviado_em = new Date().toISOString();
    if (opcoes.devolverTentativa) patch.tentativas = n.tentativas;
    const { error } = await db.from("notificacoes").update(patch).eq("id", id);
    if (error) console.error(`[notificar] notificacoes ${id}: ${error.message}`);
    const final = status === "enviado" || status === "ignorado" || (status === "erro" && n.tentativas + 1 >= MAX_TENTATIVAS);
    if (idAviso && final) {
      const { error: e } = await db.from("pre_cadastro_avisos").delete().eq("id", idAviso);
      if (e) console.error(`[notificar] pre_cadastro_avisos: ${e.message}`);
    }
    await db.from("auditoria").insert({
      categoria: "integracao", acao: "enviar_email", entidade: "notificacoes", entidade_id: String(id), cliente_id: n.cliente_id,
      origem: "edge:notificar",
      detalhe: { tipo: n.tipo, resultado: status, tentativa: n.tentativas + 1, ...(opcoes.destinatarios ? { destinatarios: opcoes.destinatarios } : {}) },
    }).then(({ error: e }) => { if (e) console.error(`[notificar] auditoria: ${e.message}`); });
    return r.json({ enviado: status === "enviado", status });
  };
  const ignorar = (motivo: string) => concluir("ignorado", motivo);

  if (Date.parse(n.criado_em) < agora - VALIDADE_FILA_MS) return ignorar("expirada (mais de 7 dias na fila)");
  if (!ehTipoFila(n.tipo)) return ignorar("tipo sem modelo");
  const tipo = n.tipo;
  const { data: cfg } = await db.from("notificacoes_config").select("ativo").eq("tipo", tipo).maybeSingle();
  if (!(cfg as { ativo?: boolean } | null)?.ativo) return ignorar("tipo desligado");

  // 2. destinatários
  const destinatarios: Destinatario[] = [];
  let cliente: ClienteFila | null = null;
  let aviso: AvisoPreCadastro | null = null;
  const ids = idsDe(n.destinatarios_ids);
  if (ids.length > 0) {
    const { data: perfis, error } = await db.from("profiles")
      .select("id, email, nome, papel, status_parceiro, inativado_em").in("id", ids);
    if (error) throw new Error(`profiles: ${error.message}`);
    for (const p of (perfis ?? []) as { email: unknown; nome: unknown; papel: string; status_parceiro: string; inativado_em: string | null }[]) {
      if (!emailValido(p.email) || p.email.toLowerCase().endsWith(DOMINIO_PORTAL) || p.papel === "cliente" || p.papel === "colaborador") continue;
      if (p.inativado_em || p.status_parceiro === "inativo") continue;
      const interno = p.papel === "admin" || p.papel === "super";
      if (!interno && p.status_parceiro !== "aprovado") continue;
      destinatarios.push({ email: p.email, publico: interno ? "admin" : "painel", primeiroNome: primeiroNome(p.nome) });
    }
  } else if (n.cliente_id) {
    const { data: c, error } = await db.from("clientes")
      .select("id, nome, email, portal_liberado, corretor_id, anonimizado_em").eq("id", n.cliente_id).maybeSingle();
    if (error) throw new Error(`clientes: ${error.message}`);
    const linha = c as (ClienteFila & { anonimizado_em: string | null }) | null;
    if (!linha || linha.anonimizado_em) return ignorar("titular anonimizado");
    const { data: consent } = await db.from("lgpd_consentimentos").select("revogado_em").eq("cliente_id", n.cliente_id);
    const lista = (consent ?? []) as { revogado_em: string | null }[];
    if (lista.length > 0 && lista.every((x) => x.revogado_em)) return ignorar("consentimento revogado");
    if (!emailValido(linha.email)) return ignorar("cliente sem e-mail");
    cliente = linha;
    destinatarios.push({ email: linha.email, publico: "cliente", primeiroNome: primeiroNome(linha.nome) });
  } else if (idAviso) {
    const { data: a, error } = await db.from("pre_cadastro_avisos")
      .select("id, email, primeiro_nome, parceiro_id, portal").eq("id", idAviso).maybeSingle();
    if (error) throw new Error(`pre_cadastro_avisos: ${error.message}`);
    aviso = a as AvisoPreCadastro | null;
    if (!aviso) return ignorar("aviso do pré-cadastro expirado");
    if (!emailValido(aviso.email)) return ignorar("aviso sem e-mail válido");
    destinatarios.push({ email: aviso.email, publico: "cliente", primeiroNome: primeiroNome(aviso.primeiro_nome) });
  }
  if (destinatarios.length === 0) return ignorar("sem destinatário com e-mail");

  // 3. dados do modelo (só ids em `dados`; o resto é lido aqui e conferido contra o cliente da linha)
  const comum: Omit<DadosModelo, "publico" | "primeiroNome"> = { site: SITE, portalLiberado: !!cliente?.portal_liberado || !!aviso?.portal };
  const idsDocs = idsDe(dados.documento_ids ?? dados.documento_id);
  if (idsDocs.length > 0) {
    const { data: docs } = await db.from("cliente_documentos")
      .select("id, nome, motivo_rejeicao, cliente_id, status, inativado_em").in("id", idsDocs);
    comum.documentos = ((docs ?? []) as { nome: string; motivo_rejeicao: string | null; cliente_id: string; status: string; inativado_em: string | null }[])
      .filter((d) => !d.inativado_em && (!n.cliente_id || d.cliente_id === n.cliente_id))
      .filter((d) => (tipo === "crm.documento_rejeitado" ? d.status === "rejeitado" : tipo === "crm.documento_solicitado" ? ["pendente", "rejeitado"].includes(d.status) : true))
      .map((d) => ({ nome: d.nome, motivo: d.motivo_rejeicao }));
  }
  const idContrato = idsDe(dados.contrato_id)[0];
  if (idContrato) {
    const { data: k } = await db.from("contratos").select("id, codigo, cliente_id").eq("id", idContrato).maybeSingle();
    const contrato = k as { id: string; codigo: number; cliente_id: string } | null;
    if (contrato && (!n.cliente_id || contrato.cliente_id === n.cliente_id)) {
      comum.contratoId = contrato.id;
      comum.contratoCodigo = contrato.codigo;
    }
  }
  comum.clienteId = idsDe(dados.cliente_id)[0] ?? null;
  const qtd = Number(dados.quantidade);
  comum.quantidade = Number.isInteger(qtd) && qtd > 0 ? qtd : idsDe(dados.cliente_ids).length || null;
  const corretorBoasVindas = cliente?.corretor_id ?? aviso?.parceiro_id ?? null;
  if (tipo === "crm.boas_vindas" && corretorBoasVindas) {
    const { data: cor } = await db.from("parceiros").select("nome, virtual").eq("id", corretorBoasVindas).maybeSingle();
    const c = cor as { nome: string; virtual: boolean } | null;
    comum.corretorNome = c && !c.virtual ? c.nome : null;
  }

  // 4. envio (um por destinatário)
  let enviados = 0;
  let falhaConfig: string | null = null;
  let falhaOutra: string | null = null;
  let semModelo = 0;
  for (const d of destinatarios) {
    const email = montarEmail(tipo, { ...comum, publico: d.publico, primeiroNome: d.primeiroNome });
    if (!email) { semModelo++; continue; }
    const res = await enviar([d.email], email.assunto, email.html);
    await db.from("integracao_chamadas").insert({
      provedor: "resend", operacao: tipo, entidade: "notificacoes", http_status: res.status, duracao_ms: res.duracaoMs, erro: res.erro,
    }).then(({ error }) => { if (error) console.error(`[notificar] integracao_chamadas: ${error.message}`); });
    if (res.ok) enviados++;
    else if (falhaDeConfiguracao(res.status)) falhaConfig = res.erro;
    else falhaOutra = res.erro;
  }
  if (semModelo === destinatarios.length) return ignorar("nada a enviar para este público");
  // parcial: marca enviado (repetir mandaria de novo a quem já recebeu) e guarda a falha
  if (enviados > 0) return concluir("enviado", falhaConfig ?? falhaOutra, { destinatarios: enviados });
  if (falhaConfig) return concluir("pendente", falhaConfig, { devolverTentativa: true });   // sem gastar tentativa
  return concluir("erro", falhaOutra ?? "falha no envio");
}

// ============ gatilhos atuais (profiles, leads, propostas) ============

async function processarGatilho(db: SupabaseClient, tabela: string, evento: string, r0: Registro, anterior: Registro | null, r: Respostas) {
  const nomeEmp = async (id: unknown) =>
    id ? ((await db.from("empreendimentos").select("nome").eq("id", id).maybeSingle()).data?.nome ?? null) : null;

  if (tabela === "profiles" && evento === "INSERT") {
    const res = await enviar(PARA_EQUIPE, `Novo parceiro aguardando aprovação: ${r0.nome || r0.email}`, layoutEmail(
      "Novo parceiro cadastrado",
      `<p>Um corretor se cadastrou na área do parceiro e aguarda aprovação.</p><table>${linhas([
        ["Nome", r0.nome], ["E-mail", r0.email], ["Telefone", r0.telefone], ["CRECI", r0.creci], ["Imobiliária", r0.imobiliaria],
      ])}</table>`,
      { texto: "Aprovar no painel", url: `${SITE}/admin/rede/pendentes` },
    ));
    return r.json({ enviado: res.ok });
  }

  if (tabela === "leads" && evento === "INSERT") {
    const emp = await nomeEmp(r0.empreendimento_id);
    const tel = String(r0.telefone ?? "").replace(/\D/g, "");
    const res = await enviar(PARA_EQUIPE, `Novo contato pelo site${emp ? ` — ${emp}` : ""}: ${r0.nome}`, layoutEmail(
      "Novo contato pelo site",
      `<table>${linhas([["Nome", r0.nome], ["Telefone", r0.telefone], ["E-mail", r0.email], ["Empreendimento", emp], ["Mensagem", r0.mensagem]])}</table>`,
      tel ? { texto: "Responder no WhatsApp", url: `https://wa.me/55${tel}` } : { texto: "Ver leads", url: `${SITE}/admin/leads` },
    ));
    return r.json({ enviado: res.ok });
  }

  if (tabela === "propostas") {
    const [emp, { data: parceiro }] = await Promise.all([
      nomeEmp(r0.empreendimento_id),
      db.from("profiles").select("nome, email").eq("id", r0.parceiro_id).maybeSingle(),
    ]);
    if (evento === "INSERT") {
      const res = await enviar(PARA_EQUIPE, `Nova proposta de ${parceiro?.nome || parceiro?.email} — ${emp}`, layoutEmail(
        "Nova proposta de parceiro",
        `<table>${linhas([["Parceiro", parceiro?.nome], ["E-mail", parceiro?.email], ["Empreendimento", emp]])}</table><p style="white-space:pre-wrap">${esc(r0.texto)}</p>`,
        { texto: "Responder no painel", url: `${SITE}/admin/propostas` },
      ));
      return r.json({ enviado: res.ok });
    }
    // UPDATE: avisa o parceiro (status ou resposta mudou)
    if (!parceiro?.email) return r.json({ enviado: false, motivo: "parceiro sem e-mail" });
    const status = STATUS[String(r0.status)] ?? r0.status;
    const mudouStatus = anterior?.status !== r0.status;
    const res = await enviar([parceiro.email], `Sua proposta para ${emp}: ${status}`, layoutEmail(
      mudouStatus ? `Proposta ${String(status).toLowerCase()}` : "Nova resposta na sua proposta",
      `<p>Olá${parceiro.nome ? `, ${esc(String(parceiro.nome).split(" ")[0])}` : ""}! Sua proposta para <strong>${esc(emp)}</strong> está <strong>${esc(status)}</strong>.</p>` +
        (r0.resposta_admin ? `<p style="white-space:pre-wrap;background:#f5f1ea;padding:12px">${esc(r0.resposta_admin)}</p>` : ""),
      { texto: "Ver minhas propostas", url: `${SITE}/parceiros/painel/propostas` },
    ));
    return r.json({ enviado: res.ok });
  }

  return r.json({ enviado: false, motivo: "evento ignorado" });
}

// ============ rota (só entre servidores: sem CORS) ============

Deno.serve(criarRota({ nome: "notificar" }, async (req, r) => {
  // comparação em tempo constante; sem exigir tamanho mínimo para não parar as notificações com o segredo atual
  // (trocar por um de 16+ caracteres no runbook e passar a cabecalhoSecretoConfere)
  const segredo = lerEnv("WEBHOOK_SECRET");
  const recebido = req.headers.get("x-webhook-secret") ?? "";
  if (!segredo || !recebido || !iguaisTempoConstante(recebido, segredo)) return r.erro(401, "Não autorizado");

  const corpo = await lerJson(req, { limiteBytes: 256 * 1024 });
  if (!corpo.ok) return r.erro(corpo.status, corpo.erro, { codigo: corpo.codigo });
  const { tabela, evento, registro, anterior } = corpo.valor as { tabela?: unknown; evento?: unknown; registro?: unknown; anterior?: unknown };
  if (typeof tabela !== "string" || typeof registro !== "object" || registro === null) return r.erro(400, "Evento inválido");
  const db = clienteAdmin();

  if (tabela === "notificacoes") return await processarFila(db, registro as Registro, r);
  return await processarGatilho(db, tabela, String(evento ?? ""), registro as Registro,
    typeof anterior === "object" && anterior !== null ? anterior as Registro : null, r);
}));

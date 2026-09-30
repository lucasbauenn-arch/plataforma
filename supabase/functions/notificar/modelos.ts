// Modelos dos e-mails da função notificar (docs/ARQUITETURA_EXPANSAO.md §6.6). Módulo PURO: sem Deno.*, sem npm:,
// sem rede — recebe os dados já resolvidos pelo index.ts (só o que o destinatário pode ver) e devolve assunto e HTML.
// Layout retangular de hoje (cantos retos, Jost, sem imagem), com todo conteúdo variável escapado (SEG-6).

export type TipoFila =
  | "crm.boas_vindas" | "crm.documento_rejeitado" | "crm.documento_solicitado" | "crm.novo_lead_corretor"
  | "contratos.enviado" | "contratos.assinado" | "rede.transferencia";

export const TIPOS_FILA: readonly TipoFila[] = [
  "crm.boas_vindas", "crm.documento_rejeitado", "crm.documento_solicitado", "crm.novo_lead_corretor",
  "contratos.enviado", "contratos.assinado", "rede.transferencia",
];

export const ehTipoFila = (t: unknown): t is TipoFila => typeof t === "string" && (TIPOS_FILA as readonly string[]).includes(t);

/** Para quem vai: o próprio cliente (destinatários vazios + cliente_id) ou perfis (parceiros e internos). */
export type Publico = "cliente" | "painel" | "admin";

export interface DadosModelo {
  site: string;
  publico: Publico;
  /** Primeiro nome de quem recebe (nunca o nome completo de terceiros). */
  primeiroNome?: string | null;
  /** Nome do corretor responsável (para o cliente); nulo = "nossa equipe". */
  corretorNome?: string | null;
  /** O cliente tem o portal liberado (link para enviar documentos). */
  portalLiberado?: boolean;
  documentos?: { nome: string; motivo?: string | null }[];
  contratoId?: string | null;
  contratoCodigo?: number | null;
  clienteId?: string | null;
  quantidade?: number | null;
}

export interface Email { assunto: string; html: string }

export const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Primeiro nome, sem espaços extras; vazio vira nulo. */
export const primeiroNome = (nome: unknown) => {
  const p = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p.slice(0, 60) : null;
};

export const codigoContrato = (n: number | null | undefined) => (n == null ? "" : `#${String(n).padStart(7, "0")}`);

const url = (site: string, caminho: string) => `${site.replace(/\/+$/, "")}${caminho}`;

/** Mesmo layout retangular dos e-mails atuais. `corpo` já vem escapado; o botão só aceita URL https do site. */
export function layoutEmail(titulo: string, corpo: string, botao?: { texto: string; url: string }) {
  const b = botao && /^https?:\/\//.test(botao.url)
    ? `<tr><td style="padding-top:24px"><a href="${esc(botao.url)}" style="display:inline-block;background:#15181d;color:#fff;text-decoration:none;padding:12px 24px;font-weight:700;font-size:14px">${esc(botao.texto)}</a></td></tr>`
    : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px 16px;background:#f5f1ea;font-family:Jost,Arial,Helvetica,sans-serif;color:#15181d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;padding:28px">
<tr><td style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b0703f;font-weight:700">Arken Incorporadora</td></tr>
<tr><td style="padding-top:8px;font-size:24px;font-weight:500">${esc(titulo)}</td></tr>
<tr><td style="padding-top:16px;font-size:15px;line-height:1.6">${corpo}</td></tr>
${b}
<tr><td style="padding-top:28px;font-size:12px;color:#6b6760">Esta é uma mensagem automática. Não responda este e-mail.</td></tr>
</table></body></html>`;
}

const ola = (nome?: string | null) => `<p>Olá${nome ? `, ${esc(nome)}` : ""}!</p>`;

const base = (p: Publico) => (p === "admin" ? "/admin" : "/parceiros/painel");

/** Assunto e HTML de cada tipo da fila. `null` = o tipo não se aplica a esse público (não envia). */
export function montarEmail(tipo: TipoFila, d: DadosModelo): Email | null {
  const docs = (d.documentos ?? []).filter((x) => x.nome);
  switch (tipo) {
    case "crm.boas_vindas": {
      if (d.publico !== "cliente") return null;
      const quem = d.corretorNome ? esc(d.corretorNome) : "nossa equipe";
      return {
        assunto: "Recebemos seu cadastro — Arken Incorporadora",
        html: layoutEmail("Cadastro recebido",
          `${ola(d.primeiroNome)}<p>Recebemos seu cadastro. Em breve ${quem} entra em contato para apresentar as opções.</p>`),
      };
    }
    case "crm.documento_rejeitado": {
      if (d.publico !== "cliente" || docs.length === 0) return null;
      const doc = docs[0];
      return {
        assunto: `Documento para reenviar: ${doc.nome.slice(0, 80)}`,
        html: layoutEmail("Precisamos de um novo envio",
          `${ola(d.primeiroNome)}<p>O documento <strong>${esc(doc.nome)}</strong> não pôde ser aprovado.</p>` +
            (doc.motivo ? `<p style="white-space:pre-wrap;background:#f5f1ea;padding:12px">${esc(doc.motivo)}</p>` : "") +
            (d.portalLiberado ? "<p>Envie uma nova versão pelo Portal do Cliente.</p>" : "<p>Envie uma nova versão para o seu corretor.</p>"),
          d.portalLiberado ? { texto: "Abrir o Portal do Cliente", url: url(d.site, "/portal-do-cliente") } : undefined),
      };
    }
    case "crm.documento_solicitado": {
      if (d.publico !== "cliente" || docs.length === 0) return null;
      const lista = docs.map((x) => `<li>${esc(x.nome)}</li>`).join("");
      return {
        assunto: docs.length === 1 ? `Documento solicitado: ${docs[0].nome.slice(0, 80)}` : "Documentos solicitados",
        html: layoutEmail(docs.length === 1 ? "Documento solicitado" : "Documentos solicitados",
          `${ola(d.primeiroNome)}<p>Para seguir com o seu atendimento, precisamos de:</p><ul style="padding-left:20px">${lista}</ul>` +
            (d.portalLiberado ? "<p>Você pode enviar pelo Portal do Cliente.</p>" : "<p>Envie para o seu corretor.</p>"),
          d.portalLiberado ? { texto: "Abrir o Portal do Cliente", url: url(d.site, "/portal-do-cliente") } : undefined),
      };
    }
    case "crm.novo_lead_corretor": {
      if (d.publico === "cliente") return null;
      // minimização: o nome do cliente não vai no e-mail, só o link para a ficha (que exige login e escopo)
      return {
        assunto: "Novo cliente na sua carteira",
        html: layoutEmail("Novo cliente na sua carteira",
          `${ola(d.primeiroNome)}<p>Um novo cliente entrou na sua carteira. Os dados estão no CRM.</p>`,
          { texto: "Abrir no CRM", url: url(d.site, d.clienteId ? `${base(d.publico)}/crm/${d.clienteId}` : `${base(d.publico)}/crm`) }),
      };
    }
    case "contratos.enviado":
    case "contratos.assinado": {
      const assinado = tipo === "contratos.assinado";
      const cod = codigoContrato(d.contratoCodigo);
      if (d.publico === "cliente") {
        return {
          assunto: assinado ? `Contrato ${cod} assinado` : `Contrato ${cod} enviado para assinatura`,
          html: layoutEmail(assinado ? "Contrato assinado" : "Contrato enviado para assinatura",
            `${ola(d.primeiroNome)}` + (assinado
              ? `<p>O contrato <strong>${esc(cod)}</strong> foi assinado por todas as partes.</p>` +
                (d.portalLiberado ? "<p>A via assinada fica disponível no Portal do Cliente.</p>" : "")
              : `<p>O contrato <strong>${esc(cod)}</strong> foi enviado para assinatura eletrônica. Você vai receber um e-mail da plataforma de assinatura com o link.</p>`),
            d.portalLiberado && assinado ? { texto: "Abrir o Portal do Cliente", url: url(d.site, "/portal-do-cliente") } : undefined),
        };
      }
      return {
        assunto: assinado ? `Contrato ${cod} assinado` : `Contrato ${cod} enviado para assinatura`,
        html: layoutEmail(assinado ? "Contrato assinado" : "Contrato enviado para assinatura",
          `${ola(d.primeiroNome)}<p>O contrato <strong>${esc(cod)}</strong> ${assinado ? "foi assinado por todas as partes" : "foi enviado para assinatura"}.</p>`,
          d.contratoId ? { texto: "Ver o contrato", url: url(d.site, `${base(d.publico)}/contratos/${d.contratoId}`) } : undefined),
      };
    }
    case "rede.transferencia": {
      if (d.publico === "cliente") return null;
      const n = d.quantidade && d.quantidade > 0 ? d.quantidade : null;
      return {
        assunto: "Transferência na sua carteira",
        html: layoutEmail("Transferência na sua carteira",
          `${ola(d.primeiroNome)}<p>Houve uma transferência que envolve a sua carteira${n ? `: ${n} cliente${n > 1 ? "s" : ""}` : ""}. Confira no CRM.</p>`,
          { texto: "Abrir o CRM", url: url(d.site, `${base(d.publico)}/crm/lista`) }),
      };
    }
  }
}

/** Resend recusou por configuração (chave inválida ou domínio ainda não verificado): a mensagem fica na fila. */
export const falhaDeConfiguracao = (status: number | null) => status === null || status === 401 || status === 403;

/** Endpoint de envio do Resend. */
export const URL_RESEND = "https://api.resend.com/emails";

/**
 * Hosts de um simulador local do Resend (stack local completa de teste, WP7): o e-mail "enviado" vai para o inbucket
 * local, nunca para fora. Na nuvem estes nomes não levam a lugar nenhum; em produção nunca valem.
 */
export const HOSTS_SIMULADOR_RESEND: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);

/**
 * Para onde enviar, a partir de RESEND_URL. Ausente: o Resend. Em produção a variável é ignorada (sempre o Resend).
 * Fora de produção só vale um simulador local (http ou https num host de HOSTS_SIMULADOR_RESEND, sem usuário, senha,
 * query nem fragmento); qualquer outro valor devolve nulo e nada é enviado (a linha volta para a fila como falha de
 * configuração, sem gastar tentativa), para um valor errado não mandar e-mail de verdade nem para um terceiro.
 */
export function urlResend(valor: string | null | undefined, emProducao: boolean): string | null {
  const v = (valor ?? "").trim();
  if (emProducao || !v) return URL_RESEND;
  try {
    const u = new URL(v);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !HOSTS_SIMULADOR_RESEND.has(u.hostname)) return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Mensagem da fila mais velha que isto não sai mais (evita e-mail fora de contexto depois de dias de DNS parado). ⚑ */
export const VALIDADE_FILA_MS = 7 * 24 * 60 * 60_000;

export const emailValido = (e: unknown): e is string =>
  typeof e === "string" && e.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

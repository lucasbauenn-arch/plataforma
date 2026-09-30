// Validação do Cloudflare Turnstile no servidor (siteverify), com tempo limite e IP do cliente.
// Regras (docs/ARQUITETURA_EXPANSAO.md §6):
//   - sem TURNSTILE_SECRET em PRODUÇÃO → recusa (falha fechada); fora de produção → dispensa, como o
//     `enviar-lead` já fazia, para o desenvolvimento local funcionar sem a chave;
//   - Cloudflare fora do ar, tempo esgotado ou resposta estranha → recusa (nunca libera por falha);
//   - token vazio ou com mais de 2048 caracteres → recusa sem chamar a Cloudflare.
// Módulo PURO: usa o `fetch` global (Deno/Node) ou um injetado nos testes; o ambiente é lido em `ambiente.ts`.
import { ehProducao, normalizarIp } from "./http.ts";

export const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Tamanho máximo de um token do Turnstile (documentação da Cloudflare). */
export const TURNSTILE_TOKEN_MAX = 2048;
export const TURNSTILE_TIMEOUT_PADRAO_MS = 5000;
export const MENSAGEM_TURNSTILE = "Não conseguimos confirmar que você não é um robô. Recarregue a página e tente de novo.";

export type MotivoTurnstile =
  | "validado"
  | "dispensado_sem_segredo" // fora de produção, sem segredo configurado
  | "sem_segredo" // produção sem segredo: função mal configurada
  | "sem_token"
  | "token_invalido"
  | "recusado" // a Cloudflare disse que não
  | "hostname_invalido"
  | "acao_invalida"
  | "indisponivel"; // rede, tempo esgotado, HTTP ≠ 200 ou resposta ilegível

export type ResultadoTurnstile = {
  ok: boolean;
  motivo: MotivoTurnstile;
  /** códigos de erro da Cloudflare (ex.: "timeout-or-duplicate"), para log; nunca contêm o token */
  codigos: string[];
};

export type OpcoesTurnstile = {
  token: unknown;
  segredo: string | null | undefined;
  ambiente: string | null | undefined;
  /** IP do cliente (enviado como remoteip quando for um IP válido) */
  ip?: string | null;
  timeoutMs?: number;
  /** idempotency_key (uuid) para poder repetir a mesma validação sem "timeout-or-duplicate" */
  idempotencia?: string;
  /** se informado, o hostname devolvido pela Cloudflare precisa estar na lista */
  hostnames?: readonly string[];
  /** se informado, a action do widget precisa ser esta */
  acao?: string;
  /** injeção para testes (padrão: fetch global) */
  fetch?: typeof fetch;
};

const resultado = (ok: boolean, motivo: MotivoTurnstile, codigos: string[] = []): ResultadoTurnstile => ({ ok, motivo, codigos });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function validarTurnstile(o: OpcoesTurnstile): Promise<ResultadoTurnstile> {
  const segredo = o.segredo?.trim();
  if (!segredo) return ehProducao(o.ambiente) ? resultado(false, "sem_segredo") : resultado(true, "dispensado_sem_segredo");

  if (typeof o.token !== "string" || !o.token.trim()) return resultado(false, "sem_token");
  const token = o.token.trim();
  if (token.length > TURNSTILE_TOKEN_MAX) return resultado(false, "token_invalido");

  const corpo = new URLSearchParams({ secret: segredo, response: token });
  const ip = normalizarIp(o.ip);
  if (ip) corpo.set("remoteip", ip);
  if (o.idempotencia && UUID.test(o.idempotencia)) corpo.set("idempotency_key", o.idempotencia);

  const chamar = o.fetch ?? fetch;
  const controle = new AbortController();
  const timeoutMs = o.timeoutMs ?? TURNSTILE_TIMEOUT_PADRAO_MS;
  const relogio = setTimeout(() => controle.abort(), timeoutMs);
  let dados: unknown;
  try {
    const resposta = await chamar(TURNSTILE_URL, { method: "POST", body: corpo, signal: controle.signal });
    if (!resposta.ok) return resultado(false, "indisponivel", [`http_${resposta.status}`]);
    dados = await resposta.json();
  } catch {
    return resultado(false, "indisponivel", [controle.signal.aborted ? "tempo_esgotado" : "falha_rede"]);
  } finally {
    clearTimeout(relogio);
  }

  if (typeof dados !== "object" || dados === null) return resultado(false, "indisponivel", ["resposta_invalida"]);
  const d = dados as { success?: unknown; "error-codes"?: unknown; hostname?: unknown; action?: unknown };
  const codigos = Array.isArray(d["error-codes"])
    ? d["error-codes"].filter((c): c is string => typeof c === "string").slice(0, 10).map((c) => c.slice(0, 60))
    : [];
  if (d.success !== true) return resultado(false, "recusado", codigos);
  if (o.hostnames && !(typeof d.hostname === "string" && o.hostnames.includes(d.hostname))) {
    return resultado(false, "hostname_invalido", codigos);
  }
  if (o.acao !== undefined && d.action !== o.acao) return resultado(false, "acao_invalida", codigos);
  return resultado(true, "validado", codigos);
}

/**
 * Status HTTP para responder quando o Turnstile não passou: 403 quando o problema é do visitante; 503 quando é
 * nosso ou da Cloudflare (segredo faltando em produção, Cloudflare fora do ar).
 */
export function statusFalhaTurnstile(r: ResultadoTurnstile): 403 | 503 {
  return r.motivo === "indisponivel" || r.motivo === "sem_segredo" ? 503 : 403;
}

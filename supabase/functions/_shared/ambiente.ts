// Leitura do ambiente das Edge Functions (Deno). Os módulos puros (http, chaves, turnstile, limite-ip) recebem os
// valores prontos daqui — por isso este arquivo NÃO é importado pelo Vitest.
// Variáveis (docs/ARQUITETURA_EXPANSAO.md §6.8): AMBIENTE (producao | desenvolvimento | homologacao; ausente =
// desenvolvimento), SITE_URL, TURNSTILE_SECRET, CRON_SEGREDO, WEBHOOK_SECRET. Nunca registrar os valores.
//
// Uso típico (função pública):
//   Deno.serve(criarRota({ nome: "pre-cadastro", cors: corsDoSite() }, async (req, r) => {
//     const ip = ipCliente(req);
//     const armazem = armazemTentativas();
//     // reserva atômica no banco (FR1-01): já conta a tentativa como falha; o sucesso a confirma no fim
//     const limite = await reservarTentativa(armazem, [{ regra: REGRA_PRE_CADASTRO, ip }]);
//     if (!limite.permitido) {
//       const b = respostaDoBloqueio(limite, REGRA_PRE_CADASTRO);
//       return r.erro(b.status, b.mensagem, { codigo: b.codigo, cabecalhos: b.cabecalhos });
//     }
//     const corpo = await lerJson(req);
//     if (!corpo.ok) { await limite.concluir(false); return r.erro(corpo.status, corpo.erro); }
//     const captcha = await validarCaptcha(corpo.valor.captcha, ip);
//     if (!captcha.ok) return r.erro(statusFalhaTurnstile(captcha), MENSAGEM_TURNSTILE);
//     …
//     await limite.concluir(true);
//   }));
// Entre servidores (pg_cron): criarRota({ nome: "d4sign-reconciliar" }, …) sem cors, e
//   if (!cabecalhoSecretoConfere(req, "x-cron-secret", "CRON_SEGREDO")) return r.erro(401, "Não autorizado");
import { type ConfiguracaoCors, ehProducao, montarCors } from "./http.ts";
import { segredoConfere } from "./chaves.ts";
import { type OpcoesTurnstile, type ResultadoTurnstile, validarTurnstile } from "./turnstile.ts";

/** Valor da variável sem espaços nas pontas; vazia ou ausente → nulo. */
export function lerEnv(nome: string): string | null {
  const v = Deno.env.get(nome)?.trim();
  return v ? v : null;
}

/** Variável obrigatória: ausente → erro (a rota responde 500 genérico e o log diz qual faltou, sem valor). */
export function exigirEnv(nome: string): string {
  const v = lerEnv(nome);
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

export const ambienteAtual = () => lerEnv("AMBIENTE");
export const emProducao = () => ehProducao(ambienteAtual());

/** Origens do site para as funções chamadas pelo navegador (SITE_URL + www; localhost fora de produção). */
export function corsDoSite(): ConfiguracaoCors {
  return montarCors({ siteUrl: lerEnv("SITE_URL"), ambiente: ambienteAtual() });
}

/** Turnstile com TURNSTILE_SECRET e AMBIENTE do ambiente. Em produção sem segredo, recusa. */
export async function validarCaptcha(
  token: unknown,
  ip: string | null,
  extras: Pick<OpcoesTurnstile, "timeoutMs" | "idempotencia" | "hostnames" | "acao"> = {},
): Promise<ResultadoTurnstile> {
  const r = await validarTurnstile({ token, ip, segredo: lerEnv("TURNSTILE_SECRET"), ambiente: ambienteAtual(), ...extras });
  if (r.motivo === "dispensado_sem_segredo") console.warn("[turnstile] TURNSTILE_SECRET ausente: validação dispensada (fora de produção)");
  if (r.motivo === "sem_segredo") console.error("[turnstile] TURNSTILE_SECRET ausente em produção: recusando");
  return r;
}

/**
 * Chamada entre servidores autenticada por segredo em cabeçalho (ex.: `x-cron-secret` = CRON_SEGREDO no
 * d4sign-reconciliar). Comparação em tempo constante; variável ausente ou curta → recusa.
 */
export function cabecalhoSecretoConfere(req: Request, cabecalho: string, variavel: string): boolean {
  return segredoConfere(req.headers.get(cabecalho), lerEnv(variavel));
}

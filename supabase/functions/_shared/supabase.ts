// Clientes do Supabase nas Edge Functions (Deno + supabase-js; NÃO é importado pelo Vitest).
// Regra de ouro (docs/ARQUITETURA_EXPANSAO.md §4.6 e §6): a service role NUNCA decide permissão.
//   - clienteDoUsuario(jwt): operações de negócio. Chama as RPCs com o JWT de quem pediu; o banco aplica o
//     escopo, o papel e o aal2 (is_admin/is_super com exigir_mfa_interno).
//   - clienteAdmin(): só Storage, Auth admin e as RPCs de sistema (grant só para service_role:
//     crm_pre_cadastro, rede_vincular_login, contrato_registrar_*, portal_localizar_cliente,
//     tentativas_reservar/tentativas_confirmar…). Nunca para ler `profiles` e decidir papel.
//
// Uso típico (função com JWT):
//   Deno.serve(criarRota({ nome: "contrato-gerar", cors: corsDoSite() }, async (req, r) => {
//     const quem = await exigirUsuario(req, r);
//     if (quem instanceof Response) return quem;
//     const corpo = await lerJson(req);
//     if (!corpo.ok) return r.erro(corpo.status, corpo.erro);
//     const { data, error } = await quem.db.rpc("contrato_dados_modelo", { p_id: corpo.valor.id });
//     …
//   }));
import { createClient, type SupabaseClient, type User } from "./supabase-js.ts";
import { type Respostas, tokenBearer } from "./http.ts";
import { type ArmazemTentativas, lerRespostaReserva } from "./limite-ip.ts";
import { exigirEnv, lerEnv } from "./ambiente.ts";

/**
 * Chave de API do projeto: as novas (SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS, JSON {"default": "..."})
 * com a legada como alternativa (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY, desativadas no fim de 2026).
 * É o helper `chave()` que hoje está repetido nas 4 funções.
 */
export function chaveApi(
  novas: "SUPABASE_SECRET_KEYS" | "SUPABASE_PUBLISHABLE_KEYS",
  legada: "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_ANON_KEY",
): string {
  const json = lerEnv(novas);
  if (json) {
    try {
      const k = (JSON.parse(json) as { default?: unknown }).default;
      if (typeof k === "string" && k) return k;
    } catch {
      /* usa a legada */
    }
  }
  const v = lerEnv(legada);
  if (!v) throw new Error(`Chave do Supabase ausente: ${novas} / ${legada}`);
  return v;
}

const OPCOES_AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

let admin: SupabaseClient | null = null;

/** Cliente com a service role (um por isolate). Não decide permissão: ver o cabeçalho deste arquivo. */
export function clienteAdmin(): SupabaseClient {
  admin ??= createClient(exigirEnv("SUPABASE_URL"), chaveApi("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: OPCOES_AUTH,
  });
  return admin;
}

/**
 * Cliente que age como o usuário: chave publicável + `Authorization: Bearer <jwt do usuário>`.
 * Com a requisição, devolve nulo quando não há JWT. Isto NÃO valida o token: para exigir sessão válida use
 * `exigirUsuario` (o PostgREST também recusa JWT inválido, mas a resposta fica menos clara).
 */
export function clienteDoUsuario(jwt: string): SupabaseClient;
export function clienteDoUsuario(req: Request): SupabaseClient | null;
export function clienteDoUsuario(fonte: string | Request): SupabaseClient | null {
  if (typeof fonte === "string" && !fonte) throw new Error("clienteDoUsuario: JWT vazio");
  const jwt = typeof fonte === "string" ? fonte : tokenBearer(fonte);
  if (!jwt) return null;
  return createClient(exigirEnv("SUPABASE_URL"), chaveApi("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), {
    auth: OPCOES_AUTH,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

export type Autenticado = {
  usuario: User;
  jwt: string;
  /** cliente com o JWT do usuário: use este para as RPCs de negócio */
  db: SupabaseClient;
};

export type ResultadoAutenticacao =
  | ({ ok: true } & Autenticado)
  | { ok: false; motivo: "sem_token" | "invalido" | "indisponivel" };

/**
 * Valida o JWT no Auth (`getUser`: assinatura, validade, usuário existente e sessão não encerrada). Necessário porque
 * o config.toml usa `verify_jwt = false` em todas as funções (as chaves novas não são JWT; §6).
 */
export async function autenticar(req: Request): Promise<ResultadoAutenticacao> {
  const jwt = tokenBearer(req);
  if (!jwt) return { ok: false, motivo: "sem_token" };
  const db = clienteDoUsuario(jwt);
  const { data, error } = await db.auth.getUser(jwt);
  if (error) {
    const status = (error as { status?: number }).status ?? 0;
    return { ok: false, motivo: status === 0 || status >= 500 ? "indisponivel" : "invalido" };
  }
  if (!data?.user || data.user.is_anonymous) return { ok: false, motivo: "invalido" };
  return { ok: true, usuario: data.user, jwt, db };
}

/**
 * Exige usuário logado. Devolve o `Autenticado` ou a resposta de erro pronta (401/503).
 * A permissão NÃO é conferida aqui: é a RPC chamada com `db` que decide (e grava a auditoria).
 */
export async function exigirUsuario(req: Request, r: Respostas): Promise<Autenticado | Response> {
  const a = await autenticar(req);
  if (a.ok) return { usuario: a.usuario, jwt: a.jwt, db: a.db };
  if (a.motivo === "indisponivel") return r.erro(503, "Não foi possível confirmar sua sessão agora. Tente de novo.");
  return r.erro(401, "Sua sessão expirou. Entre de novo.");
}

/**
 * Limite por IP das rotas públicas (FR1-01): as RPCs de sistema tentativas_reservar e tentativas_confirmar (migration 19;
 * só a service role executa). A conferência e a gravação são uma transação só, sob trava por rota + IP; sem a migration
 * aplicada a chamada falha e a rota responde 503 (falha fechada, nunca "liberado"; ver scripts/migracao/DEPLOY.md).
 */
export function armazemTentativas(db: SupabaseClient = clienteAdmin()): ArmazemTentativas {
  return {
    async reservar(baldes) {
      const { data, error } = await db.rpc("tentativas_reservar", { p_baldes: baldes });
      if (error) throw new Error(`tentativas_reservar: ${error.code ?? ""} ${error.message}`);
      return lerRespostaReserva(data, baldes.length);
    },
    async confirmar(ids) {
      const { error } = await db.rpc("tentativas_confirmar", { p_ids: ids });
      if (error) {
        console.error(`[tentativas] confirmar: ${error.code ?? ""} ${error.message}`);
        throw new Error(`tentativas_confirmar: ${error.code ?? ""} ${error.message}`);
      }
    },
  };
}

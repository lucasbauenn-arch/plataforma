// Utilidades HTTP das Edge Functions (docs/ARQUITETURA_EXPANSAO.md §6):
//   - CORS por lista de origens (SITE_URL e a variação com/sem www; localhost só fora de produção);
//   - respostas JSON padronizadas ({ erro, codigo } nas falhas, como o front já lê);
//   - leitura do corpo com limite de tamanho (bytes, texto ou JSON);
//   - dados da requisição: token Bearer, IP do cliente e navegador;
//   - criarRota(): OPTIONS, método, origem e erro inesperado tratados num lugar só.
// Módulo PURO: sem Deno.*, sem npm:/jsr:/URLs. Roda no Deno e no Vitest (Node). Quem lê o ambiente é
// `ambiente.ts`; quem cria os clientes do Supabase é `supabase.ts`.

export const SITE_PADRAO = "https://arkenincorporadora.com.br";

/** Corpo JSON padrão das funções chamadas pelo navegador (formulários pequenos). */
export const LIMITE_JSON_PADRAO = 16 * 1024;

// ============ ambiente ============

const NOMES_PRODUCAO = new Set(["producao", "production", "prod"]);

/** `AMBIENTE=producao` (aceita "produção", "production", "prod"). Ausente = desenvolvimento. */
export function ehProducao(ambiente: string | null | undefined): boolean {
  if (!ambiente) return false;
  const v = ambiente.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return NOMES_PRODUCAO.has(v);
}

// ============ CORS ============

export type ConfiguracaoCors = {
  /** origens exatas aceitas (esquema + host + porta, como o navegador manda no cabeçalho Origin) */
  readonly origens: readonly string[];
  /** aceita http://localhost:*, http://127.0.0.1:* e http://[::1]:* (só fora de produção) */
  readonly localhost: boolean;
};

/** Cabeçalhos que o SDK do Supabase envia (lista de @supabase/supabase-js/cors) + x-region do functions-js. */
export const CABECALHOS_PERMITIDOS = [
  "authorization", "x-client-info", "apikey", "content-type", "x-retry-count",
  "traceparent", "tracestate", "baggage", "x-region",
].join(", ");

const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function origemDe(valor: string | null | undefined, producao: boolean): string | null {
  if (!valor) return null;
  let url: URL;
  try {
    url = new URL(valor.trim());
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url.origin;
  // http só para localhost e só fora de produção
  if (url.protocol === "http:" && !producao && HOSTS_LOCAIS.has(url.hostname)) return url.origin;
  return null;
}

function variacaoWww(origem: string): string | null {
  const url = new URL(origem);
  const host = url.hostname;
  if (HOSTS_LOCAIS.has(host) || /^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  if (host.startsWith("www.")) url.hostname = host.slice(4);
  else if (host.includes(".")) url.hostname = `www.${host}`;
  else return null;
  return url.origin;
}

/**
 * Origens aceitas: a de SITE_URL (https; http só para localhost fora de produção) e a variação com/sem www.
 * SITE_URL ausente ou inválido → site oficial. Localhost só quando o ambiente não é produção.
 */
export function montarCors(opcoes: { siteUrl?: string | null; ambiente?: string | null }): ConfiguracaoCors {
  const producao = ehProducao(opcoes.ambiente);
  const base = origemDe(opcoes.siteUrl, producao) ?? SITE_PADRAO;
  const origens = new Set([base]);
  const alternativa = variacaoWww(base);
  if (alternativa) origens.add(alternativa);
  return { origens: [...origens], localhost: !producao };
}

export function origemPermitida(origem: string | null | undefined, cors: ConfiguracaoCors): boolean {
  if (!origem) return false;
  if (cors.origens.includes(origem)) return true;
  return cors.localhost && LOCALHOST.test(origem);
}

/** Cabeçalhos CORS de uma resposta comum: só devolve a origem quando ela está na lista. */
export function cabecalhosCors(origem: string | null | undefined, cors: ConfiguracaoCors): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin" };
  if (origem && origemPermitida(origem, cors)) {
    h["Access-Control-Allow-Origin"] = origem;
    h["Access-Control-Expose-Headers"] = "Retry-After";
  }
  return h;
}

// ============ respostas ============

const CODIGO_POR_STATUS: Record<number, string> = {
  400: "requisicao_invalida",
  401: "nao_autenticado",
  403: "sem_permissao",
  404: "nao_encontrado",
  405: "metodo_nao_permitido",
  409: "conflito",
  413: "corpo_grande_demais",
  415: "tipo_nao_suportado",
  422: "dados_invalidos",
  429: "muitas_tentativas",
  500: "erro_interno",
  502: "falha_integracao",
  503: "indisponivel",
};

export type CorpoErro = { erro: string; codigo: string; detalhes?: unknown };

export type OpcoesErro = { codigo?: string; detalhes?: unknown; cabecalhos?: Record<string, string> };

export type Respostas = {
  /** JSON com status (padrão 200). */
  json(corpo: unknown, status?: number, cabecalhos?: Record<string, string>): Response;
  /** Falha padronizada: `{ erro, codigo, detalhes? }`. O código padrão vem do status. */
  erro(status: number, mensagem: string, opcoes?: OpcoesErro): Response;
  /** Sem corpo (padrão 204). */
  vazio(status?: number, cabecalhos?: Record<string, string>): Response;
};

const CABECALHOS_JSON = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export function codigoPadrao(status: number): string {
  return CODIGO_POR_STATUS[status] ?? (status >= 500 ? "erro_interno" : "requisicao_invalida");
}

/** Fábrica de respostas; `base` entra em todas (ex.: cabeçalhos CORS). */
export function criarRespostas(base: Record<string, string> = {}): Respostas {
  const json = (corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}) =>
    new Response(JSON.stringify(corpo ?? null), { status, headers: { ...base, ...CABECALHOS_JSON, ...cabecalhos } });
  return {
    json,
    erro(status, mensagem, opcoes = {}) {
      const corpo: CorpoErro = { erro: mensagem, codigo: opcoes.codigo ?? codigoPadrao(status) };
      if (opcoes.detalhes !== undefined) corpo.detalhes = opcoes.detalhes;
      return json(corpo, status, opcoes.cabecalhos);
    },
    vazio(status = 204, cabecalhos = {}) {
      return new Response(null, { status, headers: { ...base, "Cache-Control": "no-store", ...cabecalhos } });
    },
  };
}

// ============ leitura do corpo com limite ============

export type Leitura<T> =
  | { ok: true; valor: T }
  | { ok: false; status: 400 | 413 | 415; erro: string; codigo: string };

const falha = (status: 400 | 413 | 415, erro: string): Leitura<never> => ({ ok: false, status, erro, codigo: codigoPadrao(status) });

/** Lê o corpo cru sem passar de `limiteBytes` (confere o Content-Length e conta o que chega de fato). */
export async function lerBytes(req: Request, limiteBytes: number): Promise<Leitura<Uint8Array>> {
  if (!Number.isInteger(limiteBytes) || limiteBytes <= 0) throw new RangeError("limiteBytes precisa ser inteiro positivo");
  const declarado = req.headers.get("content-length");
  if (declarado !== null) {
    if (!/^\d+$/.test(declarado.trim())) return falha(400, "Content-Length inválido");
    if (Number(declarado) > limiteBytes) return falha(413, "Conteúdo grande demais");
  }
  if (!req.body) return { ok: true, valor: new Uint8Array(0) };

  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > limiteBytes) {
        await leitor.cancel().catch(() => {});
        return falha(413, "Conteúdo grande demais");
      }
      partes.push(value);
    }
  } catch {
    return falha(400, "Não foi possível ler o conteúdo enviado");
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    bytes.set(p, pos);
    pos += p.byteLength;
  }
  return { ok: true, valor: bytes };
}

/** Texto UTF-8 com limite; bytes inválidos em UTF-8 são recusados. */
export async function lerTexto(req: Request, limiteBytes: number): Promise<Leitura<string>> {
  const lido = await lerBytes(req, limiteBytes);
  if (!lido.ok) return lido;
  try {
    return { ok: true, valor: new TextDecoder("utf-8", { fatal: true }).decode(lido.valor) };
  } catch {
    return falha(400, "Conteúdo com codificação inválida");
  }
}

export type OpcoesLerJson = {
  /** padrão LIMITE_JSON_PADRAO (16 KB) */
  limiteBytes?: number;
  /**
   * Exige `Content-Type: application/json` (padrão true). Isso obriga o navegador a fazer o preflight de CORS,
   * então um site de fora não consegue disparar a função com um POST "simples" (SEG-3).
   */
  exigirTipoJson?: boolean;
};

/** JSON com limite de tamanho; o resultado precisa ser um objeto (nem lista, nem nulo, nem primitivo). */
export async function lerJson(req: Request, opcoes: OpcoesLerJson = {}): Promise<Leitura<Record<string, unknown>>> {
  const { limiteBytes = LIMITE_JSON_PADRAO, exigirTipoJson = true } = opcoes;
  if (exigirTipoJson) {
    const tipo = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (tipo !== "application/json") return falha(415, "Envie os dados em JSON");
  }
  const texto = await lerTexto(req, limiteBytes);
  if (!texto.ok) return texto;
  if (!texto.valor.trim()) return falha(400, "Nenhum dado enviado");
  let valor: unknown;
  try {
    valor = JSON.parse(texto.valor);
  } catch {
    return falha(400, "JSON inválido");
  }
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return falha(400, "Formato de dados inválido");
  return { ok: true, valor: valor as Record<string, unknown> };
}

// ============ dados da requisição ============

const cabecalhosDe = (fonte: Request | Headers) => (fonte instanceof Headers ? fonte : fonte.headers);

const FORMATO_JWT = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;

/**
 * JWT do cabeçalho `Authorization: Bearer <jwt>`. Devolve nulo quando falta ou quando o Bearer é uma chave de API
 * (`sb_publishable_…`/`sb_secret_…` não são JWT). O token AINDA precisa ser validado no Auth (`supabase.ts`).
 */
export function tokenBearer(fonte: Request | Headers): string | null {
  const bruto = cabecalhosDe(fonte).get("authorization");
  if (!bruto) return null;
  const m = /^Bearer[ \t]+(\S+)$/i.exec(bruto.trim());
  if (!m) return null;
  const token = m[1];
  return token.length <= 8192 && FORMATO_JWT.test(token) ? token : null;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Expande um IPv6 já normalizado (sem notação com pontos) em 8 grupos numéricos. */
export function gruposIpv6(ip: string): number[] | null {
  const metades = ip.split("::");
  if (metades.length > 2) return null;
  const esquerda = metades[0] ? metades[0].split(":") : [];
  const direita = metades.length === 2 && metades[1] ? metades[1].split(":") : [];
  const faltam = 8 - esquerda.length - direita.length;
  if (metades.length === 1 ? faltam !== 0 : faltam < 1) return null;
  const grupos = [...esquerda, ...Array<string>(metades.length === 2 ? faltam : 0).fill("0"), ...direita];
  if (grupos.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return grupos.map((g) => parseInt(g, 16));
}

/**
 * Normaliza um IP para a forma canônica (IPv4 em pontos; IPv6 comprimido em minúsculas; IPv4 mapeado em IPv6
 * vira IPv4). Aceita colchetes e porta ("[::1]:443", "1.2.3.4:80"). Inválido → nulo.
 */
export function normalizarIp(valor: string | null | undefined): string | null {
  if (!valor) return null;
  let v = valor.trim();
  if (!v || v.length > 64) return null;
  const colchetes = /^\[([^\]]+)\](:\d{1,5})?$/.exec(v);
  if (colchetes) v = colchetes[1];
  else if (/^[\d.]+:\d{1,5}$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  if (IPV4.test(v)) return v;
  if (!v.includes(":") || !/^[0-9a-fA-F:.]+$/.test(v)) return null;
  let host: string;
  try {
    host = new URL(`http://[${v}]/`).hostname; // o parser de URL valida e comprime o IPv6
  } catch {
    return null;
  }
  const ip = host.slice(1, -1);
  const g = gruposIpv6(ip);
  if (!g) return null;
  // ::ffff:a.b.c.d (IPv4 mapeado) → a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join(".");
  }
  return ip;
}

/**
 * Cabeçalhos consultados, em ordem. `cf-connecting-ip` é sobrescrito pela Cloudflare (não dá para forjar);
 * `x-forwarded-for` usa o primeiro item, como o `cliente-login` já fazia. ⚑ Confirmar no projeto remoto quais
 * cabeçalhos chegam à função: se o proxy só ACRESCENTA ao x-forwarded-for, o primeiro item é do cliente.
 */
export const CABECALHOS_IP = ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"] as const;

/** IP do cliente (normalizado) ou nulo quando nenhum cabeçalho traz um IP válido. */
export function ipCliente(fonte: Request | Headers): string | null {
  const h = cabecalhosDe(fonte);
  for (const nome of CABECALHOS_IP) {
    const ip = normalizarIp(h.get(nome)?.split(",")[0]);
    if (ip) return ip;
  }
  return null;
}

/** User-Agent sem caracteres de controle, até 300 caracteres. */
export function agenteUsuario(fonte: Request | Headers): string | null {
  const ua = (cabecalhosDe(fonte).get("user-agent") ?? "").replace(/\p{Cc}/gu, "").trim().slice(0, 300);
  return ua || null;
}

// ============ erros sem vazar segredo ============

/**
 * Mensagem de erro própria para log: tira query string de URLs (o D4Sign leva token e chave na URL — §6.4),
 * tokens Bearer, JWTs e chaves `sb_…`. Nunca registrar o objeto de erro cru.
 */
export function mensagemSegura(erro: unknown, max = 500): string {
  let bruto: string;
  if (erro instanceof Error) bruto = `${erro.name}: ${erro.message}`;
  else if (typeof erro === "string") bruto = erro;
  else {
    try {
      bruto = JSON.stringify(erro) ?? String(erro);
    } catch {
      bruto = String(erro);
    }
  }
  return bruto
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>)]*/gi, "$1?[omitido]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [omitido]")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[jwt omitido]")
    .replace(/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, "sb_$1_[omitido]")
    .slice(0, max);
}

// ============ rota ============

export type Manipulador = (req: Request, r: Respostas) => Response | Promise<Response>;

export type OpcoesRota = {
  /** nome da função, usado no log */
  nome: string;
  /** métodos aceitos (padrão ["POST"]) */
  metodos?: readonly string[];
  /**
   * Chamada pelo navegador: lista de origens. Ausente/nulo = só entre servidores (webhook, pg_cron): sem CORS e
   * sem preflight. Com CORS, requisição com cabeçalho Origin fora da lista é recusada ANTES do manipulador.
   */
  cors?: ConfiguracaoCors | null;
  /** registro de erro inesperado (padrão: console.error com mensagemSegura) */
  aoFalhar?: (nome: string, erro: unknown) => void;
};

const registrarFalha = (nome: string, erro: unknown) => {
  console.error(`[${nome}] erro inesperado: ${mensagemSegura(erro)}`);
  if (erro instanceof Error && erro.stack) console.error(mensagemSegura(erro.stack, 2000));
};

/**
 * Envolve o manipulador de uma Edge Function: preflight, método, origem e erro inesperado (500 genérico, sem
 * detalhe interno na resposta). Uso: `Deno.serve(criarRota({ nome, cors: corsDoSite() }, async (req, r) => …))`.
 */
export function criarRota(opcoes: OpcoesRota, manipulador: Manipulador): (req: Request) => Promise<Response> {
  const metodos = (opcoes.metodos ?? ["POST"]).map((m) => m.toUpperCase());
  const permitidos = [...metodos, ...(opcoes.cors ? ["OPTIONS"] : [])].join(", ");
  const aoFalhar = opcoes.aoFalhar ?? registrarFalha;

  return async (req) => {
    const origem = req.headers.get("origin");
    const cors = opcoes.cors ?? null;
    const r = criarRespostas(cors ? cabecalhosCors(origem, cors) : {});

    if (cors && origem !== null && !origemPermitida(origem, cors)) {
      return r.erro(403, "Origem não permitida", { codigo: "origem_nao_permitida" });
    }
    if (req.method === "OPTIONS" && cors) {
      if (!origem) return r.vazio(204, { Allow: permitidos });
      return r.vazio(204, {
        "Access-Control-Allow-Methods": permitidos,
        "Access-Control-Allow-Headers": CABECALHOS_PERMITIDOS,
        "Access-Control-Max-Age": "600",
      });
    }
    if (!metodos.includes(req.method)) {
      return r.erro(405, "Método não permitido", { cabecalhos: { Allow: permitidos } });
    }
    try {
      return await manipulador(req, r);
    } catch (erro) {
      try {
        aoFalhar(opcoes.nome, erro);
      } catch {
        /* o log nunca derruba a resposta */
      }
      return r.erro(500, "Erro interno. Tente novamente em instantes.");
    }
  };
}

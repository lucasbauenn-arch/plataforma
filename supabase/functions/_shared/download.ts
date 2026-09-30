// Download de arquivos privados de crm-documentos e contratos (docs/ARQUITETURA_EXPANSAO.md §4.3).
// Módulo puro (sem Deno nem supabase-js): validação do pedido e validade da URL assinada. Usado pela Edge
// baixar-arquivo e testado pelo Vitest (download.test.ts).
//
// Por que existe: o Storage só avalia a RLS quando ASSINA a URL, e o `expiresIn` é escolhido por quem assina, sem
// teto. Se `authenticated` pudesse assinar (política de SELECT), uma autorização de 60 s viraria uma URL válida por
// anos, sem auditoria e sobrevivendo à inativação. Então não há política de SELECT nesses buckets: a RPC (JWT do
// usuário) confere o escopo, audita e grava `download_autorizacoes`; a Edge resgata essa autorização e assina com a
// service role, com validade que termina junto com a autorização.

export const BUCKETS_DOWNLOAD = ["crm-documentos", "contratos"] as const;
export type BucketDownload = (typeof BUCKETS_DOWNLOAD)[number];

/** Teto de `configuracao_geral.download_ttl_segundos` (check `between 10 and 3600`). */
export const TTL_MAXIMO_SEGUNDOS = 3600;

export type PedidoDownload = { bucket: BucketDownload; path: string };

export type LeituraPedido = { ok: true; valor: PedidoDownload } | { ok: false; erro: string };

const ehBucket = (v: unknown): v is BucketDownload =>
  typeof v === "string" && (BUCKETS_DOWNLOAD as readonly string[]).includes(v);

/**
 * `{ bucket, path }` exatamente como a RPC devolveu (`DownloadAutorizado` do front). O caminho é conferido de novo
 * contra a autorização no banco; aqui só se recusa o que nunca seria um objeto válido (mesmos limites de
 * `download_autorizacoes.path`, sem `..`, barra inicial, barra invertida nem caractere de controle).
 */
export function lerPedidoDownload(corpo: Record<string, unknown>): LeituraPedido {
  const { bucket, path } = corpo;
  if (!ehBucket(bucket)) return { ok: false, erro: "Arquivo inválido" };
  if (
    typeof path !== "string" || path.length < 3 || path.length > 500 || path.startsWith("/") ||
    path.split("/").some((parte) => parte === "" || parte === "." || parte === "..") ||
    /[\p{Cc}\\]/u.test(path)
  ) {
    return { ok: false, erro: "Arquivo inválido" };
  }
  return { ok: true, valor: { bucket, path } };
}

/**
 * Segundos inteiros que ainda restam até `expiraEm` (arredondados para BAIXO, então a URL assinada nunca vale mais
 * que a autorização), limitados a `TTL_MAXIMO_SEGUNDOS`. 0 = vencida ou data inválida (não assinar).
 */
export function segundosRestantes(expiraEm: string | null | undefined, agoraMs: number): number {
  const fim = typeof expiraEm === "string" ? Date.parse(expiraEm) : Number.NaN;
  if (!Number.isFinite(fim) || !Number.isFinite(agoraMs)) return 0;
  const s = Math.floor((fim - agoraMs) / 1000);
  return s < 1 ? 0 : Math.min(s, TTL_MAXIMO_SEGUNDOS);
}

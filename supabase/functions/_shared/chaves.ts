// Primitivas de segredo das Edge Functions: sha256/HMAC em hex, comparação em tempo constante, token aleatório
// url-safe e conferência de segredo de cabeçalho (x-cron-secret, x-webhook-secret).
// Módulo PURO: só Web Crypto (crypto.subtle / getRandomValues), presente no Deno e no Node 20 (Vitest).
// Leitura das chaves do Supabase no ambiente (`chaveApi`) e criação de clientes ficam em `supabase.ts`.

const codificador = new TextEncoder();

/** Texto em UTF-8; bytes são copiados (a Web Crypto exige ArrayBuffer próprio). Tipo de retorno inferido de
 * propósito: `Uint8Array<ArrayBuffer>` no TS ≥ 5.7 e `Uint8Array` no TS do Deno, sem sintaxe que um dos dois rejeite. */
export function paraBytes(valor: string | Uint8Array) {
  return typeof valor === "string" ? codificador.encode(valor) : new Uint8Array(valor);
}

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export async function sha256Hex(entrada: string | Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", paraBytes(entrada)));
}

export async function hmacSha256Hex(segredo: string | Uint8Array, mensagem: string | Uint8Array): Promise<string> {
  const chave = paraBytes(segredo);
  if (chave.length === 0) throw new Error("Segredo do HMAC vazio");
  const k = await crypto.subtle.importKey("raw", chave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, paraBytes(mensagem)));
}

/**
 * Compara sem sair no primeiro byte diferente (o tempo só depende do maior tamanho), para não permitir descobrir
 * um segredo byte a byte medindo o tempo de resposta.
 */
export function iguaisTempoConstante(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const x = paraBytes(a);
  const y = paraBytes(b);
  const n = Math.max(x.length, y.length);
  let diferenca = x.length ^ y.length;
  for (let i = 0; i < n; i++) diferenca |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diferenca === 0;
}

export function base64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Token aleatório url-safe (base64url sem "="). 32 bytes → 43 caracteres. Mínimo 16 bytes. */
export function tokenAleatorio(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 1024) throw new RangeError("tokenAleatorio: use de 16 a 1024 bytes");
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Tamanho mínimo aceito para um segredo compartilhado (CRON_SEGREDO, WEBHOOK_SECRET…). */
export const SEGREDO_MINIMO = 16;

/**
 * Confere um segredo recebido (ex.: cabeçalho x-cron-secret) com o configurado, em tempo constante.
 * Segredo configurado ausente ou curto demais → sempre falso (falha fechada: função mal configurada não abre).
 */
export function segredoConfere(
  recebido: string | null | undefined,
  esperado: string | null | undefined,
  minimo = SEGREDO_MINIMO,
): boolean {
  if (!esperado || esperado.length < minimo) return false;
  if (!recebido) return false;
  return iguaisTempoConstante(recebido, esperado);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Confere um token recebido com o sha256 guardado no banco (ex.: `?t=` do webhook do D4Sign contra
 * `contratos.webhook_token_hash`). Só o hash fica gravado; a comparação é em tempo constante.
 */
export async function tokenConfereComHash(token: string | null | undefined, hashGuardado: string | null | undefined): Promise<boolean> {
  if (!token || !hashGuardado) return false;
  const esperado = hashGuardado.trim().toLowerCase();
  if (!SHA256_HEX.test(esperado)) return false;
  return iguaisTempoConstante(await sha256Hex(token), esperado);
}

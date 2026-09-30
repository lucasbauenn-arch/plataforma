// O host da URL assinada que a Edge baixar-arquivo devolve vem do SUPABASE_URL do ambiente onde ela roda, e só dele.
//
// Por que existe: na stack local (supabase start) o SUPABASE_URL da Edge é o endereço INTERNO do gateway
// (http://kong:8000), então a URL assinada sai com esse host e o navegador não a abre. Na nuvem o SUPABASE_URL é o
// endereço público do projeto (https://<ref>.supabase.co), o mesmo do front (VITE_SUPABASE_URL), e a URL sai com ele.
// A Edge não pode "corrigir" nem fixar o host: se fixasse o interno, o download quebraria na nuvem; se o reescrevesse,
// passaria a depender de uma configuração a mais. Estes testes travam o contrato (sem Deno: só supabase-js e o texto
// dos arquivos): o host é o do createClient(SUPABASE_URL) e nenhum arquivo da função o reescreve.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "..");
const fonte = (arquivo: string) => readFileSync(join(RAIZ, arquivo), "utf8");

/** Storage de mentira: responde o que a API real responde ao POST /object/sign (caminho relativo com o token). */
function clienteComStorageFalso(urlDoProjeto: string) {
  const chamadas: string[] = [];
  const falso: typeof fetch = async (entrada) => {
    chamadas.push(String(entrada));
    return new Response(JSON.stringify({ signedURL: "/object/sign/crm-documentos/c1/d1/a.pdf?token=t0k3n" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const db = createClient(urlDoProjeto, "chave-de-teste", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: falso },
    // o Node 20 não traz WebSocket e o realtime não é usado aqui: um transporte de mentira evita o erro na criação
    realtime: { transport: class SemWebSocket {} as never },
  });
  return { db, chamadas };
}

describe("host da URL assinada (baixar-arquivo)", () => {
  it("na nuvem o host é o público do SUPABASE_URL", async () => {
    const { db, chamadas } = clienteComStorageFalso("https://exemplo.supabase.co");
    const r = await db.storage.from("crm-documentos").createSignedUrl("c1/d1/a.pdf", 60);
    expect(r.error).toBeNull();
    expect(r.data?.signedUrl).toBe("https://exemplo.supabase.co/storage/v1/object/sign/crm-documentos/c1/d1/a.pdf?token=t0k3n");
    expect(chamadas[0]).toBe("https://exemplo.supabase.co/storage/v1/object/sign/crm-documentos/c1/d1/a.pdf");
  });

  it("na stack local o mesmo código sai com o host que o ambiente informa (kong:8000): é o SUPABASE_URL, não um valor fixo", async () => {
    const { db } = clienteComStorageFalso("http://kong:8000");
    const r = await db.storage.from("crm-documentos").createSignedUrl("c1/d1/a.pdf", 60);
    expect(new URL(r.data!.signedUrl).host).toBe("kong:8000");
  });

  it("a Edge cria o cliente com o SUPABASE_URL do ambiente e não reescreve nem fixa o host da URL assinada", () => {
    expect(fonte("_shared/supabase.ts")).toMatch(/createClient\(exigirEnv\("SUPABASE_URL"\)/);
    const codigo = [fonte("baixar-arquivo/index.ts"), fonte("_shared/download.ts"), fonte("_shared/supabase.ts")].join("\n")
      // só o código: comentários explicam o assunto e podem citar os nomes
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const proibido of [/kong/i, /host\.docker\.internal/i, /\.supabase\.co/i, /localhost|127\.0\.0\.1/i]) {
      expect(codigo, `nenhum host fixo no código (${proibido})`).not.toMatch(proibido);
    }
    // a URL devolvida é a que o supabase-js montou, sem passar por new URL(...) nem replace(...)
    const edge = fonte("baixar-arquivo/index.ts").replace(/\/\/.*$/gm, "");
    expect(edge).toMatch(/url: assinada\.data\.signedUrl/);
    expect(edge).not.toMatch(/signedUrl\.(replace|split|slice)|new URL\(/);
  });
});

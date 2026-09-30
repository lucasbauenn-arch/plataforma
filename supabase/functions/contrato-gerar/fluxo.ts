// Fluxo da Edge Function contrato-gerar (docs/ARQUITETURA_EXPANSAO.md §6.3), sem Deno nem npm: o index.ts liga as
// portas (Supabase, Storage e o desenho do PDF com pdf-lib). Testado no Vitest em _shared/pdf.fluxo.test.ts (WP4R-09).
//
// A PERMISSÃO é da RPC contrato_dados_modelo, chamada com o JWT do usuário (escopo, criar_contrato, status e auditoria
// operacao/gerar). A service role só grava o arquivo no bucket contratos e chama a RPC de sistema
// contrato_registrar_documento.
//
// POST { contrato_id } → 200 { ok, versao, path } | 422 { codigo: "variaveis_faltando", detalhes: {desconhecidas, vazias} }
// Passos: dados do modelo (JWT) → renderizarModelo (marcação restrita, nunca HTML) → PDF → sha256 →
// upload <id>/minuta-v<n>-<sha8>.pdf → contrato_registrar_documento com a versão esperada. Concorrência (outro PDF ou
// simulação alterada no meio, WP4R-04): CONFLITO_VERSAO apaga o arquivo recém-enviado.
import { lerJson, type Respostas } from "../_shared/http.ts";
import { sha256Hex } from "../_shared/chaves.ts";
import { type BlocoRenderizado, renderizarModelo, type ValorVariavel } from "../_shared/modelo-contrato.ts";
import { type ChamarRpc, erroDaRpc } from "../_shared/d4sign.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const LIMITE_PDF = 20 * 1024 * 1024; // limite do bucket contratos

export interface PortasGeracao {
  /** Valida o JWT no Auth; devolve as RPCs com o JWT do usuário ou a resposta de erro pronta (401/503). */
  autenticar(req: Request, r: Respostas): Promise<{ rpc: ChamarRpc } | Response>;
  /** RPCs de sistema (service role). */
  sistema: ChamarRpc;
  /** Desenha o PDF (pdf-lib, só no Deno). */
  desenharPdf(blocos: BlocoRenderizado[], meta: { codigo: number; versao: number }): Promise<Uint8Array>;
  /** Grava no bucket contratos sem sobrescrever; `jaExistia` = o mesmo caminho (logo, o mesmo conteúdo) já estava lá. */
  salvarMinuta(caminho: string, pdf: Uint8Array): Promise<{ jaExistia: boolean }>;
  removerMinuta(caminho: string): Promise<void>;
}

interface DadosModelo {
  modelo: { id: string; chave: string; versao: number; titulo: string; conteudo: string };
  variaveis: Record<string, ValorVariavel>;
  codigo: number;
  pdf_versao: number;
}

export async function tratarGeracao(req: Request, r: Respostas, portas: PortasGeracao): Promise<Response> {
  const quem = await portas.autenticar(req, r);
  if (quem instanceof Response) return quem;

  const corpo = await lerJson(req);
  if (!corpo.ok) return r.erro(corpo.status, corpo.erro, { codigo: corpo.codigo });
  const id = typeof corpo.valor.contrato_id === "string" ? corpo.valor.contrato_id.toLowerCase() : "";
  if (!UUID.test(id)) return r.erro(422, "Contrato inválido.");

  // 1. dados com o JWT do usuário: escopo, permissão, status e auditoria ficam no banco
  const { data, error } = await quem.rpc("contrato_dados_modelo", { p_id: id });
  if (error) {
    const e = erroDaRpc(error);
    return r.erro(e.status, e.mensagem, { codigo: "rpc", detalhes: e.detalhes });
  }
  const dados = data as DadosModelo;

  // 2. texto: variável desconhecida ou usada e vazia bloqueia (nunca gera documento incompleto)
  const render = renderizarModelo(dados.modelo.conteudo, dados.variaveis);
  if (!render.ok) {
    return r.erro(422, "Faltam dados para gerar o contrato. Complete o cadastro do cliente e a configuração.", {
      codigo: "variaveis_faltando",
      detalhes: { desconhecidas: render.desconhecidas, vazias: render.vazias },
    });
  }

  // 3. PDF e hashes (a versão é a esperada pelo banco no momento da leitura: pdf_versao + 1)
  const versao = dados.pdf_versao + 1;
  const pdf = await portas.desenharPdf(render.blocos, { codigo: dados.codigo, versao });
  if (pdf.byteLength > LIMITE_PDF) return r.erro(422, "O contrato ficou grande demais para gerar o PDF.");
  const sha = await sha256Hex(pdf);
  const textoSha = await sha256Hex(render.texto);
  const caminho = `${id}/minuta-v${versao}-${sha.slice(0, 8)}.pdf`;

  // 4. arquivo e registro com a versão esperada
  const { jaExistia } = await portas.salvarMinuta(caminho, pdf);
  const registro = await portas.sistema("contrato_registrar_documento", {
    p_id: id, p_versao: versao, p_path: caminho, p_sha256: sha, p_texto_sha256: textoSha,
  });
  if (registro.error) {
    if (!jaExistia) await portas.removerMinuta(caminho);
    const e = erroDaRpc(registro.error);
    return r.erro(e.status, e.status === 409 ? "O contrato mudou enquanto o PDF era gerado. Gere de novo." : e.mensagem, {
      codigo: "rpc",
      detalhes: e.detalhes,
    });
  }
  return r.json({ ok: true, versao, path: caminho });
}

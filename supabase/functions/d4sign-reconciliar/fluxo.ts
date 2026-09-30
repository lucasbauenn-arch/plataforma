// Fluxo da Edge Function d4sign-reconciliar (docs/ARQUITETURA_EXPANSAO.md §6.5), sem Deno nem npm: o index.ts liga
// as portas (service role, segredo do cron e do D4Sign). Testado no Vitest em _shared/d4sign.fluxos.test.ts (WP4R-09).
//
// Reconsulta no D4Sign os contratos em assinatura_pendente sem atualização há mais de 1 h (webhook perdido ou que
// falhou) e faz o mesmo processamento do webhook (contrato_registrar_retorno, idempotente). Processa no máximo
// MAXIMO_POR_EXECUCAO por vez ⚑ (limite de requisições da conta D4Sign), começando pelos consultados há mais tempo,
// para que nenhum fique sem reconsulta. A resposta traz só contagens (sem dado pessoal).
import { mensagemSegura, type Respostas } from "../_shared/http.ts";
import {
  type ChamarRpc, exigirRpc, type FabricaD4sign, linhaChamada, type LinhaChamada, reconsultarDocumento,
} from "../_shared/d4sign.ts";

export const MAXIMO_POR_EXECUCAO = 10;
const UMA_HORA = 3600_000;

export interface PortasReconciliacao {
  /** Cabeçalho x-cron-secret confere com CRON_SEGREDO (tempo constante; segredo curto ou ausente recusa sempre). */
  autorizado(req: Request): boolean;
  d4sign: FabricaD4sign;
  /** Contratos em assinatura_pendente com documento, sem atualização desde `limite` (os mais antigos primeiro). */
  pendentes(limite: string): Promise<{ id: string; d4sign_uuid: string }[]>;
  /** Consultas de documento (integracao_chamadas 'consultar_documento') desses contratos desde `desde`. */
  ultimasConsultas(ids: string[], desde: string): Promise<{ entidade_id: string; criado_em: string }[]>;
  gravarChamada(linha: LinhaChamada): Promise<void>;
  salvarPdfAssinado(caminho: string, pdf: Uint8Array): Promise<void>;
  sistema: ChamarRpc;
  log(mensagem: string): void;
  agora?: () => number;
}

export async function tratarReconciliacao(req: Request, r: Respostas, portas: PortasReconciliacao): Promise<Response> {
  if (!portas.autorizado(req)) return r.erro(401, "Não autorizado");
  if (!portas.d4sign.ok) {
    portas.log(`configuração do D4Sign: ${portas.d4sign.erro}`);
    return r.erro(503, "D4Sign não configurado");
  }
  const d4sign = portas.d4sign;

  const agora = (portas.agora ?? Date.now)();
  const lista = await portas.pendentes(new Date(agora - UMA_HORA).toISOString());
  if (!lista.length) return r.json({ ok: true, pendentes: 0, consultados: 0, atualizados: 0, falhas: 0 });

  // rodízio: os que foram reconsultados há mais tempo (ou nunca) primeiro
  const consultas = await portas.ultimasConsultas(lista.map((k) => k.id), new Date(agora - 7 * 24 * UMA_HORA).toISOString());
  const ultima = new Map<string, string>();
  for (const c of consultas) {
    if ((ultima.get(c.entidade_id) ?? "") < c.criado_em) ultima.set(c.entidade_id, c.criado_em);
  }
  const vez = [...lista].sort((a, b) => (ultima.get(a.id) ?? "").localeCompare(ultima.get(b.id) ?? "")).slice(0, MAXIMO_POR_EXECUCAO);

  let atualizados = 0;
  let falhas = 0;
  for (const k of vez) {
    const api = d4sign.criar(async (c) => {
      try {
        await portas.gravarChamada(linhaChamada(c, k.id));
      } catch (e) {
        portas.log(`integracao_chamadas: ${mensagemSegura(e)}`);
      }
    });
    try {
      const status = await reconsultarDocumento({
        api,
        salvarPdfAssinado: portas.salvarPdfAssinado,
        async registrarRetorno(args) {
          await exigirRpc(portas.sistema, "contrato_registrar_retorno", { ...args });
        },
      }, k.id, k.d4sign_uuid);
      if (status && status !== "assinatura_pendente") atualizados++;
    } catch (e) {
      falhas++;
      portas.log(`contrato ${k.id}: ${mensagemSegura(e)}`);
    }
  }
  return r.json({ ok: true, pendentes: lista.length, consultados: vez.length, atualizados, falhas });
}

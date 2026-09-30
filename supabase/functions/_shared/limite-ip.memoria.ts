// Armazém de tentativas EM MEMÓRIA, só para os testes (Vitest) do limite por IP: imita tentativas_reservar e
// tentativas_confirmar (migration 20260929000019) com a mesma semântica do banco: janela por balde, decisão de
// `decidirLimite`, reserva de todos os baldes ou de nenhum, e (modo atômico) uma reserva por vez, como a trava
// consultiva por rota + IP faz. O modo `atomico: false` reproduz o defeito do FR1-01 (conferir e gravar em passos
// separados) para provar que os testes de concorrência enxergam a corrida. Não é importado por nenhuma Edge Function.
import { type ArmazemTentativas, decidirLimite, type PedidoBalde, type RespostaReserva } from "./limite-ip.ts";

export type LinhaTentativa = { id: number; rota: string; ip: string | null; sucesso: boolean; criado_em: Date };

export type OpcoesArmazemMemoria = {
  relogio?: () => Date;
  /** espera (ms) antes de cada ida ao "banco" (rede), para as requisições se sobreporem */
  latenciaMs?: number;
  /** true (padrão): reserva atômica, uma por vez, como a RPC; false: conferir e gravar em passos separados (a corrida) */
  atomico?: boolean;
};

const HORA_MS = 3_600_000;
const esperar = (ms: number) => (ms > 0 ? new Promise<void>((ok) => setTimeout(ok, ms)) : Promise.resolve());
/** cede a vez ao laço de eventos: é o intervalo entre conferir e gravar, onde a corrida acontece sem a trava */
const ceder = () => new Promise<void>((ok) => setImmediate(ok));

export function armazemEmMemoria(opcoes: OpcoesArmazemMemoria = {}) {
  const relogio = opcoes.relogio ?? (() => new Date());
  const atomico = opcoes.atomico ?? true;
  const linhas: LinhaTentativa[] = [];
  const chamadas = { reservar: 0, confirmar: 0 };
  let sequencia = 0;
  let fila: Promise<unknown> = Promise.resolve();

  /** a trava consultiva: só uma reserva dentro da seção crítica por vez */
  const serializado = <T>(trabalho: () => Promise<T>): Promise<T> => {
    const feito = fila.then(trabalho, trabalho);
    fila = feito.catch(() => undefined);
    return feito;
  };

  const contar = (b: PedidoBalde, agora: Date) => {
    const desde = new Date(agora.getTime() - b.janela_segundos * 1000);
    const achadas = linhas.filter((l) => l.rota === b.rota && l.ip === b.ip && l.criado_em >= desde).slice(0, b.max_total);
    return { total: achadas.length, erros: achadas.filter((l) => !l.sucesso).length };
  };
  const regraDe = (b: PedidoBalde) => ({
    rota: b.rota, janelaMs: b.janela_segundos * 1000, maxErros: b.max_erros, maxTotal: b.max_total,
  });

  async function reservarAgora(baldes: PedidoBalde[]): Promise<RespostaReserva> {
    const agora = relogio();
    for (const b of baldes) {
      const d = decidirLimite(contar(b, agora), regraDe(b));
      if (!d.permitido) return { permitido: false, motivo: d.motivo as "erros" | "total", rota: b.rota };
    }
    await ceder(); // sem a trava, outra requisição conferiria agora a mesma contagem (a corrida do FR1-01)
    const ids = baldes.map((b) => {
      const linha: LinhaTentativa = { id: ++sequencia, rota: b.rota, ip: b.ip, sucesso: false, criado_em: agora };
      linhas.push(linha);
      return linha.id;
    });
    return { permitido: true, ids };
  }

  const armazem: ArmazemTentativas = {
    async reservar(baldes) {
      chamadas.reservar++;
      await esperar(opcoes.latenciaMs ?? 0);
      return atomico ? serializado(() => reservarAgora(baldes)) : reservarAgora(baldes);
    },
    async confirmar(ids) {
      chamadas.confirmar++;
      await esperar(opcoes.latenciaMs ?? 0);
      const agora = relogio();
      for (const id of ids) {
        const linha = linhas.find((l) => l.id === id);
        if (linha && !linha.sucesso && agora.getTime() - linha.criado_em.getTime() < HORA_MS) linha.sucesso = true;
      }
    },
  };
  return { armazem, linhas, chamadas };
}

/** Armazém que sempre falha, como o banco fora do ar. */
export const armazemQuebrado: ArmazemTentativas = {
  reservar: () => Promise.reject(new Error("banco fora")),
  confirmar: () => Promise.reject(new Error("banco fora")),
};

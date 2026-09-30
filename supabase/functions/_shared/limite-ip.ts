// Limite de tentativas por IP nas funções públicas, sobre a tabela `tentativas_publicas`
// (id, rota, ip, sucesso, criado_em — migration 20260929000002, docs/ARQUITETURA_EXPANSAO.md §3.9; só a service
// role acessa). Numa janela, conta os erros (varredura) e o total.
//   pre-cadastro (§6.1): 10 erros ou 20 tentativas em 15 min → 429.
//   enviar-lead (formulário de contato, WP7R1-05): a mesma regra. O login do portal (cliente-login/portal.ts) usa as suas.
// Decisões:
//   - RESERVA ATÔMICA (FR1-01): conferir e gravar são um passo só, no banco (RPC tentativas_reservar, migration 19, sob
//     trava por rota+IP). Conferir no início e gravar no fim deixava uma rajada de requisições simultâneas passar
//     inteira pelo limite. A tentativa entra já como FALHA; quem termina com sucesso a confirma (`concluir(true)`);
//     quem cai no meio do caminho continua contado como falha (o lado conservador);
//   - IPv6 é agrupado pela rede /64 (um usuário costuma ter a /64 inteira e trocaria de IP a cada tentativa);
//   - sem IP identificável, todas as tentativas dividem um único balde (`ip` nulo), em vez de ficarem sem limite;
//   - banco fora do ar (ou resposta ilegível) → recusa (503), nunca libera sem contar.
// Módulo PURO: o acesso ao banco entra por `ArmazemTentativas`; a implementação com supabase-js fica em
// `supabase.ts` (armazemTentativas). A regra do banco é a mesma de `decidirLimite` (que também serve de referência).
import { gruposIpv6, normalizarIp } from "./http.ts";

export type RegraLimite = {
  /** nome da rota gravado em tentativas_publicas.rota (ex.: "pre-cadastro") */
  rota: string;
  janelaMs: number;
  /** tentativas com sucesso = false na janela */
  maxErros: number;
  /** todas as tentativas na janela */
  maxTotal: number;
};

export const REGRA_PRE_CADASTRO: RegraLimite = Object.freeze({
  rota: "pre-cadastro",
  janelaMs: 15 * 60_000,
  maxErros: 10,
  maxTotal: 20,
});

/** Formulário de contato do site (enviar-lead): 10 erros ou 20 envios por IP em 15 min. */
export const REGRA_ENVIAR_LEAD: RegraLimite = Object.freeze({
  rota: "enviar-lead",
  janelaMs: 15 * 60_000,
  maxErros: 10,
  maxTotal: 20,
});

export type ContagemTentativas = { total: number; erros: number };

export type DecisaoLimite =
  | { permitido: true }
  | { permitido: false; motivo: "erros" | "total" | "indisponivel"; tenteEmSegundos: number };

/** Recusa do limite (429 por erros ou total; 503 quando o banco falhou). */
export type BloqueioLimite = Exclude<DecisaoLimite, { permitido: true }>;

/** Um balde da reserva: a regra e o IP (a chave real do balde sai de `chaveIp`). */
export type BaldeLimite = { regra: RegraLimite; ip: string | null | undefined };

/** Corpo de cada balde na RPC tentativas_reservar (migration 19). */
export type PedidoBalde = {
  rota: string;
  ip: string | null;
  janela_segundos: number;
  max_erros: number;
  max_total: number;
};

export type RespostaReserva =
  | { permitido: true; ids: number[] }
  | { permitido: false; motivo: "erros" | "total"; rota: string };

/** Porta de acesso ao banco (implementada com a service role em `supabase.ts`). */
export interface ArmazemTentativas {
  /**
   * Confere a janela de cada balde e, havendo folga em TODOS, grava uma tentativa-falha em cada um — tudo numa
   * transação, sob trava por (rota, IP). Sem folga em algum: nada é gravado.
   */
  reservar(baldes: PedidoBalde[]): Promise<RespostaReserva>;
  /** marca como sucesso as reservas (ids devolvidos por `reservar`) */
  confirmar(ids: number[]): Promise<void>;
}

/** Mesmo CHECK de tentativas_publicas.rota na migration 20260929000002. */
const ROTA = /^[a-z0-9_-]{1,60}$/;

/** Máximo de baldes por chamada (o mesmo da RPC). */
export const MAX_BALDES = 4;

/** Recusa configuração absurda (erro de programação, não de usuário). */
export function validarRegra(regra: RegraLimite): void {
  if (!ROTA.test(regra.rota)) throw new Error(`Regra de limite: rota inválida "${regra.rota}"`);
  if (!Number.isInteger(regra.janelaMs) || regra.janelaMs < 1000) throw new Error("Regra de limite: janela inválida");
  if (!Number.isInteger(regra.maxTotal) || regra.maxTotal < 1) throw new Error("Regra de limite: maxTotal inválido");
  if (!Number.isInteger(regra.maxErros) || regra.maxErros < 1 || regra.maxErros > regra.maxTotal) {
    throw new Error("Regra de limite: maxErros precisa estar entre 1 e maxTotal");
  }
}

/**
 * Chave de IP usada no limite: IPv4 como veio; IPv6 reduzido à rede /64 (ex.: "2001:db8:1:2::"); inválido ou
 * ausente → nulo (balde comum dos sem IP).
 */
export function chaveIp(ip: string | null | undefined): string | null {
  const n = normalizarIp(ip);
  if (!n || !n.includes(":")) return n;
  const g = gruposIpv6(n);
  if (!g) return null;
  return normalizarIp(`${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::`);
}

export const inicioDaJanela = (agora: Date, regra: RegraLimite) => new Date(agora.getTime() - regra.janelaMs);

/**
 * A regra do limite sobre uma contagem: chegou ao máximo → bloqueia (10 erros já bloqueiam a 11ª tentativa).
 * O banco aplica esta mesma regra dentro de tentativas_reservar; aqui ela é a referência (e o armazém em memória dos
 * testes a usa).
 */
export function decidirLimite(contagem: ContagemTentativas, regra: RegraLimite): DecisaoLimite {
  const tenteEmSegundos = Math.ceil(regra.janelaMs / 1000);
  if (contagem.erros >= regra.maxErros) return { permitido: false, motivo: "erros", tenteEmSegundos };
  if (contagem.total >= regra.maxTotal) return { permitido: false, motivo: "total", tenteEmSegundos };
  return { permitido: true };
}

/** Reserva concedida: ao terminar a operação, `concluir` diz se ela foi aceita. */
export type Reserva = {
  readonly permitido: true;
  /**
   * Fecha a reserva. `true` (operação aceita) marca as tentativas como sucesso; `false` deixa como falha, que já é
   * o estado delas (por isso não custa ida ao banco). Só a primeira chamada vale (as seguintes devolvem o mesmo
   * resultado). Nunca lança; devolve `false` se não conseguiu confirmar (a tentativa segue contada como falha: erra para o lado do bloqueio, não do vazamento).
   */
  concluir(sucesso: boolean): Promise<boolean>;
};

export type ResultadoReserva = Reserva | BloqueioLimite;

const INDISPONIVEL: BloqueioLimite = Object.freeze({ permitido: false, motivo: "indisponivel", tenteEmSegundos: 60 });

/** Valida a resposta da RPC (nunca confia no formato: resposta estranha vira "indisponível", não "liberado"). */
export function lerRespostaReserva(dados: unknown, esperados: number): RespostaReserva {
  if (typeof dados !== "object" || dados === null) throw new Error("tentativas_reservar: resposta inválida");
  const d = dados as { permitido?: unknown; motivo?: unknown; rota?: unknown; ids?: unknown };
  if (d.permitido === true) {
    const ids = d.ids;
    if (
      !Array.isArray(ids) || ids.length !== esperados ||
      !ids.every((x) => typeof x === "number" && Number.isSafeInteger(x) && x > 0)
    ) {
      throw new Error("tentativas_reservar: ids inválidos");
    }
    return { permitido: true, ids: ids as number[] };
  }
  if (d.permitido === false && (d.motivo === "erros" || d.motivo === "total")) {
    return { permitido: false, motivo: d.motivo, rota: typeof d.rota === "string" ? d.rota : "" };
  }
  throw new Error("tentativas_reservar: resposta inválida");
}

/**
 * Reserva uma tentativa em cada balde, de uma vez (todos ou nenhum) e sem corrida: requisições simultâneas do mesmo
 * IP são serializadas pelo banco, então no máximo `maxErros` delas passam. Chame ANTES de processar o pedido e feche
 * com `concluir(sucesso)` no fim. Falha do banco → `indisponivel` (responder 503).
 */
export async function reservarTentativa(
  armazem: ArmazemTentativas,
  baldes: readonly BaldeLimite[],
): Promise<ResultadoReserva> {
  if (baldes.length < 1 || baldes.length > MAX_BALDES) throw new Error(`Reserva de tentativas: de 1 a ${MAX_BALDES} baldes`);
  for (const b of baldes) validarRegra(b.regra);
  const pedido: PedidoBalde[] = baldes.map((b) => ({
    rota: b.regra.rota,
    ip: chaveIp(b.ip),
    janela_segundos: Math.ceil(b.regra.janelaMs / 1000),
    max_erros: b.regra.maxErros,
    max_total: b.regra.maxTotal,
  }));

  let resposta: RespostaReserva;
  try {
    resposta = await armazem.reservar(pedido);
  } catch {
    return INDISPONIVEL;
  }
  if (!resposta.permitido) {
    // a espera é a janela do balde que bloqueou (o global e o do IP do portal têm a mesma, mas não é obrigatório)
    const balde = baldes.find((x) => x.regra.rota === resposta.rota) ?? baldes[0];
    return { permitido: false, motivo: resposta.motivo, tenteEmSegundos: Math.ceil(balde.regra.janelaMs / 1000) };
  }

  let fechamento: Promise<boolean> | null = null;
  return {
    permitido: true,
    concluir(sucesso: boolean): Promise<boolean> {
      fechamento ??= (async () => {
        if (!sucesso) return true;
        try {
          await armazem.confirmar(resposta.ids);
          return true;
        } catch {
          return false;
        }
      })();
      return fechamento;
    },
  };
}

/** Mensagem para o 429, com os minutos da janela da regra. */
export function mensagemLimite(regra: RegraLimite): string {
  const minutos = Math.max(1, Math.ceil(regra.janelaMs / 60_000));
  return `Muitas tentativas. Aguarde ${minutos} ${minutos === 1 ? "minuto" : "minutos"} e tente de novo.`;
}

/** Status e cabeçalho para responder a um bloqueio: 429 com Retry-After, ou 503 se o banco falhou. */
export function respostaDoBloqueio(d: BloqueioLimite, regra: RegraLimite) {
  return d.motivo === "indisponivel"
    ? { status: 503 as const, mensagem: "Serviço indisponível no momento. Tente de novo em instantes.", codigo: "indisponivel", cabecalhos: { "Retry-After": String(d.tenteEmSegundos) } }
    : { status: 429 as const, mensagem: mensagemLimite(regra), codigo: "muitas_tentativas", cabecalhos: { "Retry-After": String(d.tenteEmSegundos) } };
}

// Regras da sessão no navegador, sem React nem Supabase (testadas em sessao.test.ts):
// - o que fazer com o cache quando o Auth avisa uma mudança de sessão (troca de usuário, 2FA concluída, token novo);
// - o vigia de inatividade H1 (docs/ARQUITETURA_EXPANSAO.md §1.1), montado por src/hooks/useInatividade.ts.

/** Eventos de `supabase.auth.onAuthStateChange` (supabase-js v2). */
export type EventoAuth =
  | 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY'
  | 'MFA_CHALLENGE_VERIFIED'

/**
 * Eventos que trocam o JWT sem trocar de usuário. O escopo (`meu_escopo()`) depende do JWT: `aal` e, por ele,
 * `interno` e as permissões quando a 2FA é exigida. Depois do TOTP (MFA_CHALLENGE_VERIFIED) o cache ainda diria
 * `aal1` e o admin ficaria preso na tela de Segurança; a renovação do token também é a hora de reler status e papel.
 */
const EVENTOS_QUE_TROCAM_O_JWT: ReadonlySet<string> = new Set(['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'MFA_CHALLENGE_VERIFIED'])

export type AcaoSessao = 'limpar_cache' | 'recarregar_escopo' | 'nada'

/**
 * - troca de usuário ou saída: `limpar_cache` (nada do usuário anterior fica: escopo, fichas, listas);
 * - mesmo usuário com JWT novo: `recarregar_escopo`;
 * - sessão inicial (o AuthProvider já carrega) ou evento sem efeito no escopo: `nada`.
 */
export function acaoAoMudarSessao(evento: EventoAuth | string, uidAntes: string | null, uidDepois: string | null): AcaoSessao {
  if (evento === 'INITIAL_SESSION') return 'nada'
  if (uidDepois !== uidAntes) return 'limpar_cache'
  if (uidDepois && EVENTOS_QUE_TROCAM_O_JWT.has(evento)) return 'recarregar_escopo'
  return 'nada'
}

// ---------- H1: inatividade ----------

/**
 * Escopo do `signOut` quando a inatividade expira: `local` encerra SÓ esta sessão (a do navegador esquecido aberto).
 * O padrão do supabase-js é `global`, que revogaria também a sessão que a pessoa está usando no celular.
 */
export const ESCOPO_SAIDA_INATIVIDADE = 'local' as const

type Armazenamento = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface OpcoesVigia {
  /** Chave da última atividade no armazenamento (por sessão do Auth), compartilhada entre abas. */
  chave: string
  limiteMs: number
  /** `localStorage`; nulo (ou com erro) vale só a memória desta aba. */
  armazenamento: Armazenamento | null
  agora: () => number
  /** Chamado uma única vez quando o limite é atingido, com o escopo do `signOut`. */
  aoExpirar: (escopo: typeof ESCOPO_SAIDA_INATIVIDADE) => void
  /** Grava a atividade no armazenamento no máximo a cada N ms (padrão 15 s). */
  gravarNoMaximoACadaMs?: number
}

export interface VigiaInatividade {
  /** Atividade do usuário nesta aba. */
  atividade: () => void
  /** Confere o limite (considera a atividade de outras abas); expira se passou. */
  verificar: () => void
  readonly expirou: boolean
}

/** Vigia de inatividade: a última atividade vale entre abas e quando o navegador reabre com a sessão guardada. */
export function criarVigiaInatividade(o: OpcoesVigia): VigiaInatividade {
  const intervaloGravacao = o.gravarNoMaximoACadaMs ?? 15_000
  const ler = (): number | null => {
    try { return Number(o.armazenamento?.getItem(o.chave)) || null } catch { return null }
  }
  const gravar = (t: number) => {
    try { o.armazenamento?.setItem(o.chave, String(t)) } catch { /* sem armazenamento: vale a memória desta aba */ }
  }

  const guardada = ler()
  let ultima = guardada ?? o.agora()
  let gravadaEm = Number.NEGATIVE_INFINITY
  let expirou = false
  if (guardada === null) gravar(ultima)

  const expirar = () => {
    if (expirou) return
    expirou = true
    try { o.armazenamento?.removeItem(o.chave) } catch { /* nada a limpar */ }
    o.aoExpirar(ESCOPO_SAIDA_INATIVIDADE)
  }

  return {
    atividade() {
      if (expirou) return
      const agora = o.agora()
      ultima = agora
      if (agora - gravadaEm >= intervaloGravacao) {
        gravadaEm = agora
        gravar(agora)
      }
    },
    verificar() {
      if (expirou) return
      const outraAba = ler()
      if (outraAba && outraAba > ultima) ultima = outraAba
      if (o.agora() - ultima >= o.limiteMs) expirar()
    },
    get expirou() { return expirou },
  }
}

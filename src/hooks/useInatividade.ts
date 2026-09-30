import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useEscopo } from '@/lib/escopo'
import { criarVigiaInatividade } from '@/lib/sessao'

// H1 (docs/ARQUITETURA_EXPANSAO.md §1.1): encerra a sessão depois de `sessao_inatividade_horas` sem uso.
// É um controle fraco (roda no navegador); o controle forte é o `inactivity_timeout` do Auth, se o plano permitir.
// A última atividade fica no localStorage por sessão do Auth, então vale entre abas e também quando o navegador é
// reaberto com a sessão ainda guardada. Um login novo gera outra sessão e começa do zero.
// A regra (limite, outras abas, expirar uma vez, escopo `local` do signOut) está em src/lib/sessao.ts.

const HORAS_PADRAO = 8
const VERIFICAR_A_CADA_MS = 60_000
const EVENTOS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'mousemove'] as const

/** `session_id` do JWT do Supabase (estável entre renovações do token); sem ele, o id do usuário. */
function idDaSessao(token: string | undefined, usuario: string | undefined): string | null {
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { session_id?: unknown }
    if (typeof payload.session_id === 'string' && payload.session_id) return payload.session_id
  } catch {
    // token sem o formato esperado: usa o usuário
  }
  return usuario ?? null
}

function armazenamentoLocal(): Storage | null {
  try { return window.localStorage } catch { return null }
}

/** Montado nos layouts do admin e da área de parceiros e no portal do cliente (login só por CPF, o mais fraco). */
export function useInatividade() {
  const { session, encerrarSessao } = useAuth()
  const { escopo } = useEscopo()
  const horas = escopo?.sessao_inatividade_horas ?? HORAS_PADRAO
  const sessao = idDaSessao(session?.access_token, session?.user.id)
  const encerrarRef = useRef(encerrarSessao)
  useEffect(() => { encerrarRef.current = encerrarSessao })

  useEffect(() => {
    if (!sessao || !(horas > 0)) return
    const vigia = criarVigiaInatividade({
      chave: `arken:atividade:${sessao}`,
      limiteMs: horas * 3_600_000,
      armazenamento: armazenamentoLocal(),
      agora: Date.now,
      aoExpirar: (escopoSaida) => {
        toast.info('Sessão encerrada por inatividade. Entre novamente.')
        // escopo 'local': só ESTA sessão; as sessões em outros dispositivos continuam
        void encerrarRef.current(escopoSaida)
      },
    })
    const atividade = () => vigia.atividade()
    const aoVoltar = () => { if (document.visibilityState === 'visible') vigia.verificar() }

    vigia.verificar()
    for (const ev of EVENTOS) window.addEventListener(ev, atividade, { passive: true })
    document.addEventListener('visibilitychange', aoVoltar)
    const intervalo = setInterval(() => vigia.verificar(), VERIFICAR_A_CADA_MS)
    return () => {
      for (const ev of EVENTOS) window.removeEventListener(ev, atividade)
      document.removeEventListener('visibilitychange', aoVoltar)
      clearInterval(intervalo)
    }
  }, [sessao, horas])
}

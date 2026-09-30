import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { chaveEscopo, EscopoContexto, useConsultaEscopo } from './escopo'
import { acaoAoMudarSessao } from './sessao'
import type { Escopo, Profile } from './types'

/** `local`: só esta sessão (este navegador); `global`: todas as sessões do usuário, em todos os dispositivos. */
export type EscopoSaida = 'local' | 'global'

interface AuthCtx {
  session: Session | null
  profile: Profile | null
  /** Sessão válida, mas o perfil não pôde ser lido (rede ou perfil inexistente). */
  erroPerfil: boolean
  carregando: boolean
  /** Escopo de `meu_escopo()` (nulo sem sessão ou enquanto carrega). Detalhes em `useEscopo()`. */
  escopo: Escopo | null
  recarregarPerfil: () => Promise<void>
  /** Botão "Sair": encerra todas as sessões do usuário (escopo `global`, o padrão do supabase-js). */
  sair: () => Promise<void>
  /** Encerra a sessão com o escopo escolhido. A inatividade (H1) usa `local`: não derruba o celular da pessoa. */
  encerrarSessao: (escopo: EscopoSaida) => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [erroPerfil, setErroPerfil] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const uidAtual = useRef<string | null>(null)

  async function carregarPerfil(uid: string | undefined) {
    if (!uid) {
      setProfile(null)
      setErroPerfil(false)
      return
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    setProfile((data as Profile) ?? null)
    setErroPerfil(!!error || !data)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      uidAtual.current = data.session?.user.id ?? null
      setSession(data.session)
      await carregarPerfil(data.session?.user.id)
      setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      const uid = s?.user.id ?? null
      const acao = acaoAoMudarSessao(evento, uidAtual.current, uid)
      // saída ou troca de usuário: nada do usuário anterior fica no cache (escopo, fichas, listas)
      if (acao === 'limpar_cache') qc.clear()
      // mesmo usuário com JWT novo (2FA concluída, token renovado): o escopo depende do aal do JWT. Fora do
      // callback (setTimeout), como o perfil: a consulta chama o supabase-js, que não pode ser aguardado aqui.
      if (acao === 'recarregar_escopo' && uid) setTimeout(() => { void qc.invalidateQueries({ queryKey: chaveEscopo(uid) }) }, 0)
      uidAtual.current = uid
      setSession(s)
      // evita deadlock: não aguardar chamadas supabase dentro do callback
      setTimeout(() => carregarPerfil(uid ?? undefined), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  // também para o cliente do portal: o escopo dele traz `sessao_inatividade_horas` (H1) e nenhuma permissão
  const estadoEscopo = useConsultaEscopo(profile?.id ?? null, !!session && !!profile)

  async function encerrarSessao(escopo: EscopoSaida) {
    await supabase.auth.signOut({ scope: escopo })
    setProfile(null)
    qc.clear()
  }

  return (
    <Ctx.Provider
      value={{
        session,
        profile,
        erroPerfil,
        carregando,
        escopo: estadoEscopo.escopo,
        recarregarPerfil: () => carregarPerfil(session?.user.id),
        sair: () => encerrarSessao('global'),
        encerrarSessao,
      }}
    >
      <EscopoContexto.Provider value={estadoEscopo}>{children}</EscopoContexto.Provider>
    </Ctx.Provider>
  )
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth fora do AuthProvider')
  return c
}

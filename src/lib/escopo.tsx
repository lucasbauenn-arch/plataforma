// Escopo do usuário logado, vindo de `meu_escopo()` (TanStack Query, chave ['escopo', uid]).
// O AuthProvider (src/lib/auth.tsx) consulta e expõe; as telas leem com `useEscopo()`.
// O escopo só decide o que a tela mostra: quem decide o acesso de verdade é o servidor (RPC e RLS).

import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { meuEscopo } from './rpc'
import { traduzirErro, type ErroRpc } from './erros'
import { temPermissao } from './menu'
import type { Escopo, Permissao } from './types'

export interface EstadoEscopo {
  escopo: Escopo | null
  /** Consulta em andamento (só quando há sessão). */
  carregando: boolean
  erro: ErroRpc | null
  recarregar: () => void
  tem: (p: Permissao) => boolean
}

const semEscopo: EstadoEscopo = { escopo: null, carregando: false, erro: null, recarregar: () => {}, tem: () => false }

export const EscopoContexto = createContext<EstadoEscopo>(semEscopo)

export const chaveEscopo = (uid: string | null) => ['escopo', uid] as const

/** Usada só pelo AuthProvider. `habilitado` = há perfil logado (o cliente do portal também: o escopo dele só traz o tempo de inatividade). */
export function useConsultaEscopo(uid: string | null, habilitado: boolean): EstadoEscopo {
  const q = useQuery({
    queryKey: chaveEscopo(uid),
    enabled: habilitado && !!uid,
    queryFn: async () => {
      const e = await meuEscopo()
      if (!e) throw traduzirErro({ message: 'Escopo vazio', code: '42501' }, 'meu_escopo')
      return e
    },
    staleTime: 30_000,
    // status, papel e permissões mudam por ação de outra pessoa (aprovação, bloqueio): confere ao voltar para a aba
    refetchOnWindowFocus: true,
    retry: 1,
  })
  if (!habilitado || !uid) return semEscopo
  const escopo = q.data ?? null
  return {
    escopo,
    carregando: q.isPending,
    // falha numa reconsulta em segundo plano mantém o escopo anterior (o servidor confere tudo de novo em cada RPC)
    erro: q.error && !escopo ? traduzirErro(q.error, 'meu_escopo') : null,
    recarregar: () => { void q.refetch() },
    tem: (p) => temPermissao(escopo, p),
  }
}

/** Escopo atual (`null` sem sessão ou enquanto carrega). */
export function useEscopo(): EstadoEscopo {
  return useContext(EscopoContexto)
}

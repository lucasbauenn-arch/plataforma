import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useEscopo } from '@/lib/escopo'
import { destinoPorPapel } from '@/lib/menu'
import type { Papel, Permissao } from '@/lib/types'
import { Carregando } from './Estados'
import { EstadoAcesso } from './app/EstadoAcesso'

/**
 * Guarda de rota no front (a barreira de verdade é o servidor: RPC e RLS).
 * - sem sessão → `redirecionar` (tela de login), guardando a rota pedida em `state.de`;
 * - colaborador → "acesso ainda não liberado" (A8);
 * - papel fora de `papeis` → a área do próprio papel (ex.: parceiro que digita /admin vai para /parceiros/painel);
 * - `permissao` ausente em `meu_escopo().permissoes` → "sem acesso a esta área".
 * Sem `papeis`, qualquer papel logado passa (use dentro de um layout já protegido, só com `permissao`).
 */
export function Protegido({ papeis, permissao, redirecionar = '/parceiros', children }: {
  papeis?: Papel[]
  permissao?: Permissao
  redirecionar?: string
  children: ReactNode
}) {
  const { session, profile, erroPerfil, carregando, recarregarPerfil } = useAuth()
  const escopo = useEscopo()
  const loc = useLocation()

  if (carregando || (session && !profile && !erroPerfil)) return <div className="pt-32"><Carregando /></div>
  if (!session) return <Navigate to={redirecionar} replace state={{ de: loc.pathname + loc.search }} />
  if (!profile) return <EstadoAcesso tipo="erro_perfil" tentarDeNovo={recarregarPerfil} />
  if (profile.papel === 'colaborador') return <EstadoAcesso tipo="nao_liberado" />

  if (papeis && !papeis.includes(profile.papel)) {
    const destino = destinoPorPapel(profile.papel)
    // já está na área do próprio papel e ela também recusa: mostra a tela em vez de redirecionar em círculo
    if (loc.pathname === destino || loc.pathname.startsWith(destino + '/')) return <EstadoAcesso tipo="sem_permissao" />
    return <Navigate to={destino} replace />
  }

  if (permissao) {
    if (escopo.carregando) return <Carregando />
    if (escopo.erro || !escopo.escopo) {
      return <EstadoAcesso tipo="erro_escopo" inline detalhe={escopo.erro?.message} tentarDeNovo={escopo.recarregar} />
    }
    if (!escopo.tem(permissao)) {
      return (
        <EstadoAcesso
          tipo="sem_permissao" inline
          acao={<Link to={destinoPorPapel(profile.papel)} className="btn-primary">Voltar ao início</Link>}
        />
      )
    }
  }
  return <>{children}</>
}

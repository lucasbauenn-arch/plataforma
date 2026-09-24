import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { Carregando } from './Estados'
import type { Papel } from '@/lib/types'

export function Protegido({ papeis, redirecionar, children }: { papeis: Papel[]; redirecionar: string; children: ReactNode }) {
  const { session, profile, carregando } = useAuth()
  const loc = useLocation()
  if (carregando || (session && !profile)) return <div className="pt-32"><Carregando /></div>
  if (!session || !profile || !papeis.includes(profile.papel)) {
    return <Navigate to={redirecionar} replace state={{ de: loc.pathname }} />
  }
  return <>{children}</>
}

import { NavLink, Outlet } from 'react-router-dom'
import { Building2, Users, FileText, LogOut, Clock } from 'lucide-react'
import { useAuth } from '@/lib/auth'

const abas = [
  { to: '/parceiros/painel', label: 'Empreendimentos', I: Building2, end: true },
  { to: '/parceiros/painel/clientes', label: 'Meus clientes', I: Users },
  { to: '/parceiros/painel/propostas', label: 'Propostas', I: FileText },
]

export default function PainelParceiro() {
  const { profile, sair } = useAuth()

  if (profile?.papel === 'parceiro' && profile.status_parceiro !== 'aprovado') {
    return (
      <section className="container-x grid min-h-[60svh] place-items-center py-16 text-center">
        <div className="max-w-md">
          <Clock className="mx-auto text-bronze" size={40} />
          <h1 className="display mt-4 text-4xl">{profile.status_parceiro === 'bloqueado' ? 'Acesso bloqueado' : 'Cadastro em análise'}</h1>
          <p className="mt-3 text-muted">
            {profile.status_parceiro === 'bloqueado'
              ? 'Seu acesso à área do parceiro foi suspenso. Fale com a equipe comercial.'
              : 'Recebemos seu cadastro. Assim que a equipe Arken aprovar, você terá acesso a tabelas, materiais e propostas.'}
          </p>
          <button onClick={sair} className="btn-ghost mt-8"><LogOut size={16} /> Sair</button>
        </div>
      </section>
    )
  }

  return (
    <section className="container-x py-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Área do parceiro</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Olá, {profile?.nome.split(' ')[0] || 'parceiro'}</h1>
        </div>
        <button onClick={sair} className="btn-ghost self-start"><LogOut size={16} /> Sair</button>
      </div>
      <nav className="mt-8 flex gap-1 overflow-x-auto bg-ink-soft p-1.5 sm:inline-flex">
        {abas.map(({ to, label, I, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `flex shrink-0 items-center gap-2 px-5 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-stone text-ink' : 'hover:bg-sand'}`}>
            <I size={16} /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-8"><Outlet /></div>
    </section>
  )
}

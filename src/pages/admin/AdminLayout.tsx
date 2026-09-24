import { NavLink, Outlet, Link } from 'react-router-dom'
import { LayoutDashboard, Building2, Users, FileText, UserCheck, Inbox, LogOut, ExternalLink, BarChart3 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Logo } from '@/components/Logo'

const itens = [
  { to: '/admin', label: 'Visão geral', I: LayoutDashboard, end: true },
  { to: '/admin/relatorios', label: 'Relatórios', I: BarChart3 },
  { to: '/admin/empreendimentos', label: 'Empreendimentos', I: Building2 },
  { to: '/admin/parceiros', label: 'Parceiros', I: UserCheck },
  { to: '/admin/propostas', label: 'Propostas', I: FileText },
  { to: '/admin/clientes', label: 'Clientes (portal)', I: Users },
  { to: '/admin/leads', label: 'Leads do site', I: Inbox },
]

export default function AdminLayout() {
  const { profile, sair } = useAuth()
  return (
    <div className="min-h-svh bg-ink lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="border-b border-line bg-ink-soft text-stone lg:sticky lg:top-0 lg:h-svh lg:border-b-0">
        <div className="flex items-center justify-between p-5 lg:block">
          <Link to="/"><Logo /></Link>
          <p className="hidden text-xs text-stone/50 lg:mt-2 lg:block">Painel administrativo</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3">
          {itens.map(({ to, label, I, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex shrink-0 items-center gap-3 px-3 py-2.5 text-sm ${isActive ? 'bg-white/10 text-white' : 'text-stone/70 hover:text-white'}`}>
              <I size={17} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden p-5 text-sm lg:absolute lg:bottom-0 lg:block">
          <p className="text-stone/60">{profile?.nome || profile?.email}</p>
          <div className="mt-3 flex gap-4">
            <Link to="/" className="flex items-center gap-1 text-stone/60 hover:text-white"><ExternalLink size={14} /> Site</Link>
            <button onClick={sair} className="flex items-center gap-1 text-stone/60 hover:text-white"><LogOut size={14} /> Sair</button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 p-5 sm:p-8 lg:p-10"><Outlet /></main>
    </div>
  )
}

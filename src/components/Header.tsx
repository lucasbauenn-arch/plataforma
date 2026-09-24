import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, X, Phone } from 'lucide-react'
import { Logo } from './Logo'
import { EMPRESA } from '@/lib/constants'
import { waLink } from '@/lib/format'

const links = [
  { to: '/empreendimentos', label: 'Imóveis' },
  { to: '/quem-somos', label: 'Quem somos' },
  { to: '/portfolio', label: 'Portfólio' },
  { to: '/parceiros', label: 'Parceiros' },
  { to: '/portal-do-cliente', label: 'Portal do cliente' },
]

export function Header({ sobreposto = false }: { sobreposto?: boolean }) {
  const [aberto, setAberto] = useState(false)
  const [rolou, setRolou] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => setAberto(false), [pathname])
  useEffect(() => {
    const f = () => setRolou(window.scrollY > 40)
    f()
    window.addEventListener('scroll', f, { passive: true })
    return () => window.removeEventListener('scroll', f)
  }, [])

  const transparente = sobreposto && !rolou && !aberto
  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        transparente ? 'bg-transparent text-stone' : 'bg-ink/95 text-stone shadow-[0_1px_0_var(--color-line)] backdrop-blur'
      }`}
    >
      <div className="container-x flex h-18 items-center justify-between py-4">
        <Link to="/" aria-label="Início"><Logo /></Link>
        <nav className="hidden items-center gap-8 lg:flex">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `text-sm font-medium transition-opacity hover:opacity-100 ${isActive ? 'opacity-100' : 'opacity-75'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <a
          href={waLink(EMPRESA.whatsapp, 'Olá! Gostaria de saber mais sobre os empreendimentos Arken.')}
          target="_blank" rel="noreferrer"
          className="btn-accent hidden !py-2.5 lg:inline-flex"
        >
          <Phone size={16} /> {EMPRESA.telefone}
        </a>
        <button className="lg:hidden" onClick={() => setAberto(!aberto)} aria-label="Menu">
          {aberto ? <X /> : <Menu />}
        </button>
      </div>
      {aberto && (
        <nav className="container-x flex flex-col gap-1 border-t border-line bg-ink pb-6 pt-2 lg:hidden">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className="px-2 py-3 text-base font-medium hover:bg-sand">
              {l.label}
            </NavLink>
          ))}
          <a href={`tel:+${EMPRESA.whatsapp}`} className="btn-accent mt-3"><Phone size={16} /> {EMPRESA.telefone}</a>
        </nav>
      )}
    </header>
  )
}

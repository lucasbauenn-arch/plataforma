import { Link, NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { ExternalLink, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Logo } from '@/components/Logo'
import type { ItemMenu } from '@/lib/menu'
import { IconeMenu } from './IconeMenu'

/** Barra lateral do admin e da área de parceiros (no celular vira uma faixa de navegação no topo). */
export function BarraLateral({ itens, subtitulo, nome }: { itens: ItemMenu[]; subtitulo: string; nome?: string | null }) {
  const { sair } = useAuth()
  return (
    <aside className="border-b border-line bg-ink-soft text-stone lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col lg:border-r lg:border-b-0">
      <div className="flex items-center justify-between gap-4 p-5 lg:block">
        <Link to="/" aria-label="Página inicial"><Logo /></Link>
        <p className="hidden text-xs text-muted lg:mt-2 lg:block">{subtitulo}</p>
        <button type="button" onClick={sair} className="flex items-center gap-1 text-sm text-muted hover:text-stone lg:hidden">
          <LogOut size={14} aria-hidden /> Sair
        </button>
      </div>
      <nav aria-label="Menu principal" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-y-auto">
        {itens.map((i) => (
          <NavLink
            key={i.id} to={i.caminho} end={i.exato}
            className={({ isActive }) => clsx(
              'flex shrink-0 items-center gap-3 px-3 py-2.5 text-sm transition-colors',
              isActive ? 'bg-stone font-semibold text-ink' : 'text-stone/75 hover:bg-sand hover:text-stone',
            )}
          >
            <IconeMenu nome={i.icone} /> {i.rotulo}
          </NavLink>
        ))}
      </nav>
      <div className="hidden border-t border-line p-5 text-sm lg:block">
        {nome && <p className="truncate text-muted">{nome}</p>}
        <div className="mt-3 flex gap-4">
          <Link to="/" className="flex items-center gap-1 text-muted hover:text-stone"><ExternalLink size={14} aria-hidden /> Site</Link>
          <button type="button" onClick={sair} className="flex items-center gap-1 text-muted hover:text-stone"><LogOut size={14} aria-hidden /> Sair</button>
        </div>
      </div>
    </aside>
  )
}

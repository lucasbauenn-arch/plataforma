import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

/**
 * Cabeçalho de página do painel e do admin. No admin o título é `h1`; na área de parceiros é `h2`, porque o layout
 * já tem o `h1` da saudação. `como` força o nível.
 */
export function CabecalhoPagina({ titulo, subtitulo, eyebrow, acoes, voltar, como }: {
  titulo: ReactNode
  subtitulo?: ReactNode
  eyebrow?: ReactNode
  acoes?: ReactNode
  voltar?: { para: string; rotulo: string }
  como?: 'h1' | 'h2'
}) {
  const { pathname } = useLocation()
  const Titulo = como ?? (pathname.startsWith('/admin') ? 'h1' : 'h2')
  return (
    <header className="mb-8">
      {voltar && (
        <Link to={voltar.para} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-stone">
          <ChevronLeft size={16} aria-hidden /> {voltar.rotulo}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <Titulo className="display text-3xl sm:text-4xl">{titulo}</Titulo>
          {subtitulo && <p className="mt-2 max-w-2xl text-sm text-muted">{subtitulo}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-3">{acoes}</div>}
      </div>
    </header>
  )
}

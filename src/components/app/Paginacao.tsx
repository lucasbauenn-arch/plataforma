import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Paginação por `offset`/`limite`, igual às RPCs `*_listar`. Some quando cabe tudo numa página. */
export function Paginacao({ total, limite, offset, aoMudar }: {
  total: number
  limite: number
  offset: number
  aoMudar: (novoOffset: number) => void
}) {
  if (total <= limite && offset === 0) return null
  const inicio = total === 0 ? 0 : offset + 1
  const fim = Math.min(offset + limite, total)
  const pagina = Math.floor(offset / limite) + 1
  const paginas = Math.max(1, Math.ceil(total / limite))
  return (
    <nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span>{inicio}–{fim} de {total}</span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost px-3 py-2" disabled={offset === 0} onClick={() => aoMudar(Math.max(0, offset - limite))} aria-label="Página anterior">
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-20 text-center">Página {pagina} de {paginas}</span>
        <button type="button" className="btn-ghost px-3 py-2" disabled={fim >= total} onClick={() => aoMudar(offset + limite)} aria-label="Próxima página">
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  )
}

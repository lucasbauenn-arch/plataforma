import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'

/** Linha de filtros acima de listas e do kanban. */
export function BarraFiltros({ children, acoes }: { children: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-1 flex-wrap items-end gap-3">{children}</div>
      {acoes && <div className="flex flex-wrap items-center gap-3">{acoes}</div>}
    </div>
  )
}

/** Busca com espera (`atraso` ms) antes de avisar a mudança, para não chamar a RPC a cada tecla. */
export function CampoBusca({ valor, aoMudar, placeholder = 'Buscar…', rotulo = 'Buscar', atraso = 350 }: {
  valor: string
  aoMudar: (v: string) => void
  placeholder?: string
  rotulo?: string
  atraso?: number
}) {
  const [texto, setTexto] = useState(valor)
  const ultimo = useRef(valor)
  const aoMudarRef = useRef(aoMudar)
  useEffect(() => { aoMudarRef.current = aoMudar })

  useEffect(() => {
    if (texto === ultimo.current) return
    const t = setTimeout(() => {
      ultimo.current = texto
      aoMudarRef.current(texto)
    }, atraso)
    return () => clearTimeout(t)
  }, [texto, atraso])

  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">{rotulo}</span>
      <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <input
        type="search" className="input pr-9 pl-9" placeholder={placeholder} value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      {texto && (
        <button type="button" aria-label="Limpar busca" onClick={() => { setTexto(''); ultimo.current = ''; aoMudarRef.current('') }}
          className="absolute top-1/2 right-3 -translate-y-1/2 text-muted hover:text-stone">
          <X size={16} />
        </button>
      )}
    </label>
  )
}

/** Seleção compacta de filtro com rótulo visível. `''` = sem filtro. */
export function FiltroSelecao({ rotulo, valor, aoMudar, opcoes, todos = 'Todos' }: {
  rotulo: string
  valor: string
  aoMudar: (v: string) => void
  opcoes: { valor: string; rotulo: string }[]
  todos?: string | null
}) {
  return (
    <label className="block">
      <span className="label">{rotulo}</span>
      <select className="input w-auto min-w-44 py-2.5" value={valor} onChange={(e) => aoMudar(e.target.value)}>
        {todos !== null && <option value="">{todos}</option>}
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
    </label>
  )
}

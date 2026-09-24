import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { Midia, TipoMidia } from '@/lib/types'
import { midiaUrl } from '@/lib/midia'

const ROTULOS: Record<TipoMidia, string> = {
  fachada: 'Fachada', area_comum: 'Área comum', planta: 'Plantas', decorado: 'Decorado', obra: 'Obra',
}

export function Galeria({ midias }: { midias: Midia[] }) {
  const tipos = (Object.keys(ROTULOS) as TipoMidia[]).filter((t) => midias.some((m) => m.tipo === t))
  const [tipo, setTipo] = useState<TipoMidia | undefined>(tipos[0])
  const [aberta, setAberta] = useState<number | null>(null)
  const lista = midias.filter((m) => m.tipo === (tipo ?? tipos[0]))

  useEffect(() => {
    if (aberta === null) return
    const f = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setAberta(null)
      if (ev.key === 'ArrowRight') setAberta((i) => (i! + 1) % lista.length)
      if (ev.key === 'ArrowLeft') setAberta((i) => (i! - 1 + lista.length) % lista.length)
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [aberta, lista.length])

  if (!tipos.length) return null
  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        {tipos.map((t) => (
          <button
            key={t}
            onClick={() => setTipo(t)}
            className={`px-5 py-2 text-sm font-semibold transition ${
              (tipo ?? tipos[0]) === t ? 'bg-stone text-ink' : 'bg-ink-soft hover:bg-sand'
            }`}
          >
            {ROTULOS[t]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {lista.map((m, i) => (
          <button
            key={m.id}
            onClick={() => setAberta(i)}
            className={`overflow-hidden bg-sand ${i === 0 ? 'col-span-2 row-span-2' : ''}`}
          >
            <img src={midiaUrl(m.url)!} alt={m.legenda ?? ROTULOS[m.tipo]} loading="lazy" className="aspect-square h-full w-full object-cover transition-transform duration-500 hover:scale-105" />
          </button>
        ))}
      </div>
      {aberta !== null && lista[aberta] && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/95 p-4" onClick={() => setAberta(null)}>
          <button className="absolute right-5 top-5 text-stone" aria-label="Fechar"><X size={28} /></button>
          <button
            className="absolute left-3 text-stone md:left-8" aria-label="Anterior"
            onClick={(ev) => { ev.stopPropagation(); setAberta((aberta - 1 + lista.length) % lista.length) }}
          ><ChevronLeft size={40} /></button>
          <figure onClick={(ev) => ev.stopPropagation()} className="max-h-full">
            <img src={midiaUrl(lista[aberta].url)!} alt={lista[aberta].legenda ?? ''} className="max-h-[85vh] object-contain" />
            {lista[aberta].legenda && <figcaption className="mt-3 text-center text-sm text-stone/80">{lista[aberta].legenda}</figcaption>}
          </figure>
          <button
            className="absolute right-3 text-stone md:right-8" aria-label="Próxima"
            onClick={(ev) => { ev.stopPropagation(); setAberta((aberta + 1) % lista.length) }}
          ><ChevronRight size={40} /></button>
        </div>
      )}
    </div>
  )
}

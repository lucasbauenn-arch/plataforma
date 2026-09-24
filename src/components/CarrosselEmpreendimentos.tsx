import { useCallback, useEffect, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Empreendimento } from '@/lib/types'
import { EmpreendimentoCard } from './EmpreendimentoCard'

/** Carrossel horizontal de cards 4:5 — arrasta no celular, setas no desktop. */
export function CarrosselEmpreendimentos({ itens }: { itens: Empreendimento[] }) {
  const [ref, api] = useEmblaCarousel({ align: 'start', containScroll: 'trimSnaps' })
  const [pode, setPode] = useState({ antes: false, depois: false })

  useEffect(() => {
    if (!api) return
    const atualizar = () => setPode({ antes: api.canScrollPrev(), depois: api.canScrollNext() })
    atualizar()
    api.on('select', atualizar).on('reInit', atualizar)
    return () => { api.off('select', atualizar).off('reInit', atualizar) }
  }, [api])
  const ir = useCallback((d: 1 | -1) => (d > 0 ? api?.scrollNext() : api?.scrollPrev()), [api])

  return (
    <div>
      <div className="overflow-hidden" ref={ref}>
        <div className="-ml-6 flex touch-pan-y">
          {itens.map((e) => (
            <div key={e.id} className="min-w-0 flex-[0_0_85%] pl-6 sm:flex-[0_0_50%] lg:flex-[0_0_33.333%] xl:flex-[0_0_25%]">
              <EmpreendimentoCard e={e} />
            </div>
          ))}
        </div>
      </div>
      {(pode.antes || pode.depois) && (
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => ir(-1)} disabled={!pode.antes} aria-label="Anterior"
            className="grid h-11 w-11 place-items-center border border-line transition hover:border-stone/50 disabled:opacity-30"><ChevronLeft size={18} /></button>
          <button onClick={() => ir(1)} disabled={!pode.depois} aria-label="Próximo"
            className="grid h-11 w-11 place-items-center border border-line transition hover:border-stone/50 disabled:opacity-30"><ChevronRight size={18} /></button>
        </div>
      )}
    </div>
  )
}

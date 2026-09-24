import { Link } from 'react-router-dom'
import { ArrowUpRight, BedDouble, Car, MapPin } from 'lucide-react'
import type { Empreendimento } from '@/lib/types'
import { ESTAGIOS } from '@/lib/constants'
import { Imagem } from './Imagem'

export function EmpreendimentoCard({ e }: { e: Empreendimento }) {
  return (
    <Link to={`/empreendimentos/${e.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden bg-sand">
        <Imagem src={e.capa_url} alt={e.nome} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/10 to-transparent" />
        <span className="absolute left-4 top-4 bg-stone/90 px-3 py-1 text-xs font-semibold text-ink backdrop-blur">
          {ESTAGIOS[e.estagio]}
        </span>
        {e.aceita_fgts && (
          <span className="absolute right-4 top-4 bg-bronze px-3 py-1 text-xs font-semibold text-ink">Use seu FGTS</span>
        )}
        <div className="absolute inset-x-0 bottom-0 p-5 text-stone">
          <h3 className="display text-3xl">{e.nome}</h3>
          {e.bairro && <p className="mt-1 flex items-center gap-1.5 text-sm opacity-85"><MapPin size={14} />{e.bairro}{e.cidade ? `, ${e.cidade}` : ''}</p>}
        </div>
        <span className="absolute bottom-5 right-5 grid h-10 w-10 place-items-center bg-stone text-ink opacity-0 transition-opacity group-hover:opacity-100">
          <ArrowUpRight size={18} />
        </span>
      </div>
      <div className="mt-3 flex gap-5 text-sm text-muted">
        {e.dormitorios && <span className="flex items-center gap-1.5"><BedDouble size={16} />{e.dormitorios}</span>}
        {e.vagas && <span className="flex items-center gap-1.5"><Car size={16} />{e.vagas}</span>}
      </div>
    </Link>
  )
}

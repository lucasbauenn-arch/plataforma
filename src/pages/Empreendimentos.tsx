import { useState } from 'react'
import { useEmpreendimentos } from '@/hooks/queries'
import { EmpreendimentoCard } from '@/components/EmpreendimentoCard'
import { Carregando, Vazio, Erro } from '@/components/Estados'
import { ESTAGIOS } from '@/lib/constants'
import type { Estagio } from '@/lib/types'

export default function Empreendimentos() {
  const { data = [], isLoading, error } = useEmpreendimentos()
  const [filtro, setFiltro] = useState<Estagio | 'todos'>('todos')
  const ativos = data.filter((e) => e.estagio !== 'portfolio')
  const estagios = [...new Set(ativos.map((e) => e.estagio))]
  const lista = filtro === 'todos' ? ativos : ativos.filter((e) => e.estagio === filtro)

  return (
    <section className="container-x py-16">
      <p className="eyebrow">Imóveis</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">Empreendimentos em São Paulo</h1>
      <div className="mt-8 flex flex-wrap gap-2">
        {(['todos', ...estagios] as const).map((s) => (
          <button key={s} onClick={() => setFiltro(s)}
            className={`px-5 py-2 text-sm font-semibold ${filtro === s ? 'bg-stone text-ink' : 'bg-ink-soft hover:bg-sand'}`}>
            {s === 'todos' ? 'Todos' : ESTAGIOS[s]}
          </button>
        ))}
      </div>
      <div className="mt-10">
        {isLoading ? <Carregando /> : error ? <Erro /> : lista.length === 0 ? <Vazio titulo="Nenhum empreendimento nesta categoria" /> : (
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">{lista.map((e) => <EmpreendimentoCard key={e.id} e={e} />)}</div>
        )}
      </div>
    </section>
  )
}

import { useEmpreendimentos } from '@/hooks/queries'
import { Imagem } from '@/components/Imagem'
import { Carregando, Vazio } from '@/components/Estados'

export default function Portfolio() {
  const { data = [], isLoading } = useEmpreendimentos()
  const obras = data.filter((e) => e.estagio === 'portfolio' || e.estagio === 'pronto_para_morar')
  return (
    <section className="container-x py-16">
      <p className="eyebrow">Portfólio</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">Obras que já entregamos</h1>
      <p className="mt-4 max-w-2xl text-muted">Projetos executados e empreendimentos concluídos pela nossa equipe.</p>
      <div className="mt-12">
        {isLoading ? <Carregando /> : obras.length === 0 ? <Vazio titulo="Portfólio em atualização" /> : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {obras.map((e) => (
              <figure key={e.id} className="overflow-hidden bg-ink-soft">
                <Imagem src={e.capa_url} alt={e.nome} className="aspect-[4/3] w-full object-cover" />
                <figcaption className="p-5">
                  <p className="display text-2xl">{e.nome}</p>
                  {(e.bairro || e.total_unidades) && (
                    <p className="mt-1 text-sm text-muted">{[e.bairro, e.total_unidades && `${e.total_unidades} unidades`].filter(Boolean).join(' · ')}</p>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

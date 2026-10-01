import { Link } from 'react-router-dom'
import { useEmpreendimentos } from '@/hooks/queries'
import { Imagem } from '@/components/Imagem'
import { Carregando, Erro, Vazio } from '@/components/Estados'
import { ESTAGIOS } from '@/lib/constants'

// Portfólio = todos os empreendimentos publicados (useEmpreendimentos já filtra publicado = true), em qualquer estágio.
// A coluna mostrar_no_portfolio não é mais usada aqui; o pré-render (scripts/gerar-seo.mjs) segue a mesma regra.
export default function Portfolio() {
  const { data = [], isLoading, error } = useEmpreendimentos()
  return (
    <section className="container-x py-16">
      <p className="eyebrow">Portfólio</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">Nossos empreendimentos</h1>
      <p className="mt-4 max-w-2xl text-muted">Empreendimentos desenvolvidos pela Arken em São Paulo — do lançamento à entrega das chaves.</p>
      <div className="mt-12">
        {isLoading ? <Carregando /> : error ? <Erro /> : data.length === 0 ? <Vazio titulo="Portfólio em atualização" /> : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="portfolio-lista">
            {data.map((e) => (
              <Link key={e.id} to={`/empreendimentos/${e.slug}`} className="group block overflow-hidden bg-ink-soft">
                <figure>
                  <div className="relative overflow-hidden">
                    <Imagem src={e.capa_url} alt={e.nome} className="aspect-[4/3] w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                    <span className="absolute left-4 top-4 bg-stone/90 px-3 py-1 text-xs font-semibold text-ink">{ESTAGIOS[e.estagio]}</span>
                  </div>
                  <figcaption className="p-5">
                    <p className="display text-2xl">{e.nome}</p>
                    {(e.bairro || e.total_unidades) && (
                      <p className="mt-1 text-sm text-muted">{[e.bairro, e.total_unidades && `${e.total_unidades} unidades`].filter(Boolean).join(' · ')}</p>
                    )}
                  </figcaption>
                </figure>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { painelResumo } from '@/lib/rpc'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ErroConsulta } from '@/components/app/Consulta'
import { Carregando, Vazio } from '@/components/Estados'
import { gruposDoPainel } from '@/modulos/governanca/painel'

/**
 * Visão geral do admin pela `painel_resumo()` (docs/ARQUITETURA_EXPANSAO.md §7.4): cartões por papel e escopo, sem
 * `count` direto em tabelas de cliente. Cada seção só aparece com a permissão correspondente.
 */
export default function Dashboard() {
  const q = useQuery({ queryKey: ['painel-resumo'], queryFn: () => painelResumo(), staleTime: 30_000 })

  return (
    <>
      <CabecalhoPagina titulo="Visão geral" />
      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : !q.data ? (
        <Vazio titulo="Nada para mostrar" />
      ) : (
        <div className="grid gap-10">
          {gruposDoPainel(q.data, '/admin').map((g) => (
            <section key={g.id} aria-labelledby={`grupo-${g.id}`}>
              <h2 id={`grupo-${g.id}`} className="eyebrow mb-4">{g.titulo}</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {g.cartoes.map((c) => (
                  <Link key={c.id} to={c.para} className={clsx('card p-6 transition hover:border-stone/40', c.destaque && 'border-bronze')}>
                    <p className="text-sm text-muted">{c.rotulo}</p>
                    <p className="display mt-2 text-5xl">{c.valor.toLocaleString('pt-BR')}</p>
                    {c.detalhe && <p className="mt-1 text-xs text-muted">{c.detalhe}</p>}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

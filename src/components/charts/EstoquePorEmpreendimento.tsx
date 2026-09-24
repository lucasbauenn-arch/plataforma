import { brl } from '@/lib/format'
import type { Relatorio } from '@/lib/relatorio'

const CORES = { disponivel: 'var(--color-sage)', reservada: 'var(--color-bronze)', vendida: 'var(--color-muted)' } as const
const LEGENDA: [keyof typeof CORES, string][] = [['disponivel', 'Disponível'], ['reservada', 'Reservada'], ['vendida', 'Vendida']]

/** Uma barra por empreendimento (mesmo esquema de cor de status em toda a plataforma: sage/bronze/muted). */
export function EstoquePorEmpreendimento({ itens }: { itens: Relatorio['estoque'] }) {
  if (itens.length === 0) return <p className="py-6 text-center text-sm text-muted">Nenhuma unidade cadastrada</p>

  return (
    <div>
      <ul className="grid gap-4">
        {itens.map((e) => {
          const total = e.disponivel + e.reservada + e.vendida
          return (
            <li key={e.nome}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <p className="truncate font-medium">{e.nome}</p>
                <p className="shrink-0 text-xs text-muted">{total} unidade{total === 1 ? '' : 's'}</p>
              </div>
              {total > 0 && (
                <div className="mt-1.5 flex h-2.5 gap-[2px]">
                  {LEGENDA.filter(([k]) => e[k] > 0).map(([k]) => (
                    <div key={k} style={{ width: `${(e[k] / total) * 100}%`, backgroundColor: CORES[k] }} title={`${k}: ${e[k]}`} />
                  ))}
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                <span>{e.disponivel} disponível{e.disponivel === 1 ? '' : 'is'} · {brl(e.vgv_disponivel)}</span>
                {e.reservada > 0 && <span>{e.reservada} reservada{e.reservada === 1 ? '' : 's'}</span>}
                {e.vendida > 0 && <span>{e.vendida} vendida{e.vendida === 1 ? '' : 's'} · {brl(e.vgv_vendido)}</span>}
              </div>
            </li>
          )
        })}
      </ul>
      <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
        {LEGENDA.map(([k, label]) => (
          <li key={k} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: CORES[k] }} />{label}</li>
        ))}
      </ul>
    </div>
  )
}

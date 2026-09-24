import { mesAbrev } from '@/lib/relatorio'
import { useTooltip } from './useTooltip'
import { Tooltip } from './Tooltip'

const MESES_CHEIO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** Coluna única (bronze — job = magnitude ao longo do tempo), topo arredondado 4px, base reta. */
export function BarrasMensal({ dados }: { dados: { mes: string; total: number }[] }) {
  const { container, tip, mostrar, esconder } = useTooltip()
  const max = Math.max(1, ...dados.map((d) => d.total))
  const idxMax = dados.reduce((m, d, i) => (d.total > dados[m].total ? i : m), 0)

  const W = dados.length * 48
  const H = 180
  const banda = 48
  const largura = 24
  // cantos retos (convenção do projeto, ver CLAUDE.md) — sem o topo arredondado que o guia de dataviz sugere
  const y = (v: number) => H - 24 - (v / max) * (H - 44)

  return (
    <div className="relative" ref={container}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }} preserveAspectRatio="none" role="img" aria-label="Leads por mês, últimos 12 meses">
        <line x1="0" y1={H - 24} x2={W} y2={H - 24} stroke="var(--color-line)" strokeWidth="1" />
        {dados.map((d, i) => {
          const x = i * banda + (banda - largura) / 2
          return (
            <g key={d.mes}>
              <rect
                x={x} y={y(d.total)} width={largura} height={Math.max(0, H - 24 - y(d.total))}
                fill="var(--color-bronze)" opacity={d.total === 0 ? 0.25 : 1}
                tabIndex={0} className="cursor-pointer outline-none focus-visible:opacity-80"
                onMouseEnter={(e) => mostrar(e, `${MESES_CHEIO[Number(d.mes.slice(5, 7)) - 1]} de ${d.mes.slice(0, 4)}`, `${d.total} lead${d.total === 1 ? '' : 's'}`)}
                onFocus={(e) => mostrar(e, `${MESES_CHEIO[Number(d.mes.slice(5, 7)) - 1]} de ${d.mes.slice(0, 4)}`, `${d.total} lead${d.total === 1 ? '' : 's'}`)}
                onMouseLeave={esconder} onBlur={esconder}
              />
              {i === idxMax && d.total > 0 && (
                <text x={x + largura / 2} y={y(d.total) - 6} textAnchor="middle" className="fill-stone text-[10px] font-semibold">{d.total}</text>
              )}
              <text x={x + largura / 2} y={H - 8} textAnchor="middle" className="fill-muted text-[9px] uppercase">{mesAbrev(d.mes)}</text>
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

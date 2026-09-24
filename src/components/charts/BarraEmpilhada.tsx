export interface Segmento { chave: string; label: string; valor: number; cor: string }

/** Uma barra, dividida por estado (job = polaridade/estado — cores fixas e reservadas, nunca as categóricas). */
export function BarraEmpilhada({ segmentos }: { segmentos: Segmento[] }) {
  const total = segmentos.reduce((s, x) => s + x.valor, 0)
  const visiveis = segmentos.filter((s) => s.valor > 0)

  if (total === 0) return <p className="py-6 text-center text-sm text-muted">Sem dados no período</p>

  return (
    <div>
      <div className="flex h-3 gap-[2px]">
        {visiveis.map((s) => (
          <div key={s.chave} style={{ width: `${(s.valor / total) * 100}%`, backgroundColor: s.cor }} title={`${s.label}: ${s.valor}`} />
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {segmentos.map((s) => (
          <li key={s.chave} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: s.cor }} />
            <span className="text-stone/80">{s.label}</span>
            <span className="font-semibold tabular-nums">{s.valor}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

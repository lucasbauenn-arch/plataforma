interface Item { label: string; valor: number; sub?: string }

/** Ranking horizontal — uma medida, uma cor (bronze); nunca uma cor por barra (não são categorias, é magnitude). */
export function Ranking({ itens, limite = 8, formatar = String, vazio = 'Sem dados no período' }: {
  itens: Item[]; limite?: number; formatar?: (v: number) => string; vazio?: string
}) {
  if (itens.length === 0) return <p className="py-6 text-center text-sm text-muted">{vazio}</p>

  const principais = itens.slice(0, limite)
  const resto = itens.slice(limite)
  const linhas = resto.length
    ? [...principais, { label: `+ ${resto.length} outro${resto.length > 1 ? 's' : ''}`, valor: resto.reduce((s, i) => s + i.valor, 0) }]
    : principais
  const max = Math.max(1, ...linhas.map((l) => l.valor))

  return (
    <ul className="grid gap-3">
      {linhas.map((l, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div>
            <p className="truncate text-sm">{l.label}{l.sub && <span className="ml-1.5 text-xs text-muted">{l.sub}</span>}</p>
            <div className="mt-1 h-2 bg-ink"><div className="h-full bg-bronze" style={{ width: `${(l.valor / max) * 100}%` }} /></div>
          </div>
          <span className="text-sm font-semibold tabular-nums">{formatar(l.valor)}</span>
        </li>
      ))}
    </ul>
  )
}

import type { ReactNode } from 'react'
export const Titulo = ({ children, acao }: { children: ReactNode; acao?: ReactNode }) => (
  <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
    <h1 className="display text-4xl">{children}</h1>{acao}
  </div>
)
export const Tabela = ({ cab, children }: { cab: string[]; children: ReactNode }) => (
  <div className="card overflow-x-auto">
    <table className="w-full min-w-[720px] text-sm">
      <thead className="bg-sand/50 text-left text-xs uppercase tracking-wider text-muted">
        <tr>{cab.map((c, i) => <th key={i} className="px-4 py-3 font-semibold">{c}</th>)}</tr>
      </thead>
      <tbody className="[&_td]:px-4 [&_td]:py-3 [&_tr]:border-t [&_tr]:border-line">{children}</tbody>
    </table>
  </div>
)
export const Badge = ({ children, tom = 'neutro' }: { children: ReactNode; tom?: 'neutro' | 'ok' | 'alerta' | 'erro' }) => {
  const c = { neutro: 'bg-sand text-stone', ok: 'bg-sage/15 text-sage', alerta: 'bg-bronze/15 text-bronze', erro: 'bg-red-500/15 text-red-300' }[tom]
  return <span className={`inline-block px-2.5 py-0.5 text-xs font-semibold ${c}`}>{children}</span>
}

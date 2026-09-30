import type { ReactNode } from 'react'
import clsx from 'clsx'

export interface ColunaTabela { rotulo: ReactNode; classe?: string; direita?: boolean }

/**
 * Tabela retangular com rolagem horizontal no celular. As linhas vêm como `<tr>` em `children`
 * (células com `px-4 py-3` e borda superior automáticas). Sem linhas, mostra `vazio` FORA da tabela rolável: dentro
 * de uma célula da tabela larga (mínimo de 640 a 880 px) a mensagem caía fora da tela no celular (FUX-08).
 */
export function Tabela({ colunas, children, vazio, minimo = 720, legenda }: {
  colunas: (string | ColunaTabela)[]
  children?: ReactNode
  vazio?: ReactNode
  /** Largura mínima em px antes de rolar. */
  minimo?: number
  /** Legenda acessível (não visível). */
  legenda?: string
}) {
  const cols = colunas.map((c) => (typeof c === 'string' ? { rotulo: c } : c))
  const semLinhas = children == null || (Array.isArray(children) && children.length === 0)
  return (
    <div className="card">
      {/* `relative`: descendente absoluto (ex.: texto sr-only) fica preso ao recorte e não estica a largura da página (FUX-07) */}
      <div className="relative overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: minimo }}>
        {legenda && <caption className="sr-only">{legenda}</caption>}
        <thead className="bg-sand/50 text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            {cols.map((c, i) => (
              <th key={i} scope="col" className={clsx('px-4 py-3 font-semibold', c.direita && 'text-right', c.classe)}>{c.rotulo}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-4 [&_td]:py-3 [&_tr]:border-t [&_tr]:border-line">
          {semLinhas && vazio ? null : children}
        </tbody>
      </table>
      </div>
      {semLinhas && vazio && <div role="status" className="border-t border-line px-4 py-8 text-center text-sm text-muted">{vazio}</div>}
    </div>
  )
}

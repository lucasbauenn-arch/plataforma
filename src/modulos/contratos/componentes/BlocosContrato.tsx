import type { ReactNode } from 'react'
import type { BlocoRenderizado, Trecho } from '@shared/modelo-contrato'

/** Um trecho de texto com negrito/itálico. Sempre TEXTO (React escapa): nunca dangerouslySetInnerHTML (§6.3). */
function TextoTrecho({ t }: { t: Trecho }) {
  let no: ReactNode = t.texto
  if (t.italico) no = <em>{no}</em>
  if (t.negrito) no = <strong className="font-semibold">{no}</strong>
  return <>{no}</>
}

const trechos = (lista: Trecho[]) => lista.map((t, i) => <TextoTrecho key={i} t={t} />)

/**
 * Texto do contrato a partir da árvore neutra de renderizarModelo (_shared/modelo-contrato.ts): o mesmo módulo que
 * alimenta o PDF. "---" aparece como uma divisória de página.
 */
export function BlocosContrato({ blocos }: { blocos: BlocoRenderizado[] }) {
  return (
    <div className="grid gap-3 text-sm leading-relaxed text-stone/90">
      {blocos.map((b, i) => {
        switch (b.tipo) {
          case 'titulo': {
            const classe = b.nivel === 1 ? 'text-lg font-semibold' : b.nivel === 2 ? 'mt-2 text-base font-semibold' : 'font-semibold'
            if (b.nivel === 1) return <h4 key={i} className={classe}>{trechos(b.trechos)}</h4>
            if (b.nivel === 2) return <h5 key={i} className={classe}>{trechos(b.trechos)}</h5>
            return <h6 key={i} className={classe}>{trechos(b.trechos)}</h6>
          }
          case 'paragrafo':
            return <p key={i}>{trechos(b.trechos)}</p>
          case 'lista':
            return b.ordenada ? (
              <ol key={i} start={b.inicio} className="list-decimal space-y-1 pl-6">
                {b.itens.map((item, j) => <li key={j}>{trechos(item)}</li>)}
              </ol>
            ) : (
              <ul key={i} className="list-disc space-y-1 pl-6">
                {b.itens.map((item, j) => <li key={j}>{trechos(item)}</li>)}
              </ul>
            )
          case 'quebra_pagina':
            return (
              <div key={i} role="separator" className="my-2 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted">
                <span className="h-px flex-1 bg-line" /> nova página <span className="h-px flex-1 bg-line" />
              </div>
            )
        }
      })}
    </div>
  )
}

import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronsLeftRight, Lock } from 'lucide-react'
import { ETAPAS } from '@/lib/constants'
import type { EtapaFunil } from '@/lib/types'
import type { DestinoArraste } from '../funil'

/**
 * Coluna do kanban. Durante o arraste, recebe o `destino` calculado para o cartão arrastado: permitido = aceita soltar
 * (borda em destaque); proibido = esmaecida com a dica. `bloqueada` = nenhum cartão pode entrar por aqui manualmente
 * (ex.: Finalizado), com a dica sempre visível. Recolhida (Perdidos) continua aceitando o cartão.
 */
export function ColunaKanban({
  etapa, total, destino, bloqueada, recolhida, aoAlternar, aoSoltar, children, rodape,
}: {
  etapa: EtapaFunil
  total: number
  /** Nulo fora do arraste ou quando o cartão arrastado é desta coluna. */
  destino: DestinoArraste | null
  /** Dica permanente quando ninguém pode mover para esta coluna. */
  bloqueada: string | null
  recolhida?: boolean
  aoAlternar?: () => void
  aoSoltar: () => void
  children?: ReactNode
  rodape?: ReactNode
}) {
  const [sobre, setSobre] = useState(false)
  const aceita = !!destino?.permitido
  const proibida = !!destino && !destino.permitido
  const rotulo = ETAPAS[etapa].rotulo
  const idTitulo = `coluna-${etapa}`

  return (
    <section
      aria-labelledby={idTitulo}
      aria-disabled={bloqueada ? true : undefined}
      data-etapa={etapa}
      onDragOver={(e) => {
        if (!aceita) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!sobre) setSobre(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSobre(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setSobre(false)
        if (aceita) aoSoltar()
      }}
      className={clsx(
        'flex shrink-0 flex-col border bg-ink-soft/60 transition',
        recolhida ? 'w-48' : 'w-72 sm:w-80',
        aceita ? (sobre ? 'border-bronze bg-bronze/10' : 'border-bronze/60') : 'border-line',
        proibida && 'opacity-40',
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h3 id={idTitulo} className="flex items-center gap-2 text-sm font-semibold">
          {bloqueada && <Lock size={14} aria-hidden className="text-muted" />}
          {rotulo}
          <span className="bg-sand px-1.5 text-xs font-medium text-stone/80" aria-label={total === 1 ? '1 cliente' : `${total} clientes`}>{total}</span>
        </h3>
        {aoAlternar && (
          <button type="button" onClick={aoAlternar} className="text-muted hover:text-stone" aria-expanded={!recolhida}
            aria-label={recolhida ? `Mostrar ${rotulo}` : `Recolher ${rotulo}`}>
            <ChevronsLeftRight size={16} aria-hidden />
          </button>
        )}
      </header>
      {(proibida || bloqueada) && (
        <p className="border-b border-line px-3 py-2 text-xs text-muted" role={proibida ? 'status' : undefined}>
          {proibida ? destino?.dica : bloqueada}
        </p>
      )}
      {!recolhida && <div className="flex min-h-40 flex-1 flex-col gap-2 p-2">{children}</div>}
      {recolhida && (
        <p className="flex-1 px-3 py-4 text-xs text-muted">
          {aceita ? 'Solte aqui para marcar como perdido.' : `${total === 1 ? '1 cliente' : `${total} clientes`}. Clique nas setas para ver.`}
        </p>
      )}
      {!recolhida && rodape}
    </section>
  )
}

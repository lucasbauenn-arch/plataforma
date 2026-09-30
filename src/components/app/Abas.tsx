import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import clsx from 'clsx'

export interface Aba<T extends string = string> {
  id: T
  rotulo: ReactNode
  /** Número ao lado do rótulo (ex.: documentos pendentes). */
  contador?: number | null
  desabilitada?: boolean
}

const classeAba = (ativa: boolean) =>
  clsx('flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-semibold transition', ativa ? 'bg-stone text-ink' : 'text-stone/80 hover:bg-sand')

const Contador = ({ n, ativa }: { n?: number | null; ativa: boolean }) =>
  n ? <span className={clsx('px-1.5 text-xs', ativa ? 'bg-ink/10' : 'bg-sand')}>{n}</span> : null

/** Abas controladas por estado (ex.: abas da ficha, guardadas em `?aba=`). */
export function Abas<T extends string>({ abas, ativa, aoMudar, rotulo = 'Seções' }: {
  abas: Aba<T>[]
  ativa: T
  aoMudar: (id: T) => void
  rotulo?: string
}) {
  return (
    <div role="tablist" aria-label={rotulo} className="flex gap-1 overflow-x-auto border border-line bg-ink-soft p-1">
      {abas.map((a) => (
        <button
          key={a.id} type="button" role="tab" aria-selected={a.id === ativa} disabled={a.desabilitada}
          onClick={() => aoMudar(a.id)} className={clsx(classeAba(a.id === ativa), 'disabled:opacity-40')}
        >
          {a.rotulo}<Contador n={a.contador} ativa={a.id === ativa} />
        </button>
      ))}
    </div>
  )
}

/** Abas que são rotas (ex.: seções de /admin/configuracoes). */
export function AbasRota({ abas, rotulo = 'Seções' }: { abas: { para: string; rotulo: ReactNode; exato?: boolean }[]; rotulo?: string }) {
  return (
    <nav aria-label={rotulo} className="flex gap-1 overflow-x-auto border border-line bg-ink-soft p-1">
      {abas.map((a) => (
        <NavLink key={a.para} to={a.para} end={a.exato} className={({ isActive }) => classeAba(isActive)}>{a.rotulo}</NavLink>
      ))}
    </nav>
  )
}

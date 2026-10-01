import clsx from 'clsx'
import { Plus } from 'lucide-react'
import type { ItemCatalogo } from './catalogoIcones'

/**
 * Chips com ícone, retangulares, que ligam e desligam (`aria-pressed`). Serve para seleção múltipla (itens de lazer:
 * cada chip ligado é um registro) e única (categoria da proximidade: `selecionados` com uma chave só).
 * `outro` acrescenta o chip "Outro" (item livre, fora do catálogo), controlado por quem usa.
 */
export function ChipsIcone({ itens, selecionados, aoAlternar, rotulo, outro, desabilitado }: {
  itens: ItemCatalogo[]
  selecionados: ReadonlySet<string>
  aoAlternar: (chave: string) => void
  /** Nome acessível do grupo. */
  rotulo: string
  outro?: { ligado: boolean; aoAlternar: () => void; rotulo?: string }
  desabilitado?: boolean
}) {
  return (
    <div role="group" aria-label={rotulo} className="flex flex-wrap gap-2">
      {itens.map(({ chave, rotulo: texto, Icone }) => (
        <Chip key={chave} ligado={selecionados.has(chave)} aoClicar={() => aoAlternar(chave)} desabilitado={desabilitado}>
          <Icone size={16} aria-hidden className={selecionados.has(chave) ? '' : 'text-bronze'} /> {texto}
        </Chip>
      ))}
      {outro && (
        <Chip ligado={outro.ligado} aoClicar={outro.aoAlternar} desabilitado={desabilitado}>
          <Plus size={16} aria-hidden className={outro.ligado ? '' : 'text-bronze'} /> {outro.rotulo ?? 'Outro'}
        </Chip>
      )}
    </div>
  )
}

function Chip({ ligado, aoClicar, desabilitado, children }: { ligado: boolean; aoClicar: () => void; desabilitado?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-pressed={ligado} onClick={aoClicar} disabled={desabilitado}
      className={clsx(
        'inline-flex items-center gap-2 border px-3 py-2 text-sm transition-colors disabled:opacity-50',
        ligado ? 'border-stone bg-stone font-semibold text-ink' : 'border-line bg-ink-soft text-stone hover:border-bronze',
      )}
    >
      {children}
    </button>
  )
}

import { Flag } from 'lucide-react'
import { provisoriasDoCampo, regraProvisoria, type RegraProvisoria } from '@/lib/provisorias'

/**
 * Selo "Provisório (código)" ao lado de um campo configurável ou de uma regra (docs/ARQUITETURA_EXPANSAO.md §1.1).
 * Use `codigo` (ex.: "A2") ou `campo` (ex.: "configuracao_geral.exclusividade_dias"). Sem regra encontrada, não mostra nada.
 */
export function SeloProvisorio({ codigo, campo }: { codigo?: string; campo?: string }) {
  const regras: RegraProvisoria[] = codigo ? [regraProvisoria(codigo)].filter((r): r is RegraProvisoria => !!r) : campo ? provisoriasDoCampo(campo) : []
  if (!regras.length) return null
  const codigos = regras.map((r) => r.codigo).join(', ')
  const dica = regras.map((r) => `${r.codigo} — ${r.titulo}: ${r.regra}`).join('\n')
  return (
    <span title={dica} className="inline-flex items-center gap-1 whitespace-nowrap border border-bronze/40 px-2 py-0.5 text-[11px] font-semibold text-bronze">
      <Flag size={11} aria-hidden /> Provisório ({codigos})
    </span>
  )
}

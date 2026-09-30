import { mascaraMoeda, moedaParaNumero } from '@/lib/format'

interface PropsCampo {
  id?: string
  desabilitado?: boolean
  /** Marca o campo como inválido (borda e `aria-invalid`), para usar com o erro do `Campo`. */
  invalido?: boolean
}

/**
 * Valor em reais com centavos; os dígitos entram pelos centavos ("123456" → R$ 1.234,56). Devolve número ou `null`.
 * Só para o formulário: valores oficiais (simulação, contrato) vêm sempre do servidor.
 */
export function CampoMoeda({ valor, aoMudar, id, desabilitado, invalido, placeholder = '0,00' }: PropsCampo & {
  valor: number | null | undefined
  aoMudar: (v: number | null) => void
  placeholder?: string
}) {
  const texto = valor == null ? '' : valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm text-muted">R$</span>
      <input
        id={id} className="input pl-11" inputMode="numeric" placeholder={placeholder} value={texto}
        disabled={desabilitado} aria-invalid={invalido || undefined}
        onChange={(e) => {
          const m = mascaraMoeda(e.target.value)
          aoMudar(m ? moedaParaNumero(m) : null)
        }}
      />
    </div>
  )
}

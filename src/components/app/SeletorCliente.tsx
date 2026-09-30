import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search, X } from 'lucide-react'
import { crmClientesOpcoes } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { ETAPAS } from '@/lib/constants'
import type { ClienteOpcao } from '@/modulos/crm/tipos'

/**
 * Busca de cliente do CRM no escopo de quem usa (`crm_clientes_opcoes`, até 20 resultados, auditada sem o texto).
 * Usado em propostas e contratos. O valor é o cliente escolhido (id + nome) ou `null`.
 */
export function SeletorCliente({ valor, aoMudar, id, desabilitado, invalido, placeholder = 'Buscar cliente pelo nome…' }: {
  valor: ClienteOpcao | null
  aoMudar: (c: ClienteOpcao | null) => void
  id?: string
  desabilitado?: boolean
  invalido?: boolean
  placeholder?: string
}) {
  const idLista = useId()
  const [texto, setTexto] = useState('')
  const [termo, setTermo] = useState('')
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setTermo(texto.trim()), 300)
    return () => clearTimeout(t)
  }, [texto])

  const q = useQuery({
    queryKey: ['crm-clientes-opcoes', termo],
    enabled: aberto && !desabilitado,
    queryFn: () => crmClientesOpcoes({ p_busca: termo || null }),
    staleTime: 15_000,
  })

  if (valor) {
    return (
      <div className="input flex items-center justify-between gap-3">
        <span className="truncate">{valor.nome}</span>
        {!desabilitado && (
          <button type="button" className="text-muted hover:text-stone" aria-label="Trocar cliente" onClick={() => { aoMudar(null); setAberto(true) }}>
            <X size={16} />
          </button>
        )}
      </div>
    )
  }

  const opcoes = q.data ?? []
  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAberto(false) }}>
      <Search size={16} aria-hidden className="pointer-events-none absolute top-[1.4rem] left-3 -translate-y-1/2 text-muted" />
      <input
        id={id} className="input pl-9" role="combobox" aria-expanded={aberto} aria-controls={idLista} aria-autocomplete="list"
        aria-invalid={invalido || undefined} placeholder={placeholder} value={texto} disabled={desabilitado}
        onFocus={() => setAberto(true)} onChange={(e) => { setTexto(e.target.value); setAberto(true) }}
        onKeyDown={(e) => { if (e.key === 'Escape') setAberto(false) }}
      />
      {aberto && (
        <ul id={idLista} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto border border-line bg-ink-soft shadow-lg">
          {q.isPending && <li className="flex items-center gap-2 px-4 py-3 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Buscando…</li>}
          {q.error && <li className="px-4 py-3 text-sm text-perigo">{mensagemErro(q.error)}</li>}
          {!q.isPending && !q.error && opcoes.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nenhum cliente encontrado.</li>}
          {opcoes.map((c) => (
            <li key={c.id} role="option" aria-selected={false}>
              <button
                type="button" className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-sand"
                onClick={() => { aoMudar(c); setAberto(false); setTexto('') }}
              >
                <span className="truncate">{c.nome}</span>
                <span className="shrink-0 text-xs text-muted">{ETAPAS[c.etapa].rotulo}{c.corretor_nome ? ` · ${c.corretor_nome}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

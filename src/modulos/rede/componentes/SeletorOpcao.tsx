import { TIPOS_PARCEIRO } from '@/lib/constants'
import type { TipoParceiro, Uuid } from '@/lib/types'
import { useOpcoes, type OpcaoParceiro } from '../api'

/**
 * Seleção de parceiro ativo no escopo (a RLS já limita a lista), com um filtro de regra de tela (`aceita`). Mostra a
 * imobiliária quando a lista tem mais de uma. O servidor confere tudo de novo na RPC.
 */
export function SeletorOpcao({
  id, valor, aoMudar, tipos, imobiliariaId, aceita, vazio = 'Selecione…', invalido, desabilitado,
}: {
  id?: string
  valor: Uuid | null
  aoMudar: (id: Uuid | null) => void
  tipos: TipoParceiro[]
  imobiliariaId?: Uuid | null
  aceita?: (o: OpcaoParceiro) => boolean
  vazio?: string
  invalido?: boolean
  desabilitado?: boolean
}) {
  const q = useOpcoes({ tipos, imobiliariaId: imobiliariaId ?? null })
  const opcoes = (q.data ?? []).filter((o) => (aceita ? aceita(o) : true))
  const variasImobs = new Set(opcoes.map((o) => o.imobiliaria_id)).size > 1
  const variosTipos = tipos.length > 1
  return (
    <select
      id={id} className="input" value={valor ?? ''} disabled={desabilitado || q.isPending} aria-invalid={invalido || undefined}
      onChange={(e) => aoMudar(e.target.value || null)}
    >
      <option value="">{q.isPending ? 'Carregando…' : q.error ? 'Não foi possível carregar' : opcoes.length ? vazio : 'Nenhuma opção disponível'}</option>
      {opcoes.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nome}
          {variosTipos ? ` (${TIPOS_PARCEIRO[o.tipo]})` : ''}
          {variasImobs && o.imobiliaria ? ` — ${o.imobiliaria.da_casa ? 'Arken (casa)' : o.imobiliaria.nome}` : ''}
        </option>
      ))}
    </select>
  )
}

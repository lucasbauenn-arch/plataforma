import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { traduzirErro } from '@/lib/erros'
import { TIPOS_PARCEIRO } from '@/lib/constants'
import type { TipoParceiro } from '@/lib/types'
import type { Parceiro } from '@/modulos/rede/tipos'

type Opcao = Pick<Parceiro, 'id' | 'nome' | 'tipo' | 'imobiliaria_id' | 'gerente_id' | 'virtual'>

/**
 * Seleção de parceiro ativo dentro do escopo (a RLS de `parceiros` já limita: o corretor só vê a si, o gerente os
 * seus corretores, a imobiliária a imobiliária inteira). Serve para escolher corretor, gerente ou destino de
 * transferência; o servidor confere de novo na RPC.
 */
export function SeletorParceiro({
  valor, aoMudar, tipos = ['corretor'], imobiliariaId, gerenteId, excluir = [], vazio = 'Selecione…', id, desabilitado, invalido,
}: {
  valor: string | null | undefined
  aoMudar: (id: string | null) => void
  tipos?: TipoParceiro[]
  imobiliariaId?: string | null
  /** Só os corretores deste gerente. */
  gerenteId?: string | null
  excluir?: string[]
  vazio?: string
  id?: string
  desabilitado?: boolean
  invalido?: boolean
}) {
  const q = useQuery({
    queryKey: ['parceiros-opcoes', [...tipos].sort().join(','), imobiliariaId ?? null, gerenteId ?? null],
    queryFn: async () => {
      let c = supabase.from('parceiros').select('id, nome, tipo, imobiliaria_id, gerente_id, virtual').is('inativado_em', null).in('tipo', tipos)
      if (imobiliariaId) c = c.eq('imobiliaria_id', imobiliariaId)
      if (gerenteId) c = c.eq('gerente_id', gerenteId)
      const { data, error } = await c.order('nome')
      if (error) throw traduzirErro(error)
      return data as Opcao[]
    },
  })
  const opcoes = (q.data ?? []).filter((p) => !excluir.includes(p.id))
  const variosTipos = tipos.length > 1
  return (
    <select
      id={id} className="input" value={valor ?? ''} disabled={desabilitado || q.isPending} aria-invalid={invalido || undefined}
      onChange={(e) => aoMudar(e.target.value || null)}
    >
      <option value="">{q.isPending ? 'Carregando…' : q.error ? 'Não foi possível carregar' : vazio}</option>
      {opcoes.map((p) => (
        <option key={p.id} value={p.id}>{p.nome}{variosTipos ? ` (${TIPOS_PARCEIRO[p.tipo]})` : ''}</option>
      ))}
    </select>
  )
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { STATUS_PROPOSTA } from '@/lib/constants'
import { data } from '@/lib/format'
import type { Proposta, StatusProposta } from '@/lib/types'
import { Titulo } from './ui'

export default function PropostasAdmin() {
  const qc = useQueryClient()
  const { data: lista = [] } = useQuery({
    queryKey: ['admin-propostas'],
    queryFn: async () => (await supabase.from('propostas').select('*, empreendimentos(nome), parceiro_clientes(nome), profiles(nome, email)').order('created_at', { ascending: false })).data as Proposta[],
  })
  async function atualizar(p: Proposta, campos: Partial<Pick<Proposta, 'status' | 'resposta_admin'>>) {
    const { error } = await supabase.from('propostas').update(campos).eq('id', p.id)
    if (error) return toast.error('Erro ao salvar')
    toast.success('Proposta atualizada')
    qc.invalidateQueries({ queryKey: ['admin-propostas'] })
  }
  return (
    <>
      <Titulo>Propostas</Titulo>
      <div className="grid gap-4">
        {lista.map((p) => (
          <article key={p.id} className="card grid gap-4 p-5 lg:grid-cols-[1fr_320px]">
            <div>
              <p className="font-semibold">{p.empreendimentos?.nome}</p>
              <p className="text-xs text-muted">{data(p.created_at)} · Parceiro: {p.profiles?.nome || p.profiles?.email}{p.parceiro_clientes?.nome ? ` · Cliente: ${p.parceiro_clientes.nome}` : ''}</p>
              <p className="mt-3 whitespace-pre-line text-sm">{p.texto}</p>
            </div>
            <form className="grid content-start gap-2" onSubmit={(ev) => {
              ev.preventDefault()
              const f = new FormData(ev.currentTarget)
              atualizar(p, { status: f.get('status') as StatusProposta, resposta_admin: (f.get('resposta') as string) || null })
            }}>
              <select name="status" defaultValue={p.status} className="input !py-2">
                {Object.entries(STATUS_PROPOSTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <textarea name="resposta" defaultValue={p.resposta_admin ?? ''} rows={2} placeholder="Resposta ao parceiro" className="input !py-2" />
              <button className="btn-primary !py-2">Salvar</button>
            </form>
          </article>
        ))}
        {lista.length === 0 && <p className="text-muted">Nenhuma proposta.</p>}
      </div>
    </>
  )
}

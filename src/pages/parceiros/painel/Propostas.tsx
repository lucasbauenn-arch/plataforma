import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useEmpreendimentos } from '@/hooks/queries'
import { STATUS_PROPOSTA } from '@/lib/constants'
import { data } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { Carregando, Vazio } from '@/components/Estados'
import type { ParceiroCliente, Proposta } from '@/lib/types'

const schema = z.object({
  empreendimento_id: z.string().min(1, 'Selecione um empreendimento'),
  parceiro_cliente_id: z.string().optional(),
  texto: z.string().trim().min(10, 'Descreva a proposta'),
})
type Dados = z.infer<typeof schema>

const COR: Record<string, string> = {
  enviada: 'bg-sand text-stone', em_analise: 'bg-bronze/15 text-bronze', aprovada: 'bg-sage/15 text-sage', recusada: 'bg-red-500/15 text-red-300',
}

export default function PropostasParceiro() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: emps = [] } = useEmpreendimentos()
  const { data: clientes = [] } = useQuery({
    queryKey: ['parceiro_clientes'],
    queryFn: async () => (await supabase.from('parceiro_clientes').select('*').order('nome')).data as ParceiroCliente[],
  })
  const { data: propostas = [], isLoading } = useQuery({
    queryKey: ['propostas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('propostas').select('*, empreendimentos(nome), parceiro_clientes(nome)').order('created_at', { ascending: false })
      if (error) throw error
      return data as Proposta[]
    },
  })
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Dados>({ resolver: zodResolver(schema) })

  async function enviar(d: Dados) {
    const { error } = await supabase.from('propostas').insert({
      parceiro_id: profile!.id, empreendimento_id: d.empreendimento_id, parceiro_cliente_id: d.parceiro_cliente_id || null, texto: d.texto,
    })
    if (error) return toast.error('Não foi possível enviar a proposta.')
    toast.success('Proposta enviada!')
    reset()
    qc.invalidateQueries({ queryKey: ['propostas'] })
  }

  const disponiveis = emps.filter((e) => !['portfolio', 'futuro_lancamento'].includes(e.estagio))

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
      <form onSubmit={handleSubmit(enviar)} className="card grid content-start gap-4 p-6" noValidate>
        <h2 className="display text-3xl">Fazer proposta</h2>
        <Campo label="Empreendimento" obrigatorio erro={errors.empreendimento_id?.message}>
          <select className="input" {...register('empreendimento_id')} defaultValue="">
            <option value="" disabled>Selecione um empreendimento</option>
            {disponiveis.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </Campo>
        <Campo label="Cliente (opcional)">
          <select className="input" {...register('parceiro_cliente_id')} defaultValue="">
            <option value="">—</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        <Campo label="Proposta" obrigatorio erro={errors.texto?.message}>
          <textarea rows={6} className="input" placeholder="Unidade, valor, forma de pagamento, entrada, FGTS…" {...register('texto')} />
        </Campo>
        <button className="btn-primary justify-self-start" disabled={isSubmitting}>{isSubmitting ? 'Enviando…' : 'Enviar proposta'}</button>
      </form>
      <div>
        <h2 className="mb-4 font-semibold">Minhas propostas</h2>
        {isLoading ? <Carregando /> : propostas.length === 0 ? <Vazio titulo="Nenhuma proposta enviada" /> : (
          <ul className="grid gap-3">
            {propostas.map((p) => (
              <li key={p.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{p.empreendimentos?.nome}</p>
                    <p className="text-xs text-muted">{data(p.created_at)}{p.parceiro_clientes?.nome ? ` · ${p.parceiro_clientes.nome}` : ''}</p>
                  </div>
                  <span className={`px-2.5 py-0.5 text-xs font-semibold ${COR[p.status]}`}>{STATUS_PROPOSTA[p.status]}</span>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm text-stone/80">{p.texto}</p>
                {p.resposta_admin && <p className="mt-3 bg-sand/60 p-3 text-sm"><strong>Resposta Arken:</strong> {p.resposta_admin}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

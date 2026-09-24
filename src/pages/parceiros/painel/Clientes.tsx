import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, X, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { INTERESSES } from '@/lib/constants'
import { mascaraCpf, mascaraTelefone, cpfValido, data } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { Carregando, Vazio } from '@/components/Estados'
import type { ParceiroCliente } from '@/lib/types'

const schema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do cliente'),
  rg: z.string().optional(),
  cpf: z.string().optional().refine((v) => !v || cpfValido(v), 'CPF inválido'),
  telefone: z.string().refine((v) => v.replace(/\D/g, '').length >= 10, 'Telefone inválido'),
  anotacoes: z.string().max(2000).optional(),
  interesses: z.array(z.string()),
})
type Dados = z.infer<typeof schema>

function FormCliente({ cliente, fechar }: { cliente?: ParceiroCliente; fechar: () => void }) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Dados>({
    resolver: zodResolver(schema),
    defaultValues: cliente
      ? { nome: cliente.nome, rg: cliente.rg ?? '', cpf: cliente.cpf ? mascaraCpf(cliente.cpf) : '', telefone: cliente.telefone, anotacoes: cliente.anotacoes ?? '', interesses: cliente.interesses }
      : { interesses: [] },
  })

  async function salvar(d: Dados) {
    const dados = { nome: d.nome, rg: d.rg || null, cpf: d.cpf ? d.cpf.replace(/\D/g, '') : null, telefone: d.telefone, anotacoes: d.anotacoes || null, interesses: d.interesses }
    const { error } = cliente
      ? await supabase.from('parceiro_clientes').update(dados).eq('id', cliente.id)
      : await supabase.from('parceiro_clientes').insert({ parceiro_id: profile!.id, ...dados })
    if (error) return toast.error(cliente ? 'Não foi possível salvar as alterações.' : 'Não foi possível cadastrar o cliente.')
    toast.success(cliente ? 'Cliente atualizado!' : 'Cliente cadastrado!')
    qc.invalidateQueries({ queryKey: ['parceiro_clientes'] })
    fechar()
  }

  return (
    <form onSubmit={handleSubmit(salvar)} className="card grid gap-5 p-6 sm:p-8" noValidate>
      <div className="flex items-center justify-between">
        <h2 className="display text-3xl">{cliente ? 'Editar cliente' : 'Cadastrar cliente'}</h2>
        <button type="button" onClick={fechar} aria-label="Fechar"><X /></button>
      </div>
      <Campo label="Nome do cliente" obrigatorio erro={errors.nome?.message}><input className="input" {...register('nome')} /></Campo>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo label="RG"><input className="input" {...register('rg')} /></Campo>
        <Campo label="CPF" erro={errors.cpf?.message}>
          <input className="input" inputMode="numeric" {...register('cpf', { onChange: (e) => setValue('cpf', mascaraCpf(e.target.value)) })} />
        </Campo>
        <Campo label="Telefone" obrigatorio erro={errors.telefone?.message}>
          <input className="input" inputMode="tel" {...register('telefone', { onChange: (e) => setValue('telefone', mascaraTelefone(e.target.value)) })} />
        </Campo>
      </div>
      <Campo label="Anotações"><textarea rows={3} className="input" {...register('anotacoes')} /></Campo>
      <fieldset>
        <legend className="label">Interesses do cliente</legend>
        <div className="mt-2 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {INTERESSES.map((g) => (
            <div key={g.grupo}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{g.grupo}</p>
              <div className="flex flex-wrap gap-2">
                {g.opcoes.map((o) => (
                  <label key={o} className="cursor-pointer">
                    <input type="checkbox" value={o} className="peer sr-only" {...register('interesses')} />
                    <span className="inline-block border border-line bg-ink-soft px-3 py-1.5 text-sm transition peer-checked:border-stone peer-checked:bg-stone peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-bronze">{o}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <button className="btn-primary justify-self-start" disabled={isSubmitting}>{isSubmitting ? 'Salvando…' : cliente ? 'Salvar alterações' : 'Cadastrar cliente'}</button>
    </form>
  )
}

export default function ClientesParceiro() {
  const [form, setForm] = useState<'novo' | ParceiroCliente | null>(null)
  const [busca, setBusca] = useState('')
  const qc = useQueryClient()
  const { data: lista = [], isLoading } = useQuery({
    queryKey: ['parceiro_clientes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('parceiro_clientes').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as ParceiroCliente[]
    },
  })
  const remover = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('parceiro_clientes').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { toast.success('Cliente removido'); qc.invalidateQueries({ queryKey: ['parceiro_clientes'] }) },
  })
  const filtrados = lista.filter((c) => (c.nome + (c.cpf ?? '') + c.telefone).toLowerCase().includes(busca.toLowerCase()))

  return (
    <div className="grid gap-6">
      {form ? <FormCliente cliente={form === 'novo' ? undefined : form} fechar={() => setForm(null)} /> : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative sm:w-80">
            <Search className="absolute left-3.5 top-3.5 text-muted" size={16} />
            <input className="input pl-10" placeholder="Buscar cliente" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
          <button onClick={() => setForm('novo')} className="btn-primary"><Plus size={16} /> Cadastrar cliente</button>
        </div>
      )}
      {isLoading ? <Carregando /> : filtrados.length === 0 ? <Vazio titulo="Nenhum cliente cadastrado" texto="Cadastre seus clientes para acompanhar interesses e enviar propostas." /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-sand/50 text-left text-xs uppercase tracking-wider text-muted">
              <tr><th className="px-4 py-3">Nome</th><th>CPF</th><th>Telefone</th><th>Interesses</th><th>Cadastro</th><th /></tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id} className="border-t border-line align-top">
                  <td className="px-4 py-3 font-medium">{c.nome}{c.anotacoes && <p className="mt-0.5 text-xs font-normal text-muted">{c.anotacoes}</p>}</td>
                  <td className="py-3">{c.cpf ? mascaraCpf(c.cpf) : '—'}</td>
                  <td className="py-3">{c.telefone}</td>
                  <td className="py-3"><div className="flex max-w-xs flex-wrap gap-1">{c.interesses.map((i) => <span key={i} className="bg-sand px-2 py-0.5 text-xs">{i}</span>)}</div></td>
                  <td className="py-3 text-muted">{data(c.created_at)}</td>
                  <td className="space-x-3 whitespace-nowrap py-3 pr-4 text-right text-xs font-semibold">
                    <button className="inline-flex items-center gap-1 text-bronze" onClick={() => setForm(c)}><Pencil size={13} /> Editar</button>
                    <button className="text-muted hover:text-red-400" onClick={() => confirm(`Remover ${c.nome}?`) && remover.mutate(c.id)}>Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

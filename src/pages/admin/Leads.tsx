import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { data, waLink } from '@/lib/format'
import type { Lead } from '@/lib/types'
import { Titulo, Tabela } from './ui'

export default function Leads() {
  const qc = useQueryClient()
  const { data: lista = [] } = useQuery({
    queryKey: ['admin-leads'],
    queryFn: async () => (await supabase.from('leads').select('*, empreendimentos(nome)').order('created_at', { ascending: false })).data as (Lead & { empreendimentos: { nome: string } | null })[],
  })
  async function remover(l: Lead) {
    if (!confirm(`Excluir o contato de ${l.nome}? Não pode ser desfeito.`)) return
    const { error } = await supabase.from('leads').delete().eq('id', l.id)
    if (error) return toast.error('Erro ao excluir')
    qc.invalidateQueries({ queryKey: ['admin-leads'] })
  }
  function exportar() {
    const linhas = [['data', 'nome', 'telefone', 'email', 'empreendimento', 'mensagem'], ...lista.map((l) => [data(l.created_at), l.nome, l.telefone ?? '', l.email ?? '', l.empreendimentos?.nome ?? '', (l.mensagem ?? '').replace(/\n/g, ' ')])]
    const csv = linhas.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'leads-arken.csv'; a.click()
  }
  return (
    <>
      <Titulo acao={<button className="btn-ghost" onClick={exportar}>Exportar CSV</button>}>Leads do site</Titulo>
      <Tabela cab={['Data', 'Nome', 'Contato', 'Empreendimento', 'Mensagem', '']}>
        {lista.map((l) => (
          <tr key={l.id}>
            <td className="text-muted">{data(l.created_at)}</td>
            <td className="font-medium">{l.nome}</td>
            <td>{l.telefone && <a className="text-bronze" target="_blank" rel="noreferrer" href={waLink('55' + l.telefone.replace(/\D/g, ''), `Olá ${l.nome}, aqui é da Arken!`)}>{l.telefone}</a>}<br /><span className="text-muted">{l.email}</span></td>
            <td>{l.empreendimentos?.nome ?? '—'}</td>
            <td className="max-w-sm text-xs">{l.mensagem}</td>
            <td className="text-right"><button className="text-muted hover:text-red-400" onClick={() => remover(l)}><Trash2 size={14} /></button></td>
          </tr>
        ))}
      </Tabela>
    </>
  )
}

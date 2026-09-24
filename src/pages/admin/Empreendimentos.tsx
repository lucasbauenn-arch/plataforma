import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ESTAGIOS } from '@/lib/constants'
import type { Empreendimento } from '@/lib/types'
import { Imagem } from '@/components/Imagem'
import { Titulo, Tabela, Badge } from './ui'

export default function EmpreendimentosAdmin() {
  const nav = useNavigate()
  const { data: lista = [] } = useQuery({
    queryKey: ['admin-emps'],
    queryFn: async () => (await supabase.from('empreendimentos').select('*').order('ordem').order('nome')).data as Empreendimento[],
  })
  async function criar() {
    const nome = prompt('Nome do empreendimento')
    if (!nome) return
    const slug = nome.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const { data, error } = await supabase.from('empreendimentos').insert({ nome, slug, publicado: false }).select('id').single()
    if (error) return toast.error(error.code === '23505' ? 'Já existe um empreendimento com esse nome' : 'Erro ao criar')
    nav(`/admin/empreendimentos/${data.id}`)
  }
  return (
    <>
      <Titulo acao={<button className="btn-primary" onClick={criar}><Plus size={16} /> Novo</button>}>Empreendimentos</Titulo>
      <Tabela cab={['', 'Nome', 'Estágio', 'Home', 'Status', 'Ordem', '']}>
        {lista.map((e) => (
          <tr key={e.id}>
            <td className="w-20"><Imagem src={e.capa_url} alt="" className="h-12 w-16 object-cover" /></td>
            <td className="font-medium">{e.nome}<br /><span className="text-xs text-muted">/{e.slug}</span></td>
            <td>{ESTAGIOS[e.estagio]}</td>
            <td>{e.destaque_home ? '★' : ''}</td>
            <td>{e.publicado ? <Badge tom="ok">publicado</Badge> : <Badge>rascunho</Badge>}</td>
            <td>{e.ordem}</td>
            <td className="text-right"><Link to={`/admin/empreendimentos/${e.id}`} className="text-xs font-semibold text-bronze">Editar</Link></td>
          </tr>
        ))}
      </Tabela>
    </>
  )
}

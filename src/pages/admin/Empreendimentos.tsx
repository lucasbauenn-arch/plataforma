import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ESTAGIOS } from '@/lib/constants'
import { mensagemErro, traduzirErro } from '@/lib/erros'
import type { Empreendimento } from '@/lib/types'
import { Imagem } from '@/components/Imagem'
import { Carregando, Vazio } from '@/components/Estados'
import { ErroConsulta } from '@/components/app/Consulta'
import { Modal } from '@/components/app/Modal'
import { Campo } from '@/components/Campo'
import { Titulo, Tabela, Badge } from './ui'

export default function EmpreendimentosAdmin() {
  const nav = useNavigate()
  const q = useQuery({
    queryKey: ['admin-emps'],
    queryFn: async () => {
      const { data, error } = await supabase.from('empreendimentos').select('*').order('ordem').order('nome')
      if (error) throw traduzirErro(error)
      return (data ?? []) as Empreendimento[]
    },
  })
  const lista = q.data ?? []
  const [criando, setCriando] = useState(false)
  return (
    <>
      <Titulo acao={<button type="button" className="btn-primary" onClick={() => setCriando(true)}><Plus size={16} /> Novo</button>}>Empreendimentos</Titulo>
      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : lista.length === 0 ? (
        <Vazio titulo="Nenhum empreendimento cadastrado" texto="Use o botão Novo para criar o primeiro." />
      ) : (
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
      )}
      {criando && <NovoEmpreendimento aoFechar={() => setCriando(false)} aoCriar={(id) => nav(`/admin/empreendimentos/${id}`)} />}
    </>
  )
}

/** Endereço público a partir do nome: sem acento, minúsculas, hífens. */
function slugDoNome(nome: string) {
  return nome.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const esquemaNovo = z.object({ nome: z.string().trim().min(3, 'Informe o nome (mínimo 3 letras)').max(120, 'Nome longo demais') })
type DadosNovo = z.infer<typeof esquemaNovo>

/** Cria o empreendimento como rascunho (não publicado) e abre o editor. */
function NovoEmpreendimento({ aoFechar, aoCriar }: { aoFechar: () => void; aoCriar: (id: string) => void }) {
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<DadosNovo>({ resolver: zodResolver(esquemaNovo), defaultValues: { nome: '' } })
  const slug = slugDoNome(useWatch({ control, name: 'nome' }) ?? '')

  async function criar({ nome }: DadosNovo) {
    const { data, error } = await supabase.from('empreendimentos').insert({ nome, slug: slugDoNome(nome), publicado: false }).select('id').single()
    if (error) return void toast.error(error.code === '23505' ? 'Já existe um empreendimento com esse nome' : mensagemErro(error))
    toast.success('Empreendimento criado como rascunho.')
    aoCriar(data.id)
  }

  return (
    <Modal
      aberto
      titulo="Novo empreendimento"
      aoFechar={aoFechar}
      bloquearFechar={isSubmitting}
      rodape={<>
        <button type="button" className="btn-ghost" onClick={aoFechar} disabled={isSubmitting}>Cancelar</button>
        <button type="submit" form="form-novo-emp" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Criando…' : 'Criar e editar'}</button>
      </>}
    >
      <form id="form-novo-emp" onSubmit={handleSubmit(criar)} className="grid gap-4">
        <Campo label="Nome do empreendimento" erro={errors.nome?.message}>
          <input className="input" autoFocus {...register('nome')} />
        </Campo>
        <p className="text-xs text-muted">Endereço no site: <span className="text-stone">/empreendimentos/{slug || '…'}</span>. Ele nasce como rascunho, fora do site, até você publicar no editor.</p>
      </form>
    </Modal>
  )
}

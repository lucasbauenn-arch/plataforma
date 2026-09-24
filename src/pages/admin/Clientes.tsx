import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useEmpreendimentos } from '@/hooks/queries'
import { cpfValido, mascaraCpf, mascaraTelefone, soDigitos, brl, data } from '@/lib/format'
import { Campo } from '@/components/Campo'
import type { Cliente, ClienteArquivo, ClienteNegocio } from '@/lib/types'
import { Titulo, Tabela } from './ui'

function EditarCliente({ c, salvo, cancelar }: { c: Cliente; salvo: (c: Cliente) => void; cancelar: () => void }) {
  async function salvar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>
    if (!cpfValido(f.cpf)) return toast.error('CPF inválido')
    const upd = { nome: f.nome, cpf: soDigitos(f.cpf), email: f.email.trim().toLowerCase() || null, telefone: f.telefone || null }
    const { error } = await supabase.from('clientes').update(upd).eq('id', c.id).select().single()
    if (error) return toast.error(error.code === '23505' ? 'CPF já cadastrado para outro cliente' : 'Erro ao salvar')
    toast.success('Dados atualizados'); salvo({ ...c, ...upd })
  }
  return (
    <form onSubmit={salvar} className="grid gap-3 border-b border-line pb-6 sm:grid-cols-2">
      <Campo label="Nome"><input name="nome" required defaultValue={c.nome} className="input" /></Campo>
      <Campo label="CPF"><input name="cpf" required defaultValue={mascaraCpf(c.cpf)} className="input" onChange={(e) => (e.target.value = mascaraCpf(e.target.value))} /></Campo>
      <Campo label="E-mail (opcional)"><input name="email" type="email" defaultValue={c.email ?? ''} className="input" /></Campo>
      <Campo label="Telefone"><input name="telefone" defaultValue={c.telefone ?? ''} className="input" onChange={(e) => (e.target.value = mascaraTelefone(e.target.value))} /></Campo>
      <div className="flex gap-3 sm:col-span-2"><button className="btn-primary !py-2">Salvar</button><button type="button" onClick={cancelar} className="btn-ghost !py-2">Cancelar</button></div>
    </form>
  )
}

function Detalhe({ c, aoEditar, fechar }: { c: Cliente; aoEditar: (c: Cliente) => void; fechar: () => void }) {
  const qc = useQueryClient()
  const [editando, setEditando] = useState(false)
  const { data: emps = [] } = useEmpreendimentos()
  const { data: d } = useQuery({
    queryKey: ['admin-cli', c.id],
    queryFn: async () => ({
      negocios: (await supabase.from('cliente_negocios').select('*, empreendimentos(nome, slug, capa_url)').eq('cliente_id', c.id)).data as ClienteNegocio[],
      arquivos: (await supabase.from('cliente_arquivos').select('*').eq('cliente_id', c.id).order('created_at', { ascending: false })).data as ClienteArquivo[],
    }),
  })
  const recarregar = () => qc.invalidateQueries({ queryKey: ['admin-cli', c.id] })

  async function addNegocio(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const f = new FormData(ev.currentTarget)
    const { error } = await supabase.from('cliente_negocios').insert({
      cliente_id: c.id, empreendimento_id: f.get('emp') || null, descricao: f.get('desc') || null,
      valor: f.get('valor') ? Number(String(f.get('valor')).replace(/\./g, '').replace(',', '.')) : null,
    })
    if (error) return toast.error('Erro ao salvar negócio')
    ev.currentTarget.reset(); recarregar()
  }

  async function upload(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files ?? [])
    for (const file of files) {
      const path = `${c.id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`
      const up = await supabase.storage.from('cliente-arquivos').upload(path, file)
      if (up.error) { toast.error(`Falha: ${file.name}`); continue }
      await supabase.from('cliente_arquivos').insert({ cliente_id: c.id, nome: file.name, storage_path: path })
    }
    ev.target.value = ''; recarregar(); toast.success('Arquivos enviados')
  }

  async function removerArquivo(a: ClienteArquivo) {
    if (!confirm(`Remover ${a.nome}?`)) return
    await supabase.storage.from('cliente-arquivos').remove([a.storage_path])
    await supabase.from('cliente_arquivos').delete().eq('id', a.id); recarregar()
  }

  return (
    <div className="card mt-8 grid gap-8 p-6">
      <div className="flex justify-between gap-3">
        {editando ? (
          <div className="flex-1"><EditarCliente c={c} cancelar={() => setEditando(false)} salvo={(atualizado) => { setEditando(false); aoEditar(atualizado); recarregar() }} /></div>
        ) : (
          <h2 className="text-xl font-semibold">
            {c.nome} <span className="text-sm font-normal text-muted">{mascaraCpf(c.cpf)}</span>
            <button onClick={() => setEditando(true)} className="ml-3 inline-flex items-center gap-1 align-middle text-xs font-semibold text-bronze"><Pencil size={13} /> Editar</button>
          </h2>
        )}
        <button onClick={fechar} className="shrink-0 text-sm text-muted">Fechar</button>
      </div>
      <div>
        <h3 className="mb-3 font-semibold">Negócios / imóveis</h3>
        <ul className="mb-4 grid gap-2 text-sm">
          {d?.negocios.map((n) => (
            <li key={n.id} className="flex justify-between bg-sand/40 px-4 py-2">
              <span>{n.empreendimentos?.nome ?? n.descricao} {n.valor ? `· ${brl(n.valor)}` : ''}</span>
              <button className="text-muted hover:text-red-400" onClick={async () => { await supabase.from('cliente_negocios').delete().eq('id', n.id); recarregar() }}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
        <form onSubmit={addNegocio} className="grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto]">
          <select name="emp" className="input !py-2"><option value="">Empreendimento…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
          <input name="desc" className="input !py-2" placeholder="Unidade / descrição" />
          <input name="valor" className="input !py-2" placeholder="Valor" inputMode="decimal" />
          <button className="btn-primary !py-2"><Plus size={15} /> Adicionar</button>
        </form>
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Documentos</h3>
          <label className="btn-ghost cursor-pointer !py-2"><Upload size={15} /> Enviar arquivos<input type="file" multiple className="sr-only" onChange={upload} /></label>
        </div>
        <ul className="divide-y divide-line text-sm">
          {d?.arquivos.map((a) => (
            <li key={a.id} className="flex justify-between py-2"><span>{a.nome} <span className="text-xs text-muted">{data(a.created_at)}</span></span>
              <button className="text-muted hover:text-red-400" onClick={() => removerArquivo(a)}><Trash2 size={15} /></button></li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default function ClientesAdmin() {
  const qc = useQueryClient()
  const [sel, setSel] = useState<Cliente | null>(null)
  const [novo, setNovo] = useState(false)
  const { data: lista = [] } = useQuery({
    queryKey: ['admin-clientes'],
    queryFn: async () => (await supabase.from('clientes').select('*').order('nome')).data as Cliente[],
  })

  async function criar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>
    if (!cpfValido(f.cpf)) return toast.error('CPF inválido')
    const { error } = await supabase.from('clientes').insert({ nome: f.nome, cpf: soDigitos(f.cpf), email: f.email.trim().toLowerCase() || null, telefone: f.telefone || null })
    if (error) return toast.error(error.code === '23505' ? 'CPF já cadastrado' : 'Erro ao salvar')
    toast.success('Cliente cadastrado'); setNovo(false); qc.invalidateQueries({ queryKey: ['admin-clientes'] })
  }

  return (
    <>
      <Titulo acao={<button className="btn-primary" onClick={() => setNovo(!novo)}><Plus size={16} /> Novo cliente</button>}>Clientes (portal)</Titulo>
      {novo && (
        <form onSubmit={criar} className="card mb-6 grid gap-3 p-5 sm:grid-cols-5">
          <input name="nome" required placeholder="Nome" className="input sm:col-span-2" />
          <input name="cpf" required placeholder="CPF" className="input" onChange={(e) => (e.target.value = mascaraCpf(e.target.value))} />
          <input name="email" type="email" placeholder="E-mail (opcional)" className="input" />
          <input name="telefone" placeholder="Telefone" className="input" onChange={(e) => (e.target.value = mascaraTelefone(e.target.value))} />
          <button className="btn-primary sm:col-span-5 sm:justify-self-start">Salvar</button>
        </form>
      )}
      <Tabela cab={['Nome', 'CPF', 'E-mail', 'Telefone', 'Acesso', '']}>
        {lista.map((c) => (
          <tr key={c.id}>
            <td className="font-medium">{c.nome}</td><td>{mascaraCpf(c.cpf)}</td><td>{c.email ?? <span className="text-muted">—</span>}</td><td>{c.telefone}</td>
            <td className="text-xs">{c.user_id ? 'Ativo' : 'Nunca acessou'}</td>
            <td className="text-right"><button className="text-xs font-semibold text-bronze" onClick={() => setSel(c)}>Gerenciar</button></td>
          </tr>
        ))}
      </Tabela>
      {sel && (
        <Detalhe c={sel} fechar={() => setSel(null)}
          aoEditar={(atualizado) => { setSel(atualizado); qc.setQueryData<Cliente[]>(['admin-clientes'], (l) => l?.map((x) => (x.id === atualizado.id ? atualizado : x))) }} />
      )}
    </>
  )
}

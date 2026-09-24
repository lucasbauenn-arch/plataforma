import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Pencil, Trash2, Upload, Plus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ESTAGIOS, STATUS_UNIDADE } from '@/lib/constants'
import { midiaUrl } from '@/lib/midia'
import { brl } from '@/lib/format'
import type { EmpreendimentoCompleto, TipoMidia, Unidade, ObraAtualizacao, StatusUnidade } from '@/lib/types'
import { Carregando } from '@/components/Estados'
import { lerEspelhoVendas, numeroBR } from '@/lib/espelho'

type Aba = 'dados' | 'midias' | 'conteudo' | 'unidades' | 'obra'
const ABAS: [Aba, string][] = [['dados', 'Dados'], ['midias', 'Galeria'], ['conteudo', 'Lazer, ficha e proximidades'], ['unidades', 'Unidades e materiais'], ['obra', 'Andamento da obra']]

async function enviarArquivo(empId: string, file: File) {
  const path = `emp/${empId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`
  const { error } = await supabase.storage.from('empreendimentos').upload(path, file, { cacheControl: '31536000' })
  if (error) { toast.error(`Falha ao enviar ${file.name}`); return null }
  return path
}

// campos não controlados do formulário "Dados" — fora do componente para não remontar a cada render
type CampoEmp = { e: EmpreendimentoCompleto; n: keyof EmpreendimentoCompleto; l: string }
const I = ({ e, n, l, t = 'text', w = '' }: CampoEmp & { t?: string; w?: string }) => (
  <label className={w}><span className="label">{l}</span><input name={n} type={t} step="any" className="input" defaultValue={(e[n] as string | number | null) ?? ''} /></label>
)
const T = ({ e, n, l, r = 4 }: CampoEmp & { r?: number }) => (
  <label className="sm:col-span-2"><span className="label">{l}</span><textarea name={n} rows={r} className="input" defaultValue={(e[n] as string | null) ?? ''} /></label>
)
const C = ({ e, n, l }: CampoEmp) => (
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={n} defaultChecked={!!e[n]} className="accent-bronze" /> {l}</label>
)

function Dados({ e, salvo }: { e: EmpreendimentoCompleto; salvo: () => void }) {
  async function salvar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const f = new FormData(ev.currentTarget)
    const txt = (k: string) => ((f.get(k) as string) || '').trim() || null
    const upd = {
      nome: txt('nome'), slug: txt('slug'), estagio: f.get('estagio'), chamada: txt('chamada'), tagline: txt('tagline'), titulo_hero: txt('titulo_hero'),
      descricao: txt('descricao'), titulo_lazer: txt('titulo_lazer'), descricao_lazer: txt('descricao_lazer'),
      endereco: txt('endereco'), bairro: txt('bairro'), cidade: txt('cidade'), uf: txt('uf'), cep: txt('cep'),
      titulo_localizacao: txt('titulo_localizacao'), texto_localizacao: txt('texto_localizacao'), waze_url: txt('waze_url'),
      latitude: txt('latitude') ? Number(txt('latitude')) : null, longitude: txt('longitude') ? Number(txt('longitude')) : null,
      dormitorios: txt('dormitorios'), vagas: txt('vagas'), metragem: txt('metragem'), categoria: txt('categoria'), construtora: txt('construtora'),
      total_unidades: txt('total_unidades') ? Number(txt('total_unidades')) : null, previsao_entrega: txt('previsao_entrega'),
      videos: (txt('videos') ?? '').split('\n').map((s) => s.trim()).filter(Boolean), tour_virtual_url: txt('tour_virtual_url'),
      aceita_fgts: f.get('aceita_fgts') === 'on', destaque_home: f.get('destaque_home') === 'on', publicado: f.get('publicado') === 'on',
      mostrar_no_portfolio: f.get('mostrar_no_portfolio') === 'on', ordem: Number(f.get('ordem') || 0),
    }
    const { error } = await supabase.from('empreendimentos').update(upd).eq('id', e.id)
    if (error) return toast.error('Erro ao salvar: ' + error.message)
    toast.success('Salvo'); salvo()
  }
  async function trocarCapa(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]; if (!file) return
    const p = await enviarArquivo(e.id, file); if (!p) return
    await supabase.from('empreendimentos').update({ capa_url: p }).eq('id', e.id); salvo()
  }
  return (
    <form onSubmit={salvar} className="grid gap-8">
      <div className="card flex flex-wrap items-center gap-5 p-5">
        {e.capa_url ? <img src={midiaUrl(e.capa_url)!} className="h-24 w-36 object-cover" alt="" /> : <div className="h-24 w-36 bg-sand" />}
        <label className="btn-ghost cursor-pointer"><Upload size={15} /> Trocar imagem de capa<input type="file" accept="image/*" className="sr-only" onChange={trocarCapa} /></label>
        <div className="ml-auto flex flex-wrap gap-5"><C e={e} n="publicado" l="Publicado" /><C e={e} n="destaque_home" l="Destaque na home" /><C e={e} n="aceita_fgts" l="Aceita FGTS" /><C e={e} n="mostrar_no_portfolio" l="Mostrar no portfólio" /></div>
      </div>
      <fieldset className="card grid gap-4 p-6 sm:grid-cols-2">
        <legend className="px-2 font-semibold">Principal</legend>
        <I e={e} n="nome" l="Nome" /><I e={e} n="slug" l="Slug (URL)" />
        <label><span className="label">Estágio</span><select name="estagio" defaultValue={e.estagio} className="input">{Object.entries(ESTAGIOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <I e={e} n="ordem" l="Ordem de exibição" t="number" />
        <I e={e} n="chamada" l="Chamada do hero (ex.: More ao lado de tudo)" w="sm:col-span-2" />
        <I e={e} n="tagline" l="Tagline da seção sobre" /><I e={e} n="titulo_hero" l="Título da seção sobre" />
        <T e={e} n="descricao" l="Descrição" r={6} />
      </fieldset>
      <fieldset className="card grid gap-4 p-6 sm:grid-cols-4">
        <legend className="px-2 font-semibold">Características</legend>
        <I e={e} n="dormitorios" l="Dormitórios" /><I e={e} n="vagas" l="Vagas" /><I e={e} n="metragem" l="Metragem" /><I e={e} n="total_unidades" l="Total de unidades" t="number" />
        <I e={e} n="categoria" l="Categoria" /><I e={e} n="construtora" l="Construtora" /><I e={e} n="previsao_entrega" l="Previsão de entrega" t="date" />
      </fieldset>
      <fieldset className="card grid gap-4 p-6 sm:grid-cols-2">
        <legend className="px-2 font-semibold">Localização</legend>
        <I e={e} n="endereco" l="Endereço" w="sm:col-span-2" /><I e={e} n="bairro" l="Bairro" /><I e={e} n="cidade" l="Cidade" /><I e={e} n="uf" l="UF" /><I e={e} n="cep" l="CEP" />
        <I e={e} n="latitude" l="Latitude" t="number" /><I e={e} n="longitude" l="Longitude" t="number" />
        <I e={e} n="waze_url" l="Link do Waze" w="sm:col-span-2" /><I e={e} n="titulo_localizacao" l="Título da seção" w="sm:col-span-2" />
        <T e={e} n="texto_localizacao" l="Texto da localização" />
      </fieldset>
      <fieldset className="card grid gap-4 p-6 sm:grid-cols-2">
        <legend className="px-2 font-semibold">Lazer e mídia</legend>
        <I e={e} n="titulo_lazer" l="Título da seção de lazer" w="sm:col-span-2" /><T e={e} n="descricao_lazer" l="Descrição do lazer" r={3} />
        <label className="sm:col-span-2"><span className="label">Vídeos do YouTube (um por linha)</span><textarea name="videos" rows={2} className="input" defaultValue={e.videos.join('\n')} /></label>
        <I e={e} n="tour_virtual_url" l="URL do tour virtual 360°" w="sm:col-span-2" />
      </fieldset>
      <button className="btn-primary sticky bottom-4 justify-self-start shadow-lg">Salvar alterações</button>
    </form>
  )
}

function Midias({ e, salvo }: { e: EmpreendimentoCompleto; salvo: () => void }) {
  const [tipo, setTipo] = useState<TipoMidia>('fachada')
  async function upload(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files ?? [])
    let ordem = e.empreendimento_midias.filter((m) => m.tipo === tipo).length
    for (const f of files) {
      const p = await enviarArquivo(e.id, f)
      if (p) await supabase.from('empreendimento_midias').insert({ empreendimento_id: e.id, tipo, url: p, ordem: ordem++ })
    }
    ev.target.value = ''; salvo()
  }
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select value={tipo} onChange={(ev) => setTipo(ev.target.value as TipoMidia)} className="input !w-auto">
          <option value="fachada">Fachada</option><option value="area_comum">Área comum</option><option value="planta">Plantas</option><option value="decorado">Decorado</option><option value="obra">Obra</option>
        </select>
        <label className="btn-primary cursor-pointer"><Upload size={15} /> Enviar imagens<input type="file" multiple accept="image/*" className="sr-only" onChange={upload} /></label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {e.empreendimento_midias.map((m) => (
          <figure key={m.id} className="group relative overflow-hidden bg-sand">
            <img src={midiaUrl(m.url)!} alt="" className="aspect-square w-full object-cover" loading="lazy" />
            <figcaption className="absolute inset-x-0 bottom-0 bg-ink/70 px-2 py-1 text-xs text-stone">{m.tipo}</figcaption>
            <button onClick={async () => { await supabase.from('empreendimento_midias').delete().eq('id', m.id); salvo() }}
              className="absolute right-2 top-2 bg-stone p-1.5 text-ink opacity-0 group-hover:opacity-100" aria-label="Remover"><Trash2 size={14} /></button>
          </figure>
        ))}
      </div>
    </div>
  )
}

type Campo = { k: string; l: string }
function Repetidor({ titulo, tabela, empId, itens, campos, salvo }: { titulo: string; tabela: string; empId: string; itens: Record<string, unknown>[]; campos: Campo[]; salvo: () => void }) {
  const [editId, setEditId] = useState<string | null>(null)
  const editando = itens.find((it) => it.id === editId) ?? null

  async function salvarForm(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>
    const row: Record<string, unknown> = {}
    campos.forEach((c) => (row[c.k] = f[c.k] || null))
    const { error } = editId
      ? await supabase.from(tabela).update(row).eq('id', editId)
      : await supabase.from(tabela).insert({ ...row, empreendimento_id: empId, ordem: itens.length })
    if (error) return toast.error(error.message)
    if (!editId) ev.currentTarget.reset()
    setEditId(null); salvo()
  }
  return (
    <section className="card p-6">
      <h3 className="mb-4 font-semibold">{titulo}</h3>
      <ul className="mb-4 grid gap-2 text-sm">
        {itens.map((it) => (
          <li key={it.id as string} className="flex items-start justify-between gap-3 bg-sand/40 px-4 py-2">
            <span><strong>{it[campos[0].k] as string}</strong> {campos.slice(1).map((c) => it[c.k]).filter(Boolean).join(' · ')}</span>
            <span className="flex shrink-0 gap-3">
              <button className="text-muted hover:text-bronze" onClick={() => setEditId(it.id as string)}><Pencil size={14} /></button>
              <button className="text-muted hover:text-red-400" onClick={async () => { if (editId === it.id) setEditId(null); await supabase.from(tabela).delete().eq('id', it.id as string); salvo() }}><Trash2 size={15} /></button>
            </span>
          </li>
        ))}
      </ul>
      {editId && <p className="mb-2 flex items-center justify-between text-xs text-bronze">Editando item <button type="button" className="inline-flex items-center gap-1 text-muted" onClick={() => setEditId(null)}><X size={12} /> cancelar</button></p>}
      <form key={editId ?? 'novo'} onSubmit={salvarForm} className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
        {campos.map((c, i) => <input key={c.k} name={c.k} required={i === 0} defaultValue={editando ? (editando[c.k] as string ?? '') : ''} placeholder={c.l} className="input !py-2" />)}
        <button className="btn-ghost !py-2">{editId ? <><Pencil size={15} /> Salvar</> : <><Plus size={15} /> Adicionar</>}</button>
      </form>
    </section>
  )
}

function Unidades({ e }: { e: EmpreendimentoCompleto }) {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const { data: unidades = [] } = useQuery({
    queryKey: ['unidades', e.id],
    queryFn: async () => (await supabase.from('unidades').select('*').eq('empreendimento_id', e.id).order('identificador')).data as Unidade[],
  })
  const { data: mat } = useQuery({
    queryKey: ['material', e.id],
    queryFn: async () => (await supabase.from('empreendimento_materiais').select('*').eq('empreendimento_id', e.id).maybeSingle()).data as { drive_url: string | null } | null,
  })
  const recarregar = () => qc.invalidateQueries({ queryKey: ['unidades', e.id] })
  const num = numeroBR

  async function importar(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]; if (!file) return
    const dados = lerEspelhoVendas(await file.text()).map((l) => ({ empreendimento_id: e.id, ...l }))
    if (!dados.length) return toast.error('Nenhuma linha válida. Formato: unidade;metragem;valor;status')
    if (!confirm(`Substituir a tabela atual por ${dados.length} unidades?`)) return
    await supabase.from('unidades').delete().eq('empreendimento_id', e.id)
    const { error } = await supabase.from('unidades').insert(dados)
    ev.target.value = ''
    if (error) return toast.error(error.message)
    toast.success(`${dados.length} unidades importadas`); recarregar()
  }
  async function status(u: Unidade, s: StatusUnidade) { await supabase.from('unidades').update({ status: s }).eq('id', u.id); recarregar() }
  const editando = unidades.find((u) => u.id === editId) ?? null
  async function salvarUnidade(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>
    const dados = { identificador: f.id, metragem: num(f.m), valor: num(f.v) }
    const { error } = editId
      ? await supabase.from('unidades').update(dados).eq('id', editId)
      : await supabase.from('unidades').insert({ empreendimento_id: e.id, ...dados })
    if (error) return toast.error(error.message)
    if (!editId) ev.currentTarget.reset()
    setEditId(null); recarregar()
  }
  async function salvarDrive(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault(); const url = (new FormData(ev.currentTarget).get('drive') as string) || null
    const { error } = await supabase.from('empreendimento_materiais').upsert({ empreendimento_id: e.id, drive_url: url })
    if (error) toast.error(error.message); else toast.success('Link salvo')
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={salvarDrive} className="card flex flex-wrap items-end gap-3 p-5">
        <label className="min-w-64 flex-1"><span className="label">Pasta de materiais para parceiros (Google Drive)</span><input name="drive" key={mat?.drive_url ?? ''} defaultValue={mat?.drive_url ?? ''} className="input" /></label>
        <button className="btn-primary">Salvar link</button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{unidades.length} unidades · {unidades.filter((u) => u.status === 'disponivel').length} disponíveis</h3>
        <label className="btn-ghost cursor-pointer"><Upload size={15} /> Importar espelho de vendas (CSV)<input type="file" accept=".csv,.txt" className="sr-only" onChange={importar} /></label>
      </div>
      {editId && <p className="flex items-center justify-between text-xs text-bronze">Editando {editando?.identificador} <button type="button" className="inline-flex items-center gap-1 text-muted" onClick={() => setEditId(null)}><X size={12} /> cancelar</button></p>}
      <form key={editId ?? 'novo'} onSubmit={salvarUnidade} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input name="id" required defaultValue={editando?.identificador ?? ''} placeholder="Unidade (APTO 01)" className="input !py-2" />
        <input name="m" defaultValue={editando?.metragem ?? ''} placeholder="Metragem" className="input !py-2" />
        <input name="v" defaultValue={editando?.valor ?? ''} placeholder="Valor" className="input !py-2" />
        <button className="btn-ghost !py-2">{editId ? <><Pencil size={15} /> Salvar</> : <><Plus size={15} /> Adicionar</>}</button>
      </form>
      <div className="card max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-sand text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">Unidade</th><th>m²</th><th>Valor</th><th>Status</th><th /></tr></thead>
          <tbody>
            {unidades.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="px-4 py-2 font-medium">{u.identificador}</td><td>{u.metragem}</td><td>{brl(u.valor)}</td>
                <td><select value={u.status} onChange={(ev) => status(u, ev.target.value as StatusUnidade)} className="border border-line bg-ink-soft px-2 py-1 text-xs">
                  {Object.entries(STATUS_UNIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                <td className="space-x-3 whitespace-nowrap pr-4 text-right">
                  <button className="text-muted hover:text-bronze" onClick={() => setEditId(u.id)}><Pencil size={13} /></button>
                  <button className="text-muted hover:text-red-400" onClick={async () => { if (editId === u.id) setEditId(null); await supabase.from('unidades').delete().eq('id', u.id); recarregar() }}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Obra({ e }: { e: EmpreendimentoCompleto }) {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [fotosRestantes, setFotosRestantes] = useState<string[]>([])
  const { data: lista = [] } = useQuery({
    queryKey: ['obra', e.id],
    queryFn: async () => (await supabase.from('obra_atualizacoes').select('*').eq('empreendimento_id', e.id).order('data', { ascending: false })).data as ObraAtualizacao[],
  })
  const editando = lista.find((o) => o.id === editId) ?? null
  const recarregar = () => qc.invalidateQueries({ queryKey: ['obra', e.id] })

  function editar(o: ObraAtualizacao) { setEditId(o.id); setFotosRestantes(o.fotos) }
  function cancelar() { setEditId(null); setFotosRestantes([]) }

  async function salvar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const form = ev.currentTarget; const f = new FormData(form)
    const fotosNovas: string[] = []
    for (const file of f.getAll('fotos') as File[]) { if (file.size) { const p = await enviarArquivo(e.id, file); if (p) fotosNovas.push(p) } }
    const dados = {
      titulo: f.get('titulo'), descricao: f.get('descricao') || null,
      percentual: f.get('pct') ? Number(f.get('pct')) : null, data: f.get('data') || undefined,
      fotos: [...fotosRestantes, ...fotosNovas],
    }
    const { error } = editId
      ? await supabase.from('obra_atualizacoes').update(dados).eq('id', editId)
      : await supabase.from('obra_atualizacoes').insert({ empreendimento_id: e.id, ...dados })
    if (error) return toast.error(error.message)
    if (!editId) form.reset()
    toast.success(editId ? 'Atualização salva' : 'Atualização publicada'); cancelar(); recarregar()
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <form key={editId ?? 'nova'} onSubmit={salvar} className="card grid content-start gap-3 p-5">
        <div className="flex items-center justify-between"><h3 className="font-semibold">{editId ? 'Editar atualização' : 'Nova atualização'}</h3>
          {editId && <button type="button" onClick={cancelar} className="inline-flex items-center gap-1 text-xs text-muted"><X size={12} /> cancelar</button>}
        </div>
        <input name="titulo" required defaultValue={editando?.titulo ?? ''} placeholder="Título (ex.: Concretagem da 5ª laje)" className="input" />
        <textarea name="descricao" rows={3} defaultValue={editando?.descricao ?? ''} placeholder="Descrição" className="input" />
        <div className="grid grid-cols-2 gap-2">
          <input name="pct" type="number" min={0} max={100} defaultValue={editando?.percentual ?? ''} placeholder="% concluído" className="input" />
          <input name="data" type="date" defaultValue={editando?.data ?? ''} className="input" />
        </div>
        {editId && fotosRestantes.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {fotosRestantes.map((p) => (
              <div key={p} className="group relative">
                <img src={midiaUrl(p)!} alt="" className="aspect-square w-full object-cover" />
                <button type="button" onClick={() => setFotosRestantes((fs) => fs.filter((x) => x !== p))}
                  className="absolute right-0.5 top-0.5 bg-stone p-0.5 text-ink opacity-0 group-hover:opacity-100" aria-label="Remover foto"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <label className="text-sm"><span className="label">{editId ? 'Adicionar mais fotos' : 'Fotos'}</span><input name="fotos" type="file" multiple accept="image/*" className="text-sm" /></label>
        <button className="btn-primary">{editId ? 'Salvar alterações' : 'Publicar'}</button>
      </form>
      <ul className="grid content-start gap-3">
        {lista.map((o) => (
          <li key={o.id} className="card flex justify-between gap-4 p-4 text-sm">
            <div><p className="font-semibold">{o.titulo} {o.percentual != null && <span className="text-bronze">· {o.percentual}%</span>}</p><p className="text-xs text-muted">{new Date(o.data).toLocaleDateString('pt-BR')} · {o.fotos.length} fotos</p></div>
            <span className="flex shrink-0 gap-3">
              <button className="text-muted hover:text-bronze" onClick={() => editar(o)}><Pencil size={15} /></button>
              <button className="text-muted hover:text-red-400" onClick={async () => { if (editId === o.id) cancelar(); await supabase.from('obra_atualizacoes').delete().eq('id', o.id); recarregar() }}><Trash2 size={15} /></button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function EmpreendimentoEditor() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [aba, setAba] = useState<Aba>('dados')
  const { data: e, isLoading } = useQuery({
    queryKey: ['admin-emp', id],
    queryFn: async () => {
      const { data } = await supabase.from('empreendimentos')
        .select('*, empreendimento_midias(*), empreendimento_lazer(*), empreendimento_proximidades(*), empreendimento_ficha(*)').eq('id', id!).single()
      const x = data as EmpreendimentoCompleto
      const o = (a: { ordem: number }, b: { ordem: number }) => a.ordem - b.ordem
      x.empreendimento_midias.sort(o); x.empreendimento_lazer.sort(o); x.empreendimento_proximidades.sort(o); x.empreendimento_ficha.sort(o)
      return x
    },
  })
  const salvo = () => { qc.invalidateQueries({ queryKey: ['admin-emp', id] }); qc.invalidateQueries({ queryKey: ['empreendimentos'] }) }
  if (isLoading || !e) return <Carregando />
  return (
    <>
      <Link to="/admin/empreendimentos" className="mb-4 inline-flex items-center gap-1 text-sm text-muted"><ArrowLeft size={15} /> Empreendimentos</Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="display text-4xl">{e.nome}</h1>
        <Link to={`/empreendimentos/${e.slug}`} target="_blank" className="btn-ghost !py-2">Ver no site</Link>
      </div>
      <nav className="mb-8 flex gap-1 overflow-x-auto bg-ink-soft p-1.5">
        {ABAS.map(([k, l]) => <button key={k} onClick={() => setAba(k)} className={`shrink-0 px-4 py-2 text-sm font-semibold ${aba === k ? 'bg-stone text-ink' : 'hover:bg-sand'}`}>{l}</button>)}
      </nav>
      {aba === 'dados' && <Dados e={e} salvo={salvo} />}
      {aba === 'midias' && <Midias e={e} salvo={salvo} />}
      {aba === 'conteudo' && (
        <div className="grid gap-6">
          <Repetidor titulo="Itens de lazer" tabela="empreendimento_lazer" empId={e.id} itens={e.empreendimento_lazer as never} salvo={salvo} campos={[{ k: 'titulo', l: 'Título' }, { k: 'descricao', l: 'Descrição' }]} />
          <Repetidor titulo="Ficha técnica" tabela="empreendimento_ficha" empId={e.id} itens={e.empreendimento_ficha as never} salvo={salvo} campos={[{ k: 'titulo', l: 'Item (ex.: TORRES: 1)' }, { k: 'descricao', l: 'Descrição' }]} />
          <Repetidor titulo="Proximidades" tabela="empreendimento_proximidades" empId={e.id} itens={e.empreendimento_proximidades as never} salvo={salvo}
            campos={[{ k: 'nome', l: 'Local' }, { k: 'distancia', l: 'Distância' }, { k: 'tempo_pe', l: 'A pé' }, { k: 'tempo_carro', l: 'Carro' }, { k: 'tempo_transporte', l: 'Transporte' }, { k: 'tempo_bike', l: 'Bike' }]} />
        </div>
      )}
      {aba === 'unidades' && <Unidades e={e} />}
      {aba === 'obra' && <Obra e={e} />}
    </>
  )
}

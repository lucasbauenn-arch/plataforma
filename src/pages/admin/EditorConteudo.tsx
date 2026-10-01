import { useState } from 'react'
import { toast } from 'sonner'
import { Check, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensagemErro } from '@/lib/erros'
import type { EmpreendimentoCompleto, Lazer, Proximidade } from '@/lib/types'
import { ChipsIcone } from '@/components/app/ChipsIcone'
import { IconeCatalogo } from '@/components/app/IconeCatalogo'
import { CATALOGO_LAZER, CATALOGO_PROXIMIDADE, chaveDoRegistro, itemDoCatalogo } from '@/components/app/catalogoIcones'
import { apagarLinha, type AlvoExclusao } from './editorComum'
import { ConfirmarExclusao } from './ConfirmarExclusao'

type Salvo = () => Promise<unknown> | void

const proximaOrdem = (itens: { ordem: number }[]) => itens.reduce((m, i) => Math.max(m, i.ordem + 1), 0)
const textoOuNulo = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Seleção única de ícone (editar item): clicar no ligado desliga (fica sem ícone do catálogo). */
function EscolherIcone({ tipo, valor, aoMudar, rotulo }: { tipo: 'lazer' | 'proximidade'; valor: string | null; aoMudar: (v: string | null) => void; rotulo: string }) {
  return (
    <ChipsIcone itens={tipo === 'lazer' ? CATALOGO_LAZER : CATALOGO_PROXIMIDADE} selecionados={new Set(valor ? [valor] : [])}
      aoAlternar={(k) => aoMudar(k === valor ? null : k)} rotulo={rotulo} />
  )
}

// ============ LAZER ============

/**
 * Itens de lazer por chips do catálogo: clicar liga (cria o item com o rótulo e o ícone) ou desliga (remove; se o item
 * tem descrição ou foto, pede confirmação antes, porque isso se perderia). "Outro" abre o cadastro de item livre.
 * Itens antigos (do WordPress, sem chave) contam como ligados quando o título é igual ao rótulo do catálogo.
 */
export function EditorLazer({ e, salvo }: { e: EmpreendimentoCompleto; salvo: Salvo }) {
  const itens = e.empreendimento_lazer
  const [alvo, setAlvo] = useState<AlvoExclusao | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [outro, setOutro] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const editando = itens.find((i) => i.id === editId) ?? null

  const porChave = new Map<string, Lazer>()
  for (const i of itens) { const k = chaveDoRegistro('lazer', i); if (k && !porChave.has(k)) porChave.set(k, i) }

  const pedirExclusao = (l: Lazer) => setAlvo({
    titulo: `Excluir "${l.titulo}"?`, texto: 'O item sai de "Itens de lazer" e não pode ser recuperado (com a descrição e a foto, se houver).',
    excluir: async () => { await apagarLinha('empreendimento_lazer', l.id); if (editId === l.id) setEditId(null) },
  })

  async function executar(acao: () => Promise<void>) {
    setOcupado(true)
    try { await acao(); await salvo() } catch (erro) { toast.error(mensagemErro(erro)) } finally { setOcupado(false) }
  }

  function alternar(chave: string) {
    const existente = porChave.get(chave)
    const item = itemDoCatalogo('lazer', chave)!
    if (existente) {
      if (existente.descricao || existente.imagem_url) return pedirExclusao(existente)
      return void executar(async () => {
        await apagarLinha('empreendimento_lazer', existente.id)
        if (editId === existente.id) setEditId(null)
        toast.success(`${item.rotulo} removido do lazer`)
      })
    }
    void executar(async () => {
      const { error } = await supabase.from('empreendimento_lazer')
        .insert({ empreendimento_id: e.id, titulo: item.rotulo, icone_catalogo: chave, ordem: proximaOrdem(itens) })
      if (error) throw error
      toast.success(`${item.rotulo} incluído no lazer`)
    })
  }

  async function salvarItem(ev: React.FormEvent<HTMLFormElement>, icone: string | null) {
    ev.preventDefault()
    const form = ev.currentTarget
    const f = new FormData(form)
    const dados = { titulo: textoOuNulo(f.get('titulo')), descricao: textoOuNulo(f.get('descricao')), icone_catalogo: icone }
    if (!dados.titulo) return toast.error('Informe o título do item.')
    await executar(async () => {
      const { error } = editId
        ? await supabase.from('empreendimento_lazer').update(dados).eq('id', editId)
        : await supabase.from('empreendimento_lazer').insert({ ...dados, empreendimento_id: e.id, ordem: proximaOrdem(itens) })
      if (error) throw error
      toast.success(editId ? 'Item salvo' : 'Item incluído no lazer')
      if (editId) setEditId(null); else { form.reset(); setOutro(false) }
    })
  }

  return (
    <section className="card grid gap-5 p-6">
      <div>
        <h3 className="font-semibold">Itens de lazer</h3>
        <p className="mt-1 text-sm text-muted">Clique para incluir ou tirar do empreendimento. Para um item fora da lista, use "Outro".</p>
      </div>
      <ChipsIcone itens={CATALOGO_LAZER} selecionados={new Set(porChave.keys())} aoAlternar={alternar} rotulo="Catálogo de lazer" desabilitado={ocupado}
        outro={{ ligado: outro, aoAlternar: () => { setOutro((o) => !o); setEditId(null) } }} />

      {(outro || editando) && (
        <FormLazer key={editando?.id ?? 'novo'} item={editando} ocupado={ocupado} aoSalvar={salvarItem}
          aoCancelar={() => { setEditId(null); setOutro(false) }} />
      )}

      {itens.length > 0 && (
        <ul className="grid gap-2 text-sm" aria-label="Itens de lazer cadastrados">
          {itens.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 bg-sand/40 px-4 py-2">
              <span className="flex items-start gap-3">
                <IconeCatalogo tipo="lazer" chave={l.icone_catalogo} imagem={l.icone} tamanho={18} className="mt-0.5" padrao={<Check size={16} aria-hidden className="mt-0.5 shrink-0 text-bronze" />} />
                <span><strong>{l.titulo}</strong>{l.descricao ? ` · ${l.descricao}` : ''}</span>
              </span>
              <span className="flex shrink-0 gap-3">
                <button type="button" aria-label={`Editar ${l.titulo}`} className="text-muted hover:text-bronze" onClick={() => { setEditId(l.id); setOutro(false) }}><Pencil size={14} /></button>
                <button type="button" aria-label={`Excluir ${l.titulo}`} className="text-muted hover:text-perigo" onClick={() => pedirExclusao(l)}><Trash2 size={15} /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmarExclusao alvo={alvo} aoFechar={() => setAlvo(null)} depois={() => void salvo()} />
    </section>
  )
}

function FormLazer({ item, ocupado, aoSalvar, aoCancelar }: {
  item: Lazer | null; ocupado: boolean
  aoSalvar: (ev: React.FormEvent<HTMLFormElement>, icone: string | null) => void; aoCancelar: () => void
}) {
  const [icone, setIcone] = useState<string | null>(item?.icone_catalogo ?? null)
  return (
    <form onSubmit={(ev) => aoSalvar(ev, icone)} className="grid gap-3 border border-line p-4" aria-label={item ? `Editar ${item.titulo}` : 'Outro item de lazer'}>
      <p className="flex items-center justify-between text-xs text-bronze">
        {item ? `Editando "${item.titulo}"` : 'Outro item de lazer'}
        <button type="button" className="inline-flex items-center gap-1 text-muted" onClick={aoCancelar}><X size={12} /> cancelar</button>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="titulo" required aria-label="Título" placeholder="Título" defaultValue={item?.titulo ?? ''} className="input !py-2" />
        <input name="descricao" aria-label="Descrição" placeholder="Descrição (opcional)" defaultValue={item?.descricao ?? ''} className="input !py-2" />
      </div>
      <div>
        <p className="label">Ícone (opcional)</p>
        <EscolherIcone tipo="lazer" valor={icone} aoMudar={setIcone} rotulo="Ícone do item" />
      </div>
      <button className="btn-ghost justify-self-start !py-2" disabled={ocupado}>{item ? <><Pencil size={15} /> Salvar</> : <><Plus size={15} /> Adicionar</>}</button>
    </form>
  )
}

// ============ PROXIMIDADES ============

const CAMPOS_TEMPO: [keyof Proximidade, string][] = [['distancia', 'Distância'], ['tempo_pe', 'A pé'], ['tempo_carro', 'Carro'], ['tempo_transporte', 'Transporte'], ['tempo_bike', 'Bike']]

/** Proximidades com categoria escolhida por chips (ícone no site), mais local, distância e tempos. */
export function EditorProximidades({ e, salvo }: { e: EmpreendimentoCompleto; salvo: Salvo }) {
  const itens = e.empreendimento_proximidades
  const [alvo, setAlvo] = useState<AlvoExclusao | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const editando = itens.find((i) => i.id === editId) ?? null

  async function salvar(ev: React.FormEvent<HTMLFormElement>, categoria: string | null) {
    ev.preventDefault()
    const form = ev.currentTarget
    const f = new FormData(form)
    const nome = textoOuNulo(f.get('nome'))
    if (!nome) return toast.error('Informe o local.')
    const dados: Record<string, unknown> = { nome, icone_catalogo: categoria }
    for (const [k] of CAMPOS_TEMPO) dados[k] = textoOuNulo(f.get(k))
    setOcupado(true)
    try {
      const { error } = editId
        ? await supabase.from('empreendimento_proximidades').update(dados).eq('id', editId)
        : await supabase.from('empreendimento_proximidades').insert({ ...dados, empreendimento_id: e.id, ordem: proximaOrdem(itens) })
      if (error) throw error
      toast.success(editId ? 'Proximidade salva' : 'Proximidade incluída')
      if (editId) setEditId(null); else form.reset()
      await salvo()
    } catch (erro) {
      toast.error(mensagemErro(erro))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="card grid gap-5 p-6">
      <h3 className="font-semibold">Proximidades</h3>
      {itens.length > 0 && (
        <ul className="grid gap-2 text-sm" aria-label="Proximidades cadastradas">
          {itens.map((p) => {
            const categoria = itemDoCatalogo('proximidade', p.icone_catalogo)
            return (
              <li key={p.id} className="flex items-start justify-between gap-3 bg-sand/40 px-4 py-2">
                <span className="flex items-start gap-3">
                  <IconeCatalogo tipo="proximidade" chave={p.icone_catalogo} tamanho={18} className="mt-0.5" padrao={<MapPin size={16} aria-hidden className="mt-0.5 shrink-0 text-muted" />} />
                  <span>
                    <strong>{p.nome}</strong>{categoria ? <span className="text-muted"> ({categoria.rotulo})</span> : null}{' '}
                    {CAMPOS_TEMPO.map(([k]) => p[k]).filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="flex shrink-0 gap-3">
                  <button type="button" aria-label={`Editar ${p.nome}`} className="text-muted hover:text-bronze" onClick={() => setEditId(p.id)}><Pencil size={14} /></button>
                  <button type="button" aria-label={`Excluir ${p.nome}`} className="text-muted hover:text-perigo"
                    onClick={() => setAlvo({
                      titulo: `Excluir "${p.nome}"?`, texto: 'O item sai de "Proximidades" e não pode ser recuperado.',
                      excluir: async () => { await apagarLinha('empreendimento_proximidades', p.id); if (editId === p.id) setEditId(null) },
                    })}><Trash2 size={15} /></button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <FormProximidade key={editando?.id ?? 'nova'} item={editando} ocupado={ocupado} aoSalvar={salvar} aoCancelar={() => setEditId(null)} />
      <ConfirmarExclusao alvo={alvo} aoFechar={() => setAlvo(null)} depois={() => void salvo()} />
    </section>
  )
}

function FormProximidade({ item, ocupado, aoSalvar, aoCancelar }: {
  item: Proximidade | null; ocupado: boolean
  aoSalvar: (ev: React.FormEvent<HTMLFormElement>, categoria: string | null) => void; aoCancelar: () => void
}) {
  const [categoria, setCategoria] = useState<string | null>(item?.icone_catalogo ?? null)
  return (
    <form onSubmit={(ev) => aoSalvar(ev, categoria)} className="grid gap-3 border border-line p-4" aria-label={item ? `Editar ${item.nome}` : 'Nova proximidade'}>
      <p className="flex items-center justify-between text-xs text-bronze">
        {item ? `Editando "${item.nome}"` : 'Nova proximidade'}
        {item && <button type="button" className="inline-flex items-center gap-1 text-muted" onClick={aoCancelar}><X size={12} /> cancelar</button>}
      </p>
      <div>
        <p className="label">Categoria</p>
        <EscolherIcone tipo="proximidade" valor={categoria} aoMudar={setCategoria} rotulo="Categoria da proximidade" />
      </div>
      <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
        <input name="nome" required aria-label="Local" placeholder="Local" defaultValue={item?.nome ?? ''} className="input !py-2" />
        {CAMPOS_TEMPO.map(([k, l]) => <input key={k} name={k} aria-label={l} placeholder={l} defaultValue={(item?.[k] as string | null) ?? ''} className="input !py-2" />)}
      </div>
      <button className="btn-ghost justify-self-start !py-2" disabled={ocupado}>{item ? <><Pencil size={15} /> Salvar</> : <><Plus size={15} /> Adicionar</>}</button>
    </form>
  )
}

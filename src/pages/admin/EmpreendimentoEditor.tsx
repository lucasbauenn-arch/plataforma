import { useId, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import clsx from 'clsx'
import { ArrowLeft, Pencil, Trash2, Upload, Plus, X, Wand2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ESTAGIOS, STATUS_UNIDADE } from '@/lib/constants'
import { midiaUrl } from '@/lib/midia'
import { brl } from '@/lib/format'
import { ErroRpc, mensagemErro, traduzirErro } from '@/lib/erros'
import { ErroConsulta } from '@/components/app/Consulta'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import type { EmpreendimentoCompleto, TipoMidia, Unidade, ObraAtualizacao, StatusUnidade } from '@/lib/types'
import { Carregando } from '@/components/Estados'
import { chaveUnidade, lerEspelhoVendas, numeroBR, planejarImportacao, type PlanoImportacao } from '@/lib/espelho'
import { CampoData } from '@/components/app/CampoData'
import { aplicarPlanoDeImportacao, lerCadastroDeUnidades, listaCurta } from './espelhoImportacao'
import { apagarLinha, type AlvoExclusao } from './editorComum'
import { ConfirmarExclusao } from './ConfirmarExclusao'
import { EditorLocalizacao } from './EditorLocalizacao'
import { EditorLazer, EditorProximidades } from './EditorConteudo'
import { faltamParaOTotal, metragemNumerica, nomesParaGerar } from './gerarUnidades'

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

const OUTRA_CONSTRUTORA = '__outra__'

/** Construtoras já usadas nos empreendimentos (sem repetir, em ordem alfabética). */
function useConstrutoras() {
  return useQuery({
    queryKey: ['construtoras'],
    queryFn: async () => {
      const { data, error } = await supabase.from('empreendimentos').select('construtora').not('construtora', 'is', null)
      if (error) throw traduzirErro(error)
      const nomes = (data ?? []).map((r) => ((r as { construtora: string | null }).construtora ?? '').trim()).filter(Boolean)
      return [...new Set(nomes)].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    },
  })
}

/** Construtora: lista das já usadas + "Outra…" (campo de texto). O `name` fica no campo que vale, para o FormData. */
function CampoConstrutora({ inicial }: { inicial: string | null }) {
  const id = useId()
  const q = useConstrutoras()
  const atual = inicial?.trim() ?? ''
  const lista = q.data ? (atual && !q.data.includes(atual) ? [atual, ...q.data] : q.data) : (atual ? [atual] : [])
  const [escolha, setEscolha] = useState(atual)
  const [outra, setOutra] = useState(false)
  const digitar = outra || !!q.error
  return (
    <div className="sm:col-span-2">
      <label className="label" htmlFor={id}>Construtora</label>
      <div className="grid gap-2 sm:grid-cols-2">
        <select id={id} name={digitar ? undefined : 'construtora'} value={digitar ? OUTRA_CONSTRUTORA : escolha} className="input"
          onChange={(ev) => { const v = ev.target.value; if (v === OUTRA_CONSTRUTORA) setOutra(true); else { setOutra(false); setEscolha(v) } }}>
          <option value="">Não informada</option>
          {lista.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value={OUTRA_CONSTRUTORA}>Outra…</option>
        </select>
        {digitar && <input name="construtora" aria-label="Nome da construtora" placeholder="Nome da construtora" autoFocus={outra} defaultValue={q.error ? atual : ''} className="input" />}
      </div>
      {q.error && <p className="mt-1 text-xs text-muted">Não foi possível carregar a lista de construtoras: digite o nome.</p>}
    </div>
  )
}

function Dados({ e, salvo }: { e: EmpreendimentoCompleto; salvo: () => void }) {
  const idEntrega = useId()
  async function salvar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const f = new FormData(ev.currentTarget)
    const txt = (k: string) => ((f.get(k) as string) || '').trim() || null
    const cep = txt('cep')
    if (cep && !/^\d{8}$/.test(cep)) return toast.error('CEP incompleto: informe os 8 dígitos ou deixe o campo vazio.')
    const upd = {
      nome: txt('nome'), slug: txt('slug'), estagio: f.get('estagio'), chamada: txt('chamada'), tagline: txt('tagline'), titulo_hero: txt('titulo_hero'),
      descricao: txt('descricao'), titulo_lazer: txt('titulo_lazer'), descricao_lazer: txt('descricao_lazer'),
      endereco: txt('endereco'), bairro: txt('bairro'), cidade: txt('cidade'), uf: txt('uf'), cep,
      titulo_localizacao: txt('titulo_localizacao'), texto_localizacao: txt('texto_localizacao'), waze_url: txt('waze_url'),
      latitude: txt('latitude') ? Number(txt('latitude')) : null, longitude: txt('longitude') ? Number(txt('longitude')) : null,
      dormitorios: txt('dormitorios'), vagas: txt('vagas'), metragem: txt('metragem'), categoria: txt('categoria'), construtora: txt('construtora'),
      total_unidades: txt('total_unidades') ? Number(txt('total_unidades')) : null, previsao_entrega: txt('previsao_entrega'),
      videos: (txt('videos') ?? '').split('\n').map((s) => s.trim()).filter(Boolean), tour_virtual_url: txt('tour_virtual_url'),
      aceita_fgts: f.get('aceita_fgts') === 'on', destaque_home: f.get('destaque_home') === 'on', publicado: f.get('publicado') === 'on',
      ordem: Number(f.get('ordem') || 0),
    }
    const { error } = await supabase.from('empreendimentos').update(upd).eq('id', e.id)
    if (error) return toast.error(mensagemErro(error))
    toast.success('Salvo'); salvo()
  }
  async function trocarCapa(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]; if (!file) return
    const p = await enviarArquivo(e.id, file); if (!p) return
    const { error } = await supabase.from('empreendimentos').update({ capa_url: p }).eq('id', e.id)
    if (error) return toast.error(mensagemErro(error))
    toast.success('Capa atualizada'); salvo()
  }
  return (
    <form onSubmit={salvar} className="grid gap-8">
      <div className="card flex flex-wrap items-center gap-5 p-5">
        {e.capa_url ? <img src={midiaUrl(e.capa_url)!} className="h-24 w-36 object-cover" alt="" /> : <div className="h-24 w-36 bg-sand" />}
        <label className="btn-ghost cursor-pointer"><Upload size={15} /> Trocar imagem de capa<input type="file" accept="image/*" className="sr-only" onChange={trocarCapa} /></label>
        <div className="ml-auto flex flex-wrap gap-5"><C e={e} n="publicado" l="Publicado" /><C e={e} n="destaque_home" l="Destaque na home" /><C e={e} n="aceita_fgts" l="Aceita FGTS" /></div>
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
        <I e={e} n="categoria" l="Categoria" /><CampoConstrutora inicial={e.construtora} />
        <div><label className="label" htmlFor={idEntrega}>Previsão de entrega</label><CampoData id={idEntrega} name="previsao_entrega" valorInicial={e.previsao_entrega} /></div>
      </fieldset>
      <EditorLocalizacao e={e} />
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
  const [alvo, setAlvo] = useState<AlvoExclusao | null>(null)
  async function upload(ev: React.ChangeEvent<HTMLInputElement>) {
    const input = ev.target
    const files = Array.from(input.files ?? [])
    let ordem = e.empreendimento_midias.filter((m) => m.tipo === tipo).length
    let falhas = 0
    for (const f of files) {
      const p = await enviarArquivo(e.id, f)
      if (!p) { falhas++; continue }
      const { error } = await supabase.from('empreendimento_midias').insert({ empreendimento_id: e.id, tipo, url: p, ordem: ordem++ })
      if (error) { falhas++; toast.error(`${f.name}: ${mensagemErro(error)}`) }
    }
    input.value = ''
    if (files.length > falhas) toast.success(`${files.length - falhas} imagem(ns) enviada(s)${falhas ? `, ${falhas} com falha` : ''}`)
    salvo()
  }
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select aria-label="Tipo da imagem" value={tipo} onChange={(ev) => setTipo(ev.target.value as TipoMidia)} className="input !w-auto">
          <option value="fachada">Fachada</option><option value="area_comum">Área comum</option><option value="planta">Plantas</option><option value="decorado">Decorado</option><option value="obra">Obra</option>
        </select>
        <label className="btn-primary cursor-pointer"><Upload size={15} /> Enviar imagens<input type="file" multiple accept="image/*" className="sr-only" onChange={upload} /></label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {e.empreendimento_midias.map((m, i) => (
          <figure key={m.id} className="relative overflow-hidden bg-sand">
            <img src={midiaUrl(m.url)!} alt="" className="aspect-square w-full object-cover" loading="lazy" />
            <figcaption className="absolute inset-x-0 bottom-0 bg-ink/70 px-2 py-1 text-xs text-stone">{m.tipo}</figcaption>
            {/* sempre visível: no toque e no teclado não existe "passar o mouse" */}
            <button type="button" aria-label={`Remover imagem ${i + 1} (${m.tipo})`}
              onClick={() => setAlvo({ titulo: 'Remover imagem da galeria?', texto: `A imagem ${i + 1} (${m.tipo}) sai da galeria do empreendimento.`, excluir: () => apagarLinha('empreendimento_midias', m.id) })}
              className="absolute right-2 top-2 bg-stone p-1.5 text-ink"><Trash2 size={14} /></button>
          </figure>
        ))}
      </div>
      <ConfirmarExclusao alvo={alvo} aoFechar={() => setAlvo(null)} depois={salvo} />
    </div>
  )
}

type Campo = { k: string; l: string }
function Repetidor({ titulo, tabela, empId, itens, campos, salvo }: { titulo: string; tabela: string; empId: string; itens: Record<string, unknown>[]; campos: Campo[]; salvo: () => void }) {
  const [editId, setEditId] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<AlvoExclusao | null>(null)
  const editando = itens.find((it) => it.id === editId) ?? null

  async function salvarForm(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>
    const row: Record<string, unknown> = {}
    campos.forEach((c) => (row[c.k] = f[c.k] || null))
    const { error } = editId
      ? await supabase.from(tabela).update(row).eq('id', editId)
      : await supabase.from(tabela).insert({ ...row, empreendimento_id: empId, ordem: itens.length })
    if (error) return toast.error(mensagemErro(error))
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
              <button type="button" aria-label={`Editar ${it[campos[0].k]}`} className="text-muted hover:text-bronze" onClick={() => setEditId(it.id as string)}><Pencil size={14} /></button>
              <button type="button" aria-label={`Excluir ${it[campos[0].k]}`} className="text-muted hover:text-perigo"
                onClick={() => setAlvo({
                  titulo: `Excluir "${it[campos[0].k]}"?`, texto: `O item sai de "${titulo}" e não pode ser recuperado.`,
                  excluir: async () => { await apagarLinha(tabela, it.id as string); if (editId === it.id) setEditId(null) },
                })}><Trash2 size={15} /></button>
            </span>
          </li>
        ))}
      </ul>
      {editId && <p className="mb-2 flex items-center justify-between text-xs text-bronze">Editando item <button type="button" className="inline-flex items-center gap-1 text-muted" onClick={() => setEditId(null)}><X size={12} /> cancelar</button></p>}
      <form key={editId ?? 'novo'} onSubmit={salvarForm} className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
        {campos.map((c, i) => <input key={c.k} name={c.k} required={i === 0} aria-label={c.l} defaultValue={editando ? (editando[c.k] as string ?? '') : ''} placeholder={c.l} className="input !py-2" />)}
        <button className="btn-ghost !py-2">{editId ? <><Pencil size={15} /> Salvar</> : <><Plus size={15} /> Adicionar</>}</button>
      </form>
      <ConfirmarExclusao alvo={alvo} aoFechar={() => setAlvo(null)} depois={salvo} />
    </section>
  )
}

/** Cor do status na tabela: reservada = amarelo fraco (aviso), vendida = verde (sage), disponível = neutro. */
const COR_STATUS: Record<StatusUnidade, string> = {
  disponivel: 'border-line bg-ink-soft text-stone',
  reservada: 'border-aviso/50 bg-aviso/15 font-semibold text-aviso',
  vendida: 'border-sage/50 bg-sage/15 font-semibold text-sage',
}
type FiltroStatus = 'todas' | StatusUnidade
const FILTROS: [FiltroStatus, string][] = [['todas', 'Todas'], ['disponivel', 'Disponíveis'], ['reservada', 'Reservadas'], ['vendida', 'Vendidas']]

interface Geracao { nomes: string[]; prefixo: string; inicio: number; metragem: number | null; valor: number | null }

/** Cartão "Gerar N unidades": completa o cadastro até o total de Dados. A gravação (com confirmação) é de quem usa. */
function GerarUnidades({ e, faltam, cadastradas, aoPreparar }: { e: EmpreendimentoCompleto; faltam: number; cadastradas: string[]; aoPreparar: (g: Geracao) => void }) {
  const metragemPadrao = metragemNumerica(e.metragem)
  function preparar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>
    const prefixo = (f.prefixo ?? '').replace(/\s+/g, ' ').trim()
    const inicio = Number(f.inicio || 1)
    if (!Number.isInteger(inicio) || inicio < 0) return toast.error('Número inicial inválido: use um número inteiro (ex.: 1 ou 101).')
    const metragem = numeroBR(f.metragem)
    const valor = numeroBR(f.valor)
    if ((metragem !== null && metragem <= 0) || (valor !== null && valor < 0)) return toast.error('Metragem e valor padrão precisam ser positivos (ou vazios).')
    const nomes = nomesParaGerar(cadastradas, faltam, prefixo, inicio)
    if (!nomes.length) return toast.error('Não há nomes livres para gerar: confira o prefixo e o número inicial.')
    aoPreparar({ nomes, prefixo, inicio, metragem, valor })
  }
  return (
    <form onSubmit={preparar} className="card grid gap-4 border-bronze/40 p-5" aria-label="Gerar unidades">
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><Wand2 size={16} className="text-bronze" aria-hidden /> Gerar {faltam} unidades</h3>
        <p className="mt-1 text-sm text-muted">
          O total previsto em Dados é {e.total_unidades} e há {cadastradas.length} cadastrada(s). As que faltam são criadas como disponíveis;
          nenhuma unidade existente é alterada e nomes que já existem são pulados.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label><span className="label">Prefixo</span><input name="prefixo" defaultValue="APTO" className="input !py-2" /></label>
        <label><span className="label">Número inicial</span><input name="inicio" type="number" min={0} step={1} defaultValue={1} className="input !py-2" /></label>
        <label><span className="label">Metragem padrão (m²)</span><input name="metragem" inputMode="decimal" defaultValue={metragemPadrao !== null ? String(metragemPadrao).replace('.', ',') : ''} className="input !py-2" /></label>
        <label><span className="label">Valor padrão</span><input name="valor" inputMode="decimal" placeholder="R$ 0,00" className="input !py-2" /></label>
      </div>
      <button className="btn-accent justify-self-start !py-2"><Plus size={15} /> Gerar {faltam} unidades</button>
    </form>
  )
}

function Unidades({ e }: { e: EmpreendimentoCompleto }) {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroStatus>('todas')
  const [geracao, setGeracao] = useState<Geracao | null>(null)
  const [alvo, setAlvo] = useState<AlvoExclusao | null>(null)
  const [importacao, setImportacao] = useState<{ plano: PlanoImportacao; arquivo: string } | null>(null)
  const unidadesQ = useQuery({
    queryKey: ['unidades', e.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('unidades').select('*').eq('empreendimento_id', e.id).order('identificador')
      if (error) throw traduzirErro(error)
      return (data ?? []) as Unidade[]
    },
  })
  const unidades = unidadesQ.data ?? []
  const materialQ = useQuery({
    queryKey: ['material', e.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('empreendimento_materiais').select('*').eq('empreendimento_id', e.id).maybeSingle()
      if (error) throw traduzirErro(error)
      return data as { drive_url: string | null } | null
    },
  })
  const mat = materialQ.data
  const recarregar = () => qc.invalidateQueries({ queryKey: ['unidades', e.id] })
  const num = numeroBR

  // Importação do espelho de vendas (FUX-01): compara o arquivo com o cadastro do servidor e mostra o que vai acontecer;
  // NADA é apagado (unidade com contrato, proposta ou negócio do portal continua ligada), só se cria e se atualiza.
  async function escolherArquivo(ev: React.ChangeEvent<HTMLInputElement>) {
    const input = ev.target
    const file = input.files?.[0]
    if (!file) return
    try {
      const linhas = lerEspelhoVendas(await file.text())
      if (!linhas.length) return toast.error('Nenhuma linha válida. Formato: unidade;metragem;valor;status')
      const plano = planejarImportacao(linhas, await lerCadastroDeUnidades(e.id))
      if (plano.repetidasNoArquivo.length) {
        return toast.error(`O arquivo repete estas unidades: ${listaCurta(plano.repetidasNoArquivo)}. Deixe uma linha por unidade e envie de novo.`)
      }
      if (!plano.criar.length && !plano.atualizar.length) {
        return toast.info(`Nada a alterar: as ${plano.semMudanca} unidade(s) do arquivo já estão iguais ao cadastro.`)
      }
      setImportacao({ plano, arquivo: file.name })
    } catch (erro) {
      toast.error(mensagemErro(erro))
    } finally {
      input.value = ''
    }
  }

  // Não lança: o plano gravado pela metade NÃO pode ser repetido (criaria as novas de novo). Quem quiser tentar as
  // que falharam envia o arquivo outra vez, e um plano novo é calculado sobre o cadastro do momento.
  async function aplicarImportacao() {
    if (!importacao) return
    try {
      const r = await aplicarPlanoDeImportacao(e.id, importacao.plano)
      if (r.falhas.length) {
        toast.error(
          `${r.falhas.length} unidade(s) não foram gravadas (${listaCurta(r.falhas.map((f) => f.identificador), 4)}): ${r.falhas[0].motivo} ` +
          `${r.criadas + r.atualizadas} foram gravadas. Envie o arquivo de novo para tentar as que faltam.`,
          { duration: 12_000 },
        )
      } else {
        toast.success(`Importação concluída: ${r.criadas} nova(s), ${r.atualizadas} atualizada(s).`)
      }
    } catch (erro) {
      toast.error(mensagemErro(erro))
    } finally {
      await recarregar()
    }
  }

  async function status(u: Unidade, s: StatusUnidade) {
    const { data, error } = await supabase.from('unidades').update({ status: s }).eq('id', u.id).select('id')
    if (error || !data?.length) toast.error(error ? mensagemErro(error) : 'Não foi possível alterar o status desta unidade.')
    else toast.success(`${u.identificador}: ${STATUS_UNIDADE[s]}`)
    await recarregar()
  }
  const editando = unidades.find((u) => u.id === editId) ?? null
  async function salvarUnidade(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>
    const dados = { identificador: f.id.trim(), metragem: num(f.m), valor: num(f.v) }
    // sem unique no banco: o nome da unidade (a chave da importação do espelho) não pode se repetir no empreendimento
    if (unidades.some((u) => u.id !== editId && chaveUnidade(u.identificador) === chaveUnidade(dados.identificador))) {
      return toast.error(`Já existe a unidade "${dados.identificador}" neste empreendimento.`)
    }
    const { error } = editId
      ? await supabase.from('unidades').update(dados).eq('id', editId)
      : await supabase.from('unidades').insert({ empreendimento_id: e.id, ...dados })
    if (error) return toast.error(mensagemErro(error))
    if (!editId) ev.currentTarget.reset()
    setEditId(null); recarregar()
  }
  async function salvarDrive(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault(); const url = (new FormData(ev.currentTarget).get('drive') as string) || null
    const { error } = await supabase.from('empreendimento_materiais').upsert({ empreendimento_id: e.id, drive_url: url })
    if (error) toast.error(mensagemErro(error)); else toast.success('Link salvo')
  }
  // unidade ligada a contrato não sai (FK): a mensagem diz o que fazer em vez de "dados inválidos"
  async function excluirUnidade(u: Unidade) {
    try {
      await apagarLinha('unidades', u.id)
    } catch (erro) {
      if (traduzirErro(erro).sqlstate === '23503') {
        throw new ErroRpc('DADOS_INVALIDOS', 'Esta unidade está ligada a um contrato e não pode ser excluída. Para tirá-la das ofertas, mude o status para "Vendida".')
      }
      throw erro
    }
    if (editId === u.id) setEditId(null)
  }

  // Gera as que faltam. O cadastro é relido do servidor na hora: se mudou desde a tela (outra pessoa, outra aba), os
  // nomes são recalculados e, se diferirem do que foi confirmado, nada é gravado.
  async function gerar() {
    if (!geracao) return
    try {
      const cadastro = await lerCadastroDeUnidades(e.id)
      const faltamAgora = faltamParaOTotal(e.total_unidades, cadastro.length)
      if (!faltamAgora) return void toast.info('Nada a gerar: o cadastro já tem o total de unidades previsto.')
      const nomes = nomesParaGerar(cadastro.map((u) => u.identificador), Math.min(faltamAgora, geracao.nomes.length), geracao.prefixo, geracao.inicio)
      if (nomes.join('|') !== geracao.nomes.join('|')) {
        return void toast.error('O cadastro de unidades mudou enquanto você confirmava. Nada foi gravado: confira a lista e gere de novo.')
      }
      const r = await aplicarPlanoDeImportacao(e.id, {
        criar: nomes.map((identificador) => ({ identificador, metragem: geracao.metragem, valor: geracao.valor, status: 'disponivel' as const })),
        atualizar: [], semMudanca: 0, repetidasNoArquivo: [], ambiguas: [], foraDoArquivo: 0, statusNaoReconhecido: 0,
      })
      if (r.falhas.length) {
        toast.error(`${r.falhas.length} unidade(s) não foram criadas (${listaCurta(r.falhas.map((f) => f.identificador), 4)}): ${r.falhas[0].motivo} ${r.criadas} foram criadas.`, { duration: 12_000 })
      } else {
        toast.success(`${r.criadas} unidade(s) criada(s).`)
      }
    } finally {
      await recarregar()
    }
  }

  const contagem: Record<StatusUnidade, number> = { disponivel: 0, reservada: 0, vendida: 0 }
  for (const u of unidades) contagem[u.status]++
  const visiveis = filtro === 'todas' ? unidades : unidades.filter((u) => u.status === filtro)
  const faltam = faltamParaOTotal(e.total_unidades, unidades.length)

  const plano = importacao?.plano
  return (
    <div className="grid gap-6">
      {materialQ.error ? <ErroConsulta erro={materialQ.error} tentarDeNovo={materialQ.refetch} /> : (
        <form onSubmit={salvarDrive} className="card flex flex-wrap items-end gap-3 p-5">
          <label className="min-w-64 flex-1"><span className="label">Pasta de materiais para parceiros (Google Drive)</span><input name="drive" key={materialQ.isPending ? 'carregando' : mat?.drive_url ?? ''} defaultValue={mat?.drive_url ?? ''} className="input" /></label>
          <button className="btn-primary" disabled={materialQ.isPending}>Salvar link</button>
        </form>
      )}
      {unidadesQ.isPending ? <Carregando /> : unidadesQ.error ? <ErroConsulta erro={unidadesQ.error} tentarDeNovo={unidadesQ.refetch} /> : (
        <>
          {faltam > 0 && <GerarUnidades e={e} faltam={faltam} cadastradas={unidades.map((u) => u.identificador)} aoPreparar={setGeracao} />}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">{unidades.length} unidades · {contagem.disponivel} disponíveis</h3>
              {!!e.total_unidades && <p className="text-xs text-muted">{unidades.length} de {e.total_unidades} unidades previstas</p>}
            </div>
            <label className="btn-ghost cursor-pointer"><Upload size={15} /> Importar espelho de vendas (CSV)<input type="file" accept=".csv,.txt" className="sr-only" onChange={escolherArquivo} /></label>
          </div>
          <div role="group" aria-label="Filtrar unidades por status" className="flex flex-wrap gap-1 self-start justify-self-start bg-ink-soft p-1">
            {FILTROS.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filtro === k} onClick={() => setFiltro(k)}
                className={clsx('px-3 py-1.5 text-sm font-semibold', filtro === k ? 'bg-stone text-ink' : 'text-stone hover:bg-sand')}>
                {l} ({k === 'todas' ? unidades.length : contagem[k]})
              </button>
            ))}
          </div>
          {editId && <p className="flex items-center justify-between text-xs text-bronze">Editando {editando?.identificador} <button type="button" className="inline-flex items-center gap-1 text-muted" onClick={() => setEditId(null)}><X size={12} /> cancelar</button></p>}
          <form key={editId ?? 'novo'} onSubmit={salvarUnidade} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <input name="id" required aria-label="Unidade" defaultValue={editando?.identificador ?? ''} placeholder="Unidade (APTO 01)" className="input !py-2" />
            <input name="m" aria-label="Metragem" defaultValue={editando?.metragem ?? ''} placeholder="Metragem" className="input !py-2" />
            <input name="v" aria-label="Valor" defaultValue={editando?.valor ?? ''} placeholder="Valor" className="input !py-2" />
            <button className="btn-ghost !py-2">{editId ? <><Pencil size={15} /> Salvar</> : <><Plus size={15} /> Adicionar</>}</button>
          </form>
          <div className="card max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-sand text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">Unidade</th><th>m²</th><th>Valor</th><th>Status</th><th /></tr></thead>
              <tbody>
                {visiveis.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">{unidades.length ? 'Nenhuma unidade com este status.' : 'Nenhuma unidade cadastrada.'}</td></tr>
                )}
                {visiveis.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-4 py-2 font-medium">{u.identificador}</td><td>{u.metragem}</td><td>{brl(u.valor)}</td>
                    <td><select aria-label={`Status de ${u.identificador}`} value={u.status} onChange={(ev) => status(u, ev.target.value as StatusUnidade)} className={clsx('border px-2 py-1 text-xs', COR_STATUS[u.status])}>
                      {Object.entries(STATUS_UNIDADE).map(([k, v]) => <option key={k} value={k} className="bg-ink-soft font-normal text-stone">{v}</option>)}</select></td>
                    <td className="space-x-3 whitespace-nowrap pr-4 text-right">
                      <button type="button" aria-label={`Editar unidade ${u.identificador}`} className="text-muted hover:text-bronze" onClick={() => setEditId(u.id)}><Pencil size={13} /></button>
                      <button type="button" aria-label={`Excluir unidade ${u.identificador}`} className="text-muted hover:text-perigo"
                        onClick={() => setAlvo({
                          titulo: `Excluir a unidade ${u.identificador}?`,
                          texto: 'Propostas e negócios do portal ligados a ela ficam sem unidade. Unidade com contrato não pode ser excluída: nesse caso mude o status para "Vendida".',
                          excluir: () => excluirUnidade(u),
                        })}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ConfirmarExclusao alvo={alvo} aoFechar={() => setAlvo(null)} depois={recarregar} />
      <ConfirmarModal
        aberto={!!geracao} titulo="Gerar unidades" rotuloConfirmar={`Gerar ${geracao?.nomes.length ?? ''} unidades`}
        texto={geracao && (
          <div className="grid gap-3">
            <p>Serão criadas <strong>{geracao.nomes.length}</strong> unidade(s), disponíveis: <strong>{listaCurta(geracao.nomes, 6)}</strong>.</p>
            <p>
              Metragem: {geracao.metragem !== null ? `${String(geracao.metragem).replace('.', ',')} m²` : 'em branco'} · Valor: {geracao.valor !== null ? brl(geracao.valor) : 'em branco'}.
            </p>
            <p><strong>Nenhuma unidade existente é alterada ou apagada.</strong></p>
          </div>
        )}
        aoConfirmar={gerar} aoFechar={() => setGeracao(null)}
      />
      <ConfirmarModal
        aberto={!!importacao} titulo="Importar espelho de vendas" rotuloConfirmar="Importar"
        texto={plano && (
          <div className="grid gap-3">
            <p>
              Arquivo <strong>{importacao?.arquivo}</strong>: <strong>{plano.criar.length}</strong> unidade(s) nova(s),{' '}
              <strong>{plano.atualizar.length}</strong> atualizada(s) e {plano.semMudanca} que já estão iguais.
            </p>
            <p>
              <strong>Nenhuma unidade é apagada.</strong>{' '}
              {plano.foraDoArquivo > 0 ? `As ${plano.foraDoArquivo} unidade(s) que não estão no arquivo continuam como estão. ` : ''}
              Contratos, propostas e negócios do portal continuam ligados às unidades. Células vazias e status desconhecidos no arquivo não alteram o dado atual.
            </p>
            {plano.atualizar.some((a) => a.campos.valor !== undefined) && (
              <p>Contrato em andamento cuja unidade mudar de valor precisará ter o PDF gerado de novo antes do envio para assinatura.</p>
            )}
            {plano.ambiguas.length > 0 && (
              <p>Não serão alteradas, por haver mais de uma unidade com o mesmo nome no cadastro: {listaCurta(plano.ambiguas)}. Ajuste à mão.</p>
            )}
            {plano.statusNaoReconhecido > 0 && <p>{plano.statusNaoReconhecido} linha(s) com status desconhecido mantiveram o status atual.</p>}
          </div>
        )}
        aoConfirmar={aplicarImportacao} aoFechar={() => setImportacao(null)}
      />
    </div>
  )
}

function Obra({ e }: { e: EmpreendimentoCompleto }) {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<AlvoExclusao | null>(null)
  const [fotosRestantes, setFotosRestantes] = useState<string[]>([])
  const listaQ = useQuery({
    queryKey: ['obra', e.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('obra_atualizacoes').select('*').eq('empreendimento_id', e.id).order('data', { ascending: false })
      if (error) throw traduzirErro(error)
      return (data ?? []) as ObraAtualizacao[]
    },
  })
  const lista = listaQ.data ?? []
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
    if (error) return toast.error(mensagemErro(error))
    if (!editId) form.reset()
    toast.success(editId ? 'Atualização salva' : 'Atualização publicada'); cancelar(); recarregar()
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <form key={editId ?? 'nova'} onSubmit={salvar} className="card grid content-start gap-3 p-5">
        <div className="flex items-center justify-between"><h3 className="font-semibold">{editId ? 'Editar atualização' : 'Nova atualização'}</h3>
          {editId && <button type="button" onClick={cancelar} className="inline-flex items-center gap-1 text-xs text-muted"><X size={12} /> cancelar</button>}
        </div>
        <input name="titulo" required aria-label="Título" defaultValue={editando?.titulo ?? ''} placeholder="Título (ex.: Concretagem da 5ª laje)" className="input" />
        <textarea name="descricao" rows={3} aria-label="Descrição" defaultValue={editando?.descricao ?? ''} placeholder="Descrição" className="input" />
        <div className="grid grid-cols-2 gap-2">
          <input name="pct" type="number" min={0} max={100} aria-label="Percentual concluído" defaultValue={editando?.percentual ?? ''} placeholder="% concluído" className="input" />
          <CampoData name="data" valorInicial={editando?.data ?? ''} rotulo="Data" />
        </div>
        {editId && fotosRestantes.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {fotosRestantes.map((p, i) => (
              <div key={p} className="relative">
                <img src={midiaUrl(p)!} alt="" className="aspect-square w-full object-cover" />
                <button type="button" onClick={() => setFotosRestantes((fs) => fs.filter((x) => x !== p))}
                  className="absolute right-0.5 top-0.5 bg-stone p-0.5 text-ink" aria-label={`Remover foto ${i + 1}`}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <label className="text-sm"><span className="label">{editId ? 'Adicionar mais fotos' : 'Fotos'}</span><input name="fotos" type="file" multiple accept="image/*" className="text-sm" /></label>
        <button className="btn-primary">{editId ? 'Salvar alterações' : 'Publicar'}</button>
      </form>
      {listaQ.isPending ? <Carregando /> : listaQ.error ? <ErroConsulta erro={listaQ.error} tentarDeNovo={listaQ.refetch} /> : (
        <ul className="grid content-start gap-3">
          {lista.map((o) => (
            <li key={o.id} className="card flex justify-between gap-4 p-4 text-sm">
              <div><p className="font-semibold">{o.titulo} {o.percentual != null && <span className="text-bronze">· {o.percentual}%</span>}</p><p className="text-xs text-muted">{new Date(o.data).toLocaleDateString('pt-BR')} · {o.fotos.length} fotos</p></div>
              <span className="flex shrink-0 gap-3">
                <button type="button" aria-label={`Editar atualização ${o.titulo}`} className="text-muted hover:text-bronze" onClick={() => editar(o)}><Pencil size={15} /></button>
                <button type="button" aria-label={`Excluir atualização ${o.titulo}`} className="text-muted hover:text-perigo"
                  onClick={() => setAlvo({
                    titulo: `Excluir a atualização "${o.titulo}"?`, texto: 'Ela deixa de aparecer no andamento da obra do portal do cliente.',
                    excluir: async () => { await apagarLinha('obra_atualizacoes', o.id); if (editId === o.id) cancelar() },
                  })}><Trash2 size={15} /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmarExclusao alvo={alvo} aoFechar={() => setAlvo(null)} depois={recarregar} />
    </div>
  )
}

export default function EmpreendimentoEditor() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [aba, setAba] = useState<Aba>('dados')
  const { data: e, isLoading, error: erro, refetch } = useQuery({
    queryKey: ['admin-emp', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('empreendimentos')
        .select('*, empreendimento_midias(*), empreendimento_lazer(*), empreendimento_proximidades(*), empreendimento_ficha(*)').eq('id', id!).single()
      if (error) throw traduzirErro(error)
      const x = data as EmpreendimentoCompleto
      const o = (a: { ordem: number }, b: { ordem: number }) => a.ordem - b.ordem
      x.empreendimento_midias.sort(o); x.empreendimento_lazer.sort(o); x.empreendimento_proximidades.sort(o); x.empreendimento_ficha.sort(o)
      return x
    },
  })
  // devolve a promessa: quem precisa da tela já atualizada (chips do lazer) espera o recarregamento
  const salvo = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['admin-emp', id] }), qc.invalidateQueries({ queryKey: ['empreendimentos'] }),
    qc.invalidateQueries({ queryKey: ['construtoras'] }),
  ])
  if (erro) return <ErroConsulta erro={erro} tentarDeNovo={refetch} />
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
          <EditorLazer e={e} salvo={salvo} />
          <Repetidor titulo="Ficha técnica" tabela="empreendimento_ficha" empId={e.id} itens={e.empreendimento_ficha as never} salvo={salvo} campos={[{ k: 'titulo', l: 'Item (ex.: TORRES: 1)' }, { k: 'descricao', l: 'Descrição' }]} />
          <EditorProximidades e={e} salvo={salvo} />
        </div>
      )}
      {aba === 'unidades' && <Unidades e={e} />}
      {aba === 'obra' && <Obra e={e} />}
    </>
  )
}

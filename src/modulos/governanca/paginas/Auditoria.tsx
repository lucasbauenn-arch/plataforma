import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Eye, Filter, ShieldCheck } from 'lucide-react'
import { auditoriaConsultar } from '@/lib/rpc'
import { dataHora } from '@/lib/format'
import { CATEGORIAS_AUDITORIA, PAPEIS } from '@/lib/constants'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ErroConsulta } from '@/components/app/Consulta'
import { Tabela } from '@/components/app/Tabela'
import { Paginacao } from '@/components/app/Paginacao'
import { Gaveta } from '@/components/app/Modal'
import { Etiqueta, type Tom } from '@/components/app/Etiqueta'
import { Campo } from '@/components/Campo'
import { Carregando } from '@/components/Estados'
import type { CategoriaAuditoria } from '@/lib/types'
import type { AuditoriaFiltros, AuditoriaItem } from '../tipos'
import { CampoData } from '@/components/app/CampoData'
import {
  ACOES_AUDITORIA, alteracoes, FILTROS_VAZIOS, type FormFiltros, formatarValor, LIMITE_AUDITORIA, montarFiltros, rotuloAcao,
  rotuloCategoria, rotuloOrigem,
} from '../auditoria'

const TOM_CATEGORIA: Record<CategoriaAuditoria, Tom> = {
  acesso: 'neutro', operacao: 'neutro', configuracao: 'alerta', seguranca: 'alerta', integracao: 'neutro', lgpd: 'destaque',
}

/**
 * Consulta da auditoria (internos, N20): `auditoria_consultar`, que registra a própria leitura. O log nunca guarda
 * valor pessoal: só nomes de campos, códigos, ids e contagens.
 */
export default function Auditoria() {
  const [form, setForm] = useState<FormFiltros>(FILTROS_VAZIOS)
  const [filtros, setFiltros] = useState<AuditoriaFiltros>({})
  const [erroFiltro, setErroFiltro] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [aberto, setAberto] = useState<AuditoriaItem | null>(null)

  const q = useQuery({
    queryKey: ['auditoria', filtros, offset],
    queryFn: () => auditoriaConsultar({ p_filtros: filtros, p_limite: LIMITE_AUDITORIA, p_offset: offset }),
    placeholderData: keepPreviousData,
    // cada consulta fica registrada: nada de recarregar sozinho
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  const mudar = (campo: keyof FormFiltros) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [campo]: e.target.value }))

  function aplicar(ev: React.FormEvent) {
    ev.preventDefault()
    const r = montarFiltros(form)
    if (!r.ok) return setErroFiltro(r.erro)
    setErroFiltro(null)
    setOffset(0)
    setFiltros(r.filtros)
  }

  function limpar() {
    setForm(FILTROS_VAZIOS)
    setErroFiltro(null)
    setOffset(0)
    setFiltros({})
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Auditoria"
        subtitulo="Registro imutável de acessos, operações, configurações e LGPD. Sua consulta também fica registrada."
      />

      <form onSubmit={aplicar} className="card mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filtros da auditoria">
        <Campo label="Categoria">
          <select className="input" value={form.categoria} onChange={mudar('categoria')}>
            <option value="">Todas</option>
            {(Object.keys(CATEGORIAS_AUDITORIA) as CategoriaAuditoria[]).map((c) => <option key={c} value={c}>{CATEGORIAS_AUDITORIA[c]}</option>)}
          </select>
        </Campo>
        <Campo label="Ação">
          <select className="input" value={form.acao} onChange={mudar('acao')}>
            <option value="">Todas</option>
            {ACOES_AUDITORIA.map((a) => <option key={a} value={a}>{rotuloAcao(a)}</option>)}
          </select>
        </Campo>
        <Campo label="Entidade (tabela)">
          <input className="input" value={form.entidade} onChange={mudar('entidade')} placeholder="ex.: clientes" />
        </Campo>
        <Campo label="ID do registro">
          <input className="input" value={form.entidade_id} onChange={mudar('entidade_id')} />
        </Campo>
        <Campo label="ID do cliente (titular)">
          <input className="input" value={form.cliente_id} onChange={mudar('cliente_id')} placeholder="uuid" />
        </Campo>
        <Campo label="ID de quem agiu">
          <input className="input" value={form.ator_id} onChange={mudar('ator_id')} placeholder="uuid" />
        </Campo>
        <Campo label="De">
          <CampoData valor={form.de} max={form.ate || null} aoMudar={(v) => setForm((f) => ({ ...f, de: v }))} rotulo="De" />
        </Campo>
        <Campo label="Até">
          <CampoData valor={form.ate} min={form.de || null} aoMudar={(v) => setForm((f) => ({ ...f, ate: v }))} rotulo="Até" />
        </Campo>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="btn-primary"><Filter size={16} aria-hidden /> Filtrar</button>
          <button type="button" className="btn-ghost" onClick={limpar}>Limpar</button>
          {erroFiltro && <span role="alert" className="text-sm text-perigo">{erroFiltro}</span>}
        </div>
      </form>

      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : !q.data ? (
        <ErroConsulta erro={{ code: '42501', message: 'Sem acesso a este registro' }} />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{q.data.total.toLocaleString('pt-BR')} registro(s)</p>
          <Tabela
            legenda="Registros de auditoria"
            colunas={['Quando', 'Categoria', 'Ação', 'Entidade', 'Quem', 'Origem', { rotulo: '', direita: true }]}
            vazio="Nenhum registro com esses filtros."
          >
            {q.data.itens.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{dataHora(a.ocorrido_em)}</td>
                <td><Etiqueta tom={TOM_CATEGORIA[a.categoria]}>{rotuloCategoria(a.categoria)}</Etiqueta></td>
                <td>{rotuloAcao(a.acao)}</td>
                <td className="max-w-56 truncate" title={a.entidade_id ?? undefined}>{a.entidade}</td>
                <td>
                  {a.ator_nome ?? (a.ator_id ? 'Usuário removido' : 'Sistema')}
                  {a.ator_papel && <span className="block text-xs text-muted">{PAPEIS[a.ator_papel]}</span>}
                </td>
                <td className="text-muted">{rotuloOrigem(a.origem)}</td>
                <td className="text-right">
                  <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-bronze" onClick={() => setAberto(a)}>
                    <Eye size={15} aria-hidden /> Detalhes
                  </button>
                </td>
              </tr>
            ))}
          </Tabela>
          <Paginacao total={q.data.total} limite={LIMITE_AUDITORIA} offset={offset} aoMudar={setOffset} />
        </>
      )}

      <Gaveta aberto={!!aberto} titulo="Registro de auditoria" aoFechar={() => setAberto(null)}>
        {aberto && <DetalheRegistro a={aberto} />}
      </Gaveta>
    </>
  )
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 border-b border-line py-2 text-sm">
      <dt className="text-muted">{rotulo}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function DetalheRegistro({ a }: { a: AuditoriaItem }) {
  const mudancas = alteracoes(a)
  const detalhe = Object.entries(a.detalhe ?? {})
  return (
    <div className="grid gap-6">
      <dl>
        <Linha rotulo="Quando">{dataHora(a.ocorrido_em)}</Linha>
        <Linha rotulo="Categoria">{rotuloCategoria(a.categoria)}</Linha>
        <Linha rotulo="Ação">{rotuloAcao(a.acao)} <span className="text-muted">({a.acao})</span></Linha>
        <Linha rotulo="Entidade">{a.entidade}{a.entidade_id && <span className="block font-mono text-xs text-muted">{a.entidade_id}</span>}</Linha>
        <Linha rotulo="Cliente (titular)">{a.cliente_id ? <span className="font-mono text-xs">{a.cliente_id}</span> : '—'}</Linha>
        <Linha rotulo="Quem">
          {a.ator_nome ?? (a.ator_id ? 'Usuário removido' : 'Sistema')}
          {a.ator_papel && <span className="text-muted"> · {PAPEIS[a.ator_papel]}</span>}
          {a.ator_id && <span className="block font-mono text-xs text-muted">{a.ator_id}</span>}
        </Linha>
        <Linha rotulo="Origem">{rotuloOrigem(a.origem)}</Linha>
        <Linha rotulo="IP">{a.ip ?? '—'}</Linha>
        <Linha rotulo="Navegador">{a.user_agent ?? '—'}</Linha>
      </dl>

      {mudancas.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">Campos</h3>
          <ul className="grid gap-1 text-sm">
            {mudancas.map((m) => (
              <li key={m.campo} className="border border-line px-3 py-2">
                <span className="font-mono text-xs">{m.campo}</span>
                {(m.antes !== null || m.depois !== null) && (
                  <span className="block text-muted">{m.antes ?? '—'} → <span className="text-stone">{m.depois ?? '—'}</span></span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck size={13} aria-hidden /> Valores pessoais nunca são gravados: só os nomes dos campos.
          </p>
        </section>
      )}

      {detalhe.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">Detalhe</h3>
          <dl>
            {detalhe.map(([k, v]) => <Linha key={k} rotulo={k}>{formatarValor(v)}</Linha>)}
          </dl>
        </section>
      )}
    </div>
  )
}

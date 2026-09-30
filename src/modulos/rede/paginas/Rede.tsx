import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Building2, Mail, Plus, UserCheck } from 'lucide-react'
import { useEscopo } from '@/lib/escopo'
import { mascaraCnpj } from '@/lib/format'
import { TIPOS_PARCEIRO } from '@/lib/constants'
import type { TipoParceiro, Uuid } from '@/lib/types'
import { Abas, type Aba } from '@/components/app/Abas'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { Consulta } from '@/components/app/Consulta'
import { Etiqueta } from '@/components/app/Etiqueta'
import { BarraFiltros, CampoBusca, FiltroSelecao } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { Tabela } from '@/components/app/Tabela'
import {
  chavesRede, listarImobiliarias, listarParceiros, listarPendentes, POR_PAGINA, type FiltrosParceiros, type SituacaoFiltro,
} from '../api'
import { tiposCadastraveis } from '../regras'
import { FormImobiliaria } from '../componentes/FormImobiliaria'
import { FormParceiro } from '../componentes/FormParceiro'
import { ModalConvite } from '../componentes/ModalConvite'
import { TabelaParceiros } from '../componentes/TabelaParceiros'

type AbaRede = 'parceiros' | 'imobiliarias'
const ABAS: Aba<AbaRede>[] = [
  { id: 'parceiros', rotulo: 'Parceiros' },
  { id: 'imobiliarias', rotulo: 'Imobiliárias' },
]
const SITUACOES = [
  { valor: 'ativos', rotulo: 'Ativos' },
  { valor: 'inativos', rotulo: 'Inativos' },
  { valor: 'todos', rotulo: 'Todos' },
]
const ehSituacao = (v: string | null): v is SituacaoFiltro => v === 'ativos' || v === 'inativos' || v === 'todos'
const ehTipo = (v: string | null): v is TipoParceiro => v === 'imobiliaria' || v === 'gerente' || v === 'corretor'

/**
 * [WP1] Admin › Rede (§7.2): imobiliárias, gerentes, corretores e usuários de imobiliária, com cadastro, convite em lote
 * (Edge convidar-parceiros) e acesso ao detalhe (transferências, bloqueio e inativação). Substitui a antiga
 * /admin/parceiros. Lê pela RLS (sem CPF); o CPF só sai no detalhe, auditado.
 */
export default function Rede() {
  const { escopo, tem } = useEscopo()
  const [params, setParams] = useSearchParams()
  const aba: AbaRede = params.get('aba') === 'imobiliarias' ? 'imobiliarias' : 'parceiros'
  const [novoParceiro, setNovoParceiro] = useState(false)
  const [novaImob, setNovaImob] = useState(false)
  const [selecao, setSelecao] = useState<Set<Uuid>>(new Set())
  const [convidar, setConvidar] = useState(false)

  const filtros: FiltrosParceiros = {
    busca: params.get('busca') ?? '',
    tipo: ehTipo(params.get('tipo')) ? (params.get('tipo') as TipoParceiro) : '',
    imobiliariaId: params.get('imobiliaria'),
    gerenteId: null,
    situacao: ehSituacao(params.get('situacao')) ? (params.get('situacao') as SituacaoFiltro) : 'ativos',
    offset: Math.max(0, Number(params.get('offset')) || 0),
    virtuais: params.get('virtuais') === '1',
  }
  const buscaImob = params.get('busca_imob') ?? ''
  const situacaoImob: SituacaoFiltro = ehSituacao(params.get('situacao_imob')) ? (params.get('situacao_imob') as SituacaoFiltro) : 'ativos'

  const parceiros = useQuery({
    queryKey: chavesRede.parceiros(filtros),
    queryFn: () => listarParceiros(filtros),
    enabled: aba === 'parceiros',
    placeholderData: keepPreviousData,
  })
  const imobiliarias = useQuery({
    queryKey: chavesRede.imobiliarias({ busca: aba === 'imobiliarias' ? buscaImob : '', situacao: aba === 'imobiliarias' ? situacaoImob : 'todos' }),
    queryFn: () => listarImobiliarias({ busca: aba === 'imobiliarias' ? buscaImob : '', situacao: aba === 'imobiliarias' ? situacaoImob : 'todos' }),
  })
  const pendentes = useQuery({ queryKey: chavesRede.pendentes, queryFn: listarPendentes, enabled: tem('rede.aprovar') })

  function mudar(mudancas: Record<string, string | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v == null || v === '' || v === '0') p.delete(k)
      else p.set(k, v)
    }
    if (!('offset' in mudancas)) p.delete('offset')
    setParams(p, { replace: true })
    setSelecao(new Set())
  }

  const selecionados = (parceiros.data?.itens ?? []).filter((p) => selecao.has(p.id))
  const qtdPendentes = pendentes.data?.length ?? 0

  return (
    <section>
      <CabecalhoPagina
        titulo="Rede"
        subtitulo="Imobiliárias, gerentes e corretores. Cada parceiro enxerga só a própria cadeia; a equipe Arken vê tudo."
        acoes={
          <>
            {tem('rede.aprovar') && (
              <Link to="/admin/rede/pendentes" className="btn-ghost">
                <UserCheck size={16} aria-hidden /> Autocadastros{qtdPendentes > 0 ? ` (${qtdPendentes})` : ''}
              </Link>
            )}
            {aba === 'imobiliarias'
              ? <button type="button" className="btn-primary" onClick={() => setNovaImob(true)}><Building2 size={16} aria-hidden /> Nova imobiliária</button>
              : <button type="button" className="btn-primary" onClick={() => setNovoParceiro(true)}><Plus size={16} aria-hidden /> Novo parceiro</button>}
          </>
        }
      />

      <div className="mb-6">
        <Abas abas={ABAS} ativa={aba} aoMudar={(a) => mudar({ aba: a === 'parceiros' ? null : a })} rotulo="Seções da rede" />
      </div>

      {aba === 'parceiros' ? (
        <>
          <BarraFiltros
            acoes={selecao.size > 0 && (
              <button type="button" className="btn-accent" onClick={() => setConvidar(true)}>
                <Mail size={16} aria-hidden /> Convidar ({selecao.size})
              </button>
            )}
          >
            <CampoBusca valor={filtros.busca} aoMudar={(v) => mudar({ busca: v.trim() || null })} placeholder="Nome, e-mail ou CRECI" rotulo="Buscar parceiro" />
            <FiltroSelecao rotulo="Tipo" valor={filtros.tipo} aoMudar={(v) => mudar({ tipo: v || null })}
              opcoes={(Object.keys(TIPOS_PARCEIRO) as TipoParceiro[]).map((t) => ({ valor: t, rotulo: TIPOS_PARCEIRO[t] }))} />
            <FiltroSelecao rotulo="Imobiliária" valor={filtros.imobiliariaId ?? ''} aoMudar={(v) => mudar({ imobiliaria: v || null })}
              opcoes={(imobiliarias.data ?? []).map((i) => ({ valor: i.id, rotulo: i.da_casa ? `${i.nome} (casa)` : i.nome }))} todos="Todas" />
            <FiltroSelecao rotulo="Situação" valor={filtros.situacao} aoMudar={(v) => mudar({ situacao: v === 'ativos' ? null : v })} opcoes={SITUACOES} todos={null} />
            <label className="flex items-center gap-2 py-3 text-sm text-stone/85">
              <input type="checkbox" className="accent-bronze" checked={!!filtros.virtuais} onChange={(e) => mudar({ virtuais: e.target.checked ? '1' : null })} />
              Mostrar a cadeia virtual da casa <SeloProvisorio codigo="A4" />
            </label>
          </BarraFiltros>
          <Consulta consulta={parceiros} vazio={() => false}>
            {(d) => (
              <>
                <TabelaParceiros itens={d.itens} rotaDetalhe={(id) => `/admin/rede/parceiros/${id}`} selecao={selecao} aoSelecionar={setSelecao}
                  vazio={filtros.busca ? 'Nenhum parceiro com essa busca.' : 'Nenhum parceiro aqui ainda.'} />
                <Paginacao total={d.total} limite={POR_PAGINA} offset={filtros.offset} aoMudar={(o) => mudar({ offset: String(o) })} />
              </>
            )}
          </Consulta>
        </>
      ) : (
        <>
          <BarraFiltros>
            <CampoBusca valor={buscaImob} aoMudar={(v) => mudar({ busca_imob: v.trim() || null })} placeholder="Nome, razão social ou cidade" rotulo="Buscar imobiliária" />
            <FiltroSelecao rotulo="Situação" valor={situacaoImob} aoMudar={(v) => mudar({ situacao_imob: v === 'ativos' ? null : v })} opcoes={SITUACOES} todos={null} />
          </BarraFiltros>
          <Consulta consulta={imobiliarias} vazio={() => false}>
            {(lista) => (
              <Tabela legenda="Imobiliárias" colunas={['Imobiliária', 'CNPJ', 'CRECI PJ', 'Cidade', 'Situação']} vazio="Nenhuma imobiliária encontrada.">
                {lista.map((i) => (
                  <tr key={i.id} className={i.inativado_em ? 'text-muted' : 'hover:bg-sand/40'}>
                    <td>
                      <Link to={`/admin/rede/imobiliarias/${i.id}`} className="font-semibold hover:text-bronze">{i.nome}</Link>
                      {i.da_casa && <span className="ml-2"><Etiqueta tom="destaque">casa</Etiqueta></span>}
                    </td>
                    <td className="whitespace-nowrap">{i.cnpj ? mascaraCnpj(i.cnpj) : '—'}</td>
                    <td>{i.creci_pj ?? '—'}</td>
                    <td>{i.cidade ? `${i.cidade}${i.uf ? ` / ${i.uf}` : ''}` : '—'}</td>
                    <td>{i.inativado_em ? <Etiqueta>Inativa</Etiqueta> : <Etiqueta tom="ok">Ativa</Etiqueta>}</td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Consulta>
        </>
      )}

      <FormParceiro
        aberto={novoParceiro} aoFechar={() => setNovoParceiro(false)}
        modo={{ tipo: 'novo', tipos: tiposCadastraveis(escopo), imobiliariaId: filtros.imobiliariaId, interno: !!escopo?.interno }}
      />
      <FormImobiliaria aberto={novaImob} aoFechar={() => setNovaImob(false)} />
      <ModalConvite
        aberto={convidar} aoFechar={() => { setConvidar(false); setSelecao(new Set()) }} podeLink={tem('rede.convite_por_link')}
        convidados={selecionados.map((p) => ({ id: p.id, nome: p.nome, telefone: p.telefone }))}
      />
    </section>
  )
}

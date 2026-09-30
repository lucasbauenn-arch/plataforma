import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { crmListar } from '@/lib/rpc'
import { useEscopo } from '@/lib/escopo'
import { ETAPAS, ORDEM_ETAPAS, ORIGENS_CLIENTE } from '@/lib/constants'
import { data, mascaraTelefone, whatsappBR, waLink } from '@/lib/format'
import type { EtapaFunil, OrigemCliente } from '@/lib/types'
import { Carregando } from '@/components/Estados'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ErroConsulta } from '@/components/app/Consulta'
import { Etiqueta, SeloStatus } from '@/components/app/Etiqueta'
import { BarraFiltros, CampoBusca, FiltroSelecao } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { Tabela } from '@/components/app/Tabela'
import { useBase } from '@/components/app/useBase'
import { chavesCrm, nomeCompleto } from '../api-clientes'
import type { CrmFiltros } from '../tipos'

const LIMITE = 50

/**
 * Lista do CRM (crm_listar): escopo decidido pelo servidor (o corretor vê os seus; o gerente, a equipe; a
 * imobiliária, a imobiliária; internos, tudo). Sem CPF na lista (minimização); a busca não vai para a auditoria.
 * Internos têm também inativos e o filtro do portal.
 */
export default function Lista() {
  const { escopo, tem } = useEscopo()
  const base = useBase()
  const interno = !!escopo?.interno
  const gestor = interno || escopo?.tipo === 'gerente' || escopo?.tipo === 'imobiliaria'
  const [busca, setBusca] = useState('')
  const [etapa, setEtapa] = useState('')
  const [origem, setOrigem] = useState('')
  const [soMeus, setSoMeus] = useState(false)
  const [inativos, setInativos] = useState(false)
  const [portal, setPortal] = useState('')
  const [ordem, setOrdem] = useState<NonNullable<CrmFiltros['ordem']>>('recentes')
  const [offset, setOffset] = useState(0)

  const filtros: CrmFiltros = {
    busca: busca || null,
    etapas: etapa ? [etapa as EtapaFunil] : null,
    origem: (origem || null) as OrigemCliente | null,
    so_meus: soMeus,
    incluir_inativos: interno && inativos,
    portal_liberado: interno && portal ? portal === 'sim' : null,
    ordem,
  }
  const q = useQuery({
    queryKey: chavesCrm.lista(filtros, LIMITE, offset),
    queryFn: () => crmListar({ p_filtros: filtros, p_limite: LIMITE, p_offset: offset }),
    placeholderData: keepPreviousData,
  })
  const mudar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOffset(0) }

  const colunas = [
    'Cliente', 'Contato', 'Etapa', ...(gestor ? ['Corretor'] : []), 'Pendências', ...(interno ? ['Portal'] : []), 'Cadastro',
  ]

  return (
    <>
      <CabecalhoPagina
        eyebrow="CRM" titulo="Clientes"
        subtitulo="Clientes da sua carteira e da sua equipe. O CPF aparece só na ficha."
        acoes={tem('crm.cadastrar') && <Link to={`${base}/crm/novo`} className="btn-primary"><Plus size={16} aria-hidden /> Novo cliente</Link>}
      />
      <BarraFiltros>
        <CampoBusca valor={busca} aoMudar={mudar(setBusca)} placeholder="Nome, e-mail ou telefone" />
        <FiltroSelecao rotulo="Etapa" valor={etapa} aoMudar={mudar(setEtapa)} opcoes={ORDEM_ETAPAS.map((e) => ({ valor: e, rotulo: ETAPAS[e].rotulo }))} todos="Todas" />
        <FiltroSelecao
          rotulo="Origem" valor={origem} aoMudar={mudar(setOrigem)}
          opcoes={(Object.keys(ORIGENS_CLIENTE) as OrigemCliente[]).map((o) => ({ valor: o, rotulo: ORIGENS_CLIENTE[o] }))}
        />
        <FiltroSelecao
          rotulo="Ordem" valor={ordem} todos={null} aoMudar={mudar((v: string) => setOrdem(v as typeof ordem))}
          opcoes={[{ valor: 'recentes', rotulo: 'Mais recentes' }, { valor: 'nome', rotulo: 'Nome' }, { valor: 'etapa_desde', rotulo: 'Há mais tempo na etapa' }]}
        />
        {interno && (
          <FiltroSelecao rotulo="Portal" valor={portal} aoMudar={mudar(setPortal)}
            opcoes={[{ valor: 'sim', rotulo: 'Liberado' }, { valor: 'nao', rotulo: 'Fechado' }]} />
        )}
        {escopo?.tipo === 'gerente' && (
          <label className="flex items-center gap-2 pb-3 text-sm">
            <input type="checkbox" className="size-4 accent-bronze" checked={soMeus} onChange={(e) => mudar(setSoMeus)(e.target.checked)} />
            Só os meus
          </label>
        )}
        {interno && (
          <label className="flex items-center gap-2 pb-3 text-sm">
            <input type="checkbox" className="size-4 accent-bronze" checked={inativos} onChange={(e) => mudar(setInativos)(e.target.checked)} />
            Incluir inativos
          </label>
        )}
      </BarraFiltros>

      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : (
        <>
          <Tabela colunas={colunas} legenda="Clientes" vazio="Nenhum cliente encontrado.">
            {q.data.itens.map((c) => {
              const wa = whatsappBR(c.telefone)
              return (
                <tr key={c.id}>
                  <td>
                    <Link to={`${base}/crm/${c.id}`} className="font-semibold hover:text-bronze">{nomeCompleto(c.nome, c.sobrenome)}</Link>
                    {c.inativado_em && <span className="ml-2"><Etiqueta tom="neutro">Inativo</Etiqueta></span>}
                    <span className="block text-xs text-muted">{ORIGENS_CLIENTE[c.origem]}</span>
                  </td>
                  <td>
                    {c.telefone ? (
                      wa ? <a href={waLink(wa, `Olá, ${c.nome}!`)} target="_blank" rel="noreferrer" className="text-bronze">{mascaraTelefone(c.telefone)}</a>
                        : mascaraTelefone(c.telefone)
                    ) : <span className="text-muted">—</span>}
                    {c.email && <span className="block text-xs text-muted">{c.email}</span>}
                  </td>
                  <td><SeloStatus tipo="etapa" valor={c.etapa} /></td>
                  {gestor && <td>{c.corretor?.nome ?? <span className="text-muted">—</span>}</td>}
                  <td className="text-xs">
                    {c.documentos_pendentes > 0 && <span className="block">{c.documentos_pendentes} documento(s)</span>}
                    {c.tarefas_atrasadas > 0 && <span className="block text-perigo">{c.tarefas_atrasadas} tarefa(s) atrasada(s)</span>}
                    {!c.documentos_pendentes && !c.tarefas_atrasadas && <span className="text-muted">—</span>}
                  </td>
                  {interno && <td>{c.portal_liberado ? <Etiqueta tom="ok">Liberado</Etiqueta> : <span className="text-xs text-muted">Fechado</span>}</td>}
                  <td className="text-muted">{data(c.criado_em)}</td>
                </tr>
              )
            })}
          </Tabela>
          <Paginacao total={q.data.total} limite={LIMITE} offset={offset} aoMudar={setOffset} />
        </>
      )}
    </>
  )
}

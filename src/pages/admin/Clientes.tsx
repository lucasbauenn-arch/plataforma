import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { crmListar } from '@/lib/rpc'
import { data, mascaraTelefone } from '@/lib/format'
import { Carregando } from '@/components/Estados'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { Abas } from '@/components/app/Abas'
import { ErroConsulta } from '@/components/app/Consulta'
import { SeloStatus } from '@/components/app/Etiqueta'
import { BarraFiltros, CampoBusca } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { Tabela } from '@/components/app/Tabela'
import { chavesCrm, nomeCompleto } from '@/modulos/crm/api-clientes'
import type { CrmFiltros } from '@/modulos/crm/tipos'
import { SolicitacoesEquipe } from '@/modulos/portal/componentes/SolicitacoesEquipe'

const LIMITE = 50

/**
 * Clientes com portal (internos) [WP2]: a antiga tela /admin/clientes virou a lista do CRM filtrada pelos clientes com
 * portal liberado (crm_listar, auditada). Negócios, arquivos e acessos ficam na aba Portal da ficha; "Novo cliente do
 * portal" é o cadastro do CRM seguido de crm_liberar_portal. Aba "Solicitações" (decisão do dono, 29/09/2026): a fila
 * dos pedidos abertos pelos clientes no portal (2ª via, antecipação, vistoria, dúvida, outro), com status e resposta.
 */
export default function ClientesAdmin() {
  const [params, setParams] = useSearchParams()
  const aba = params.get('aba') === 'solicitacoes' ? 'solicitacoes' : 'clientes'
  return (
    <>
      <CabecalhoPagina
        eyebrow="Portal do cliente" titulo="Clientes com portal"
        subtitulo="Compradores com acesso ao portal por CPF. Imóveis, marcos da compra, arquivos e acessos ficam na aba Portal da ficha."
        acoes={<Link to="/admin/crm/novo?portal=1" className="btn-primary"><Plus size={16} aria-hidden /> Novo cliente do portal</Link>}
      />
      <div className="mb-6">
        <Abas rotulo="Clientes com portal" ativa={aba} aoMudar={(a) => setParams(a === 'clientes' ? {} : { aba: a }, { replace: true })}
          abas={[{ id: 'clientes', rotulo: 'Clientes' }, { id: 'solicitacoes', rotulo: 'Solicitações' }]} />
      </div>
      {aba === 'solicitacoes' ? <SolicitacoesEquipe /> : <ListaClientesPortal />}
    </>
  )
}

function ListaClientesPortal() {
  const [busca, setBusca] = useState('')
  const [offset, setOffset] = useState(0)
  const filtros: CrmFiltros = { busca: busca || null, portal_liberado: true, ordem: 'nome' }
  const q = useQuery({
    queryKey: chavesCrm.lista(filtros, LIMITE, offset),
    queryFn: () => crmListar({ p_filtros: filtros, p_limite: LIMITE, p_offset: offset }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <BarraFiltros>
        <CampoBusca valor={busca} aoMudar={(v) => { setBusca(v); setOffset(0) }} placeholder="Nome, e-mail ou telefone" />
      </BarraFiltros>
      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : (
        <>
          <Tabela colunas={['Nome', 'E-mail', 'Telefone', 'Etapa', 'Cadastro', '']} legenda="Clientes com portal" vazio="Nenhum cliente com portal liberado.">
            {q.data.itens.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">{nomeCompleto(c.nome, c.sobrenome)}</td>
                <td>{c.email ?? <span className="text-muted">—</span>}</td>
                <td>{c.telefone ? mascaraTelefone(c.telefone) : <span className="text-muted">—</span>}</td>
                <td><SeloStatus tipo="etapa" valor={c.etapa} /></td>
                <td className="text-muted">{data(c.criado_em)}</td>
                <td className="text-right"><Link to={`/admin/crm/${c.id}?aba=portal`} className="text-xs font-semibold text-bronze">Gerenciar</Link></td>
              </tr>
            ))}
          </Tabela>
          <Paginacao total={q.data.total} limite={LIMITE} offset={offset} aoMudar={setOffset} />
        </>
      )}
    </>
  )
}

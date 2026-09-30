import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { propostasListar } from '@/lib/rpc'
import { useEmpreendimentos } from '@/hooks/queries'
import { STATUS_PROPOSTA } from '@/lib/constants'
import type { StatusProposta } from '@/lib/types'
import { Carregando, Vazio } from '@/components/Estados'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ErroConsulta } from '@/components/app/Consulta'
import { BarraFiltros, FiltroSelecao } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { chavesCrm } from '@/modulos/crm/api-clientes'
import { CartaoProposta } from '@/modulos/crm/ficha/AbaPropostas'
import type { PropostasFiltros } from '@/modulos/crm/tipos'

const LIMITE = 30

/**
 * Propostas (internos) [WP2]: lista por propostas_listar (com a cadeia e o cliente do CRM) e resposta por
 * propostas_responder (auditada; a timeline do cliente registra; os e-mails atuais ao parceiro continuam).
 */
export default function PropostasAdmin() {
  const { data: emps = [] } = useEmpreendimentos()
  const [status, setStatus] = useState('enviada')
  const [emp, setEmp] = useState('')
  const [offset, setOffset] = useState(0)
  const filtros: PropostasFiltros = {
    status: (status || null) as StatusProposta | null, empreendimento_id: emp || null, limite: LIMITE, offset,
  }
  const q = useQuery({
    queryKey: chavesCrm.propostas(filtros),
    queryFn: () => propostasListar({ p_filtros: filtros }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <CabecalhoPagina eyebrow="Comercial" titulo="Propostas" subtitulo="Propostas enviadas pelos parceiros. Responda aqui; o parceiro recebe por e-mail." />
      <BarraFiltros>
        <FiltroSelecao rotulo="Status" valor={status} aoMudar={(v) => { setStatus(v); setOffset(0) }}
          opcoes={(Object.keys(STATUS_PROPOSTA) as StatusProposta[]).map((s) => ({ valor: s, rotulo: STATUS_PROPOSTA[s] }))} />
        <FiltroSelecao rotulo="Empreendimento" valor={emp} aoMudar={(v) => { setEmp(v); setOffset(0) }}
          opcoes={emps.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
      </BarraFiltros>
      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : q.data.itens.length === 0 ? (
        <Vazio titulo="Nenhuma proposta" texto="Nada com esses filtros." />
      ) : (
        <>
          <ul className="grid gap-4">{q.data.itens.map((p) => <CartaoProposta key={p.id} proposta={p} />)}</ul>
          <Paginacao total={q.data.total} limite={LIMITE} offset={offset} aoMudar={setOffset} />
        </>
      )}
    </>
  )
}

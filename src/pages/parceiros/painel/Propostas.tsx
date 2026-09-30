import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { propostasListar } from '@/lib/rpc'
import { useEscopo } from '@/lib/escopo'
import { STATUS_PROPOSTA } from '@/lib/constants'
import type { StatusProposta } from '@/lib/types'
import { Carregando, Vazio } from '@/components/Estados'
import { ErroConsulta } from '@/components/app/Consulta'
import { FiltroSelecao } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { chavesCrm } from '@/modulos/crm/api-clientes'
import { CartaoProposta, FormProposta } from '@/modulos/crm/ficha/AbaPropostas'
import type { PropostasFiltros } from '@/modulos/crm/tipos'

const LIMITE = 20

/**
 * Propostas do parceiro [WP2]: envio pelo RPC propostas_criar (o cliente vem do CRM, crm_clientes_opcoes, e sai como
 * cliente_id) e a lista pelo propostas_listar (as próprias e as da cadeia abaixo; PAR-3 no autor).
 */
export default function PropostasParceiro() {
  const { tem } = useEscopo()
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const filtros: PropostasFiltros = { status: (status || null) as StatusProposta | null, limite: LIMITE, offset }
  const q = useQuery({
    queryKey: chavesCrm.propostas(filtros),
    queryFn: () => propostasListar({ p_filtros: filtros }),
    placeholderData: keepPreviousData,
  })

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
      {tem('propostas.criar') ? <FormProposta /> : <p className="card p-6 text-sm text-muted">Seu perfil não envia propostas.</p>}
      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-semibold">Propostas</h2>
          <FiltroSelecao
            rotulo="Status" valor={status} aoMudar={(v) => { setStatus(v); setOffset(0) }}
            opcoes={(Object.keys(STATUS_PROPOSTA) as StatusProposta[]).map((s) => ({ valor: s, rotulo: STATUS_PROPOSTA[s] }))}
          />
        </div>
        {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : q.data.itens.length === 0 ? (
          <Vazio titulo="Nenhuma proposta enviada" />
        ) : (
          <>
            <ul className="grid gap-3">{q.data.itens.map((p) => <CartaoProposta key={p.id} proposta={p} />)}</ul>
            <Paginacao total={q.data.total} limite={LIMITE} offset={offset} aoMudar={setOffset} />
          </>
        )}
      </div>
    </div>
  )
}

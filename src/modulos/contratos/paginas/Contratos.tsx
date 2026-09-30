import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { contratosListar } from '@/lib/rpc'
import { useEscopo } from '@/lib/escopo'
import { FORMAS_PAGAMENTO } from '@/lib/constants'
import { brlCentavos, codigoExibicao, data } from '@/lib/format'
import type { FormaPagamento, StatusContrato } from '@/lib/types'
import { Abas } from '@/components/app/Abas'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ErroConsulta } from '@/components/app/Consulta'
import { SeloStatus } from '@/components/app/Etiqueta'
import { BarraFiltros, CampoBusca, FiltroSelecao } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { Tabela } from '@/components/app/Tabela'
import { useBase } from '@/components/app/useBase'
import { Carregando } from '@/components/Estados'
import { chavesContratos } from '../api'
import { NovoContrato } from '../componentes/NovoContrato'
import type { ContratosFiltros } from '../tipos'

type AbaLista = 'andamento' | 'assinatura' | 'assinados' | 'encerrados' | 'todos'

const STATUS_DA_ABA: Record<AbaLista, StatusContrato[] | null> = {
  andamento: ['rascunho', 'documentacao_pendente', 'em_analise'],
  assinatura: ['assinatura_pendente'],
  assinados: ['assinado'],
  encerrados: ['recusado', 'expirado', 'cancelado', 'arquivado'],
  todos: null,
}

const POR_PAGINA = 20

/** Lista de contratos no escopo (contratos_listar, auditada). Mesma tela no admin e no painel. */
export default function Contratos() {
  const { tem } = useEscopo()
  const base = useBase()
  const [aba, setAba] = useState<AbaLista>('andamento')
  const [busca, setBusca] = useState('')
  const [forma, setForma] = useState('')
  const [offset, setOffset] = useState(0)
  const [novo, setNovo] = useState(false)

  const filtros: ContratosFiltros = {
    status: STATUS_DA_ABA[aba], busca: busca.trim() || null, forma: (forma || null) as FormaPagamento | null,
    limite: POR_PAGINA, offset,
  }
  const q = useQuery({
    queryKey: chavesContratos.lista(filtros),
    queryFn: () => contratosListar({ p_filtros: filtros }),
    placeholderData: keepPreviousData,
  })
  const mudar = <T,>(f: (v: T) => void) => (v: T) => { f(v); setOffset(0) }
  const gestor = tem('rede.ver') || tem('admin.acessar')

  return (
    <>
      <CabecalhoPagina
        titulo="Contratos"
        subtitulo="Contratos dos clientes da sua carteira. Os valores são sempre calculados pelo servidor a partir do valor do produto."
        acoes={tem('contratos.criar') && (
          <button type="button" className="btn-primary" onClick={() => setNovo(true)}><Plus size={16} aria-hidden /> Novo contrato</button>
        )}
      />
      <Abas
        abas={[
          { id: 'andamento', rotulo: 'Em andamento' }, { id: 'assinatura', rotulo: 'Em assinatura' },
          { id: 'assinados', rotulo: 'Assinados' }, { id: 'encerrados', rotulo: 'Encerrados' }, { id: 'todos', rotulo: 'Todos' },
        ]}
        ativa={aba} aoMudar={mudar(setAba)} rotulo="Situação dos contratos"
      />
      <div className="mt-6">
        <BarraFiltros>
          <CampoBusca valor={busca} aoMudar={mudar(setBusca)} placeholder="#código, cliente ou produto…" rotulo="Buscar contrato" />
          <FiltroSelecao rotulo="Forma" valor={forma} aoMudar={mudar(setForma)}
            opcoes={(Object.keys(FORMAS_PAGAMENTO) as FormaPagamento[]).map((f) => ({ valor: f, rotulo: FORMAS_PAGAMENTO[f] }))} />
        </BarraFiltros>
      </div>
      <div className="mt-4">
        {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : (
          <>
            <Tabela
              legenda="Contratos"
              colunas={['Contrato', 'Cliente', 'Produto', 'Forma', { rotulo: 'Valor', direita: true }, 'Status', ...(gestor ? ['Corretor'] : []), 'Criado em']}
              vazio="Nenhum contrato encontrado."
            >
              {q.data?.itens.map((k) => (
                <tr key={k.id}>
                  <td><Link to={`${base}/contratos/${k.id}`} className="font-semibold text-bronze hover:underline">{codigoExibicao(k.codigo)}</Link></td>
                  <td>{k.cliente.nome}</td>
                  <td>{k.produto.nome}</td>
                  <td>{FORMAS_PAGAMENTO[k.forma_pagamento]}{k.n_parcelas ? ` · ${k.n_parcelas}×` : ''}</td>
                  <td className="text-right tabular-nums">{brlCentavos(k.valor_imovel)}</td>
                  <td><SeloStatus tipo="contrato" valor={k.status} /></td>
                  {gestor && <td className="text-muted">{k.corretor?.nome ?? '—'}</td>}
                  <td className="text-muted">{data(k.criado_em)}</td>
                </tr>
              ))}
            </Tabela>
            <Paginacao total={q.data?.total ?? 0} limite={POR_PAGINA} offset={offset} aoMudar={setOffset} />
          </>
        )}
      </div>
      {tem('contratos.criar') && <NovoContrato aberto={novo} aoFechar={() => setNovo(false)} />}
    </>
  )
}

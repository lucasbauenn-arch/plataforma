import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ETAPAS, ORDEM_ETAPAS } from '@/lib/constants'
import { crmKanban, crmKanbanColuna } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { useEscopo } from '@/lib/escopo'
import type { EtapaFunil } from '@/lib/types'
import { Carregando } from '@/components/Estados'
import { ErroConsulta } from '@/components/app/Consulta'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { useBase } from '@/components/app/useBase'
import { CARTOES_POR_COLUNA, chavesFunil, useConfigDocumentos, useTransicoesFunil } from '../api-funil'
import { acharCartao, destinoPara, destinosPermitidos, type DestinoArraste } from '../funil'
import type { KanbanCartao, KanbanFiltros, KanbanResultado } from '../tipos'
import { CartaoKanban } from './CartaoKanban'
import { ColunaKanban } from './ColunaKanban'
import { useMoverEtapa } from './useMoverEtapa'

interface Pendente { cartao: KanbanCartao; destino: DestinoArraste }

/** Contadores do legado (§7.3): ativos, finalizados e perdidos no período. */
function Contadores({ k, comPeriodo }: { k: KanbanResultado; comPeriodo: boolean }) {
  const itens = [
    { rotulo: 'Clientes ativos', valor: k.contadores.total },
    { rotulo: comPeriodo ? 'Finalizados no período' : 'Finalizados', valor: k.contadores.finalizados },
    { rotulo: comPeriodo ? 'Perdidos no período' : 'Perdidos', valor: k.contadores.perdidos },
  ]
  return (
    <dl className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="Contadores do funil">
      {itens.map((i) => (
        <div key={i.rotulo} className="card px-4 py-3">
          <dt className="text-xs uppercase tracking-wider text-muted">{i.rotulo}</dt>
          <dd className="display mt-1 text-3xl">{i.valor.toLocaleString('pt-BR')}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Kanban do CRM [WP3] (§7.3): 5 colunas (Perdidos recolhida), 50 cartões por coluna com "Ver mais", arraste nativo
 * validado pela `status_transicoes` em cache e pelo papel, Perdidos com motivo, Documentação com confirmação dos
 * documentos que serão solicitados, movimento otimista que volta se `crm_mudar_etapa` falhar.
 */
export function Kanban({ filtros }: { filtros: KanbanFiltros }) {
  const base = useBase()
  const qc = useQueryClient()
  const { escopo } = useEscopo()
  const papel = escopo?.papel ?? null
  const chave = chavesFunil.kanban(filtros)
  const consulta = useQuery({
    queryKey: chave,
    queryFn: () => crmKanban({ p_filtros: filtros, p_limite_coluna: CARTOES_POR_COLUNA }),
    placeholderData: keepPreviousData,
  })
  const transicoes = useTransicoesFunil()
  const config = useConfigDocumentos()
  const mover = useMoverEtapa(filtros)

  const [arrasto, setArrasto] = useState<{ id: string; de: EtapaFunil } | null>(null)
  const [pendente, setPendente] = useState<Pendente | null>(null)
  const [perdidosAberto, setPerdidosAberto] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState<EtapaFunil | null>(null)

  const trans = useMemo(() => transicoes.data ?? [], [transicoes.data])
  // coluna em que ninguém (com este papel) entra manualmente, de nenhuma etapa: fica marcada como bloqueada
  const bloqueio = useMemo(() => {
    const r = {} as Record<EtapaFunil, string | null>
    for (const para of ORDEM_ETAPAS) {
      const dests = ORDEM_ETAPAS.filter((de) => de !== para).map((de) => destinoPara(trans, papel, de, para))
      r[para] = transicoes.isSuccess && !dests.some((d) => d.permitido) ? (para === 'finalizado' ? dests[0]?.dica ?? null : 'Nenhuma mudança manual leva a esta etapa.') : null
    }
    return r
  }, [trans, papel, transicoes.isSuccess])

  if (consulta.isPending) return <Carregando />
  if (consulta.error) return <ErroConsulta erro={consulta.error} tentarDeNovo={consulta.refetch} />
  const k = consulta.data

  function executar(cartao: KanbanCartao, destino: DestinoArraste, motivo: string | null) {
    return mover.mutateAsync({ id: cartao.id, para: destino.para, motivo }).then((r) => {
      const docs = r.documentos_solicitados
      toast.success(`${cartao.nome} foi para ${ETAPAS[r.para].rotulo}.`, {
        description: docs.length ? `Documentos solicitados: ${docs.join(', ')}.` : undefined,
      })
    })
  }

  function iniciar(cartao: KanbanCartao, destino: DestinoArraste) {
    if (!destino.permitido) {
      if (destino.dica) toast.info(destino.dica)
      return
    }
    if (destino.acao === 'mover') {
      executar(cartao, destino, null).catch((e) => toast.error(mensagemErro(e)))
      return
    }
    setPendente({ cartao, destino })
  }

  function soltar(para: EtapaFunil) {
    const a = arrasto
    setArrasto(null)
    if (!a) return
    const cartao = acharCartao(k, a.id)
    if (cartao) iniciar(cartao, destinoPara(trans, papel, a.de, para))
  }

  async function verMais(etapa: EtapaFunil, jaCarregados: number) {
    setCarregandoMais(etapa)
    try {
      const pagina = await crmKanbanColuna({ p_etapa: etapa, p_filtros: filtros, p_offset: jaCarregados })
      qc.setQueryData<KanbanResultado>(chave, (atual) => atual && {
        ...atual,
        colunas: atual.colunas.map((c) => {
          if (c.etapa !== etapa) return c
          const ids = new Set(c.itens.map((i) => i.id))
          return { ...c, total: pagina.total, itens: [...c.itens, ...pagina.itens.filter((i) => !ids.has(i.id))] }
        }),
      })
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setCarregandoMais(null)
    }
  }

  const basicos = config.data?.documentos_basicos ?? []
  const comPeriodo = !!(filtros.periodo_de || filtros.periodo_ate)

  return (
    <>
      <Contadores k={k} comPeriodo={comPeriodo} />
      {transicoes.error && (
        <p className="mb-4 text-sm text-muted">Não foi possível carregar as regras de etapa: use a ficha do cliente para mudar a etapa.</p>
      )}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4" aria-busy={consulta.isFetching || undefined}>
        {k.colunas.map((coluna) => {
          const destino = arrasto && arrasto.de !== coluna.etapa ? destinoPara(trans, papel, arrasto.de, coluna.etapa) : null
          const ehPerdidos = coluna.etapa === 'perdido'
          const recolhida = ehPerdidos && !perdidosAberto
          const restam = coluna.total - coluna.itens.length
          return (
            <ColunaKanban
              key={coluna.etapa} etapa={coluna.etapa} total={coluna.total} destino={destino}
              bloqueada={bloqueio[coluna.etapa]} recolhida={recolhida}
              aoAlternar={ehPerdidos ? () => setPerdidosAberto((v) => !v) : undefined}
              aoSoltar={() => soltar(coluna.etapa)}
              rodape={restam > 0 ? (
                <button type="button" className="btn-ghost m-2 mt-0 px-3 py-2 text-xs" disabled={carregandoMais === coluna.etapa}
                  onClick={() => void verMais(coluna.etapa, coluna.itens.length)}>
                  {carregandoMais === coluna.etapa ? 'Carregando…' : `Ver mais (${restam})`}
                </button>
              ) : null}
            >
              {coluna.itens.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted">Nenhum cliente nesta etapa.</p>}
              {coluna.itens.map((cartao) => (
                <CartaoKanban
                  key={cartao.id} cartao={cartao} base={base}
                  destinos={destinosPermitidos(trans, papel, cartao.etapa)}
                  movendo={mover.isPending && mover.variables?.id === cartao.id}
                  aoMover={(d) => iniciar(cartao, d)}
                  aoIniciarArrasto={() => setArrasto({ id: cartao.id, de: cartao.etapa })}
                  aoTerminarArrasto={() => setArrasto(null)}
                />
              ))}
            </ColunaKanban>
          )
        })}
      </div>

      <ConfirmarModal
        aberto={pendente?.destino.acao === 'pedir_motivo'}
        titulo={pendente ? `Marcar ${pendente.cartao.nome} como perdido` : ''}
        texto="O cliente sai do funil ativo. Ele pode ser reativado depois, voltando para Novo contato."
        rotuloConfirmar="Marcar como perdido" perigo
        motivo={{ rotulo: 'Motivo da perda', minimo: 3, placeholder: 'Ex.: comprou com outra empresa' }}
        aoConfirmar={(motivo) => pendente && executar(pendente.cartao, pendente.destino, motivo)}
        aoFechar={() => setPendente(null)}
      />
      <ConfirmarModal
        aberto={pendente?.destino.acao === 'confirmar_documentos'}
        titulo={pendente ? `Mover ${pendente.cartao.nome} para Documentação` : ''}
        texto={
          basicos.length
            ? <>Serão solicitados os documentos básicos que ainda não existem: <strong>{basicos.join(', ')}</strong>.</>
            : 'Serão solicitados os documentos básicos que ainda não existem.'
        }
        rotuloConfirmar="Mover e solicitar"
        aoConfirmar={() => pendente && executar(pendente.cartao, pendente.destino, null)}
        aoFechar={() => setPendente(null)}
      />
    </>
  )
}

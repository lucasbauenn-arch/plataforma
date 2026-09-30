import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { crmDuplicidadeResolver, crmDuplicidadesListar } from '@/lib/rpc'
import { ORIGENS_CLIENTE, PAPEIS, TIPOS_PARCEIRO } from '@/lib/constants'
import { data, dataHora } from '@/lib/format'
import { Carregando } from '@/components/Estados'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { ErroConsulta } from '@/components/app/Consulta'
import { Etiqueta, SeloStatus, type Tom } from '@/components/app/Etiqueta'
import { BarraFiltros, FiltroSelecao } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { Tabela } from '@/components/app/Tabela'
import { useBase } from '@/components/app/useBase'
import { chavesCrm, RESULTADOS_DUPLICIDADE } from '../api-clientes'
import type { DecisaoDuplicidade, DuplicidadeItem, DuplicidadesFiltros, ResultadoDuplicidade } from '../tipos'

const LIMITE = 50
const TOM: Record<ResultadoDuplicidade, Tom> = {
  bloqueado_exclusividade: 'neutro', bloqueado_contrato: 'neutro', bloqueado_pos_prazo: 'alerta', mesmo_dono: 'ok',
}

/** Exclusividade ainda vigente (a fila só transfere depois do prazo; quem decide é o servidor em pode_transferir). */
const dentroDoPrazo = (ate: string | null) => Boolean(ate) && new Date(ate as string).getTime() > Date.now()

/**
 * Fila de duplicidades (A2, só internos): tentativas de cadastro com CPF/CNPJ que já existe. Nunca há transferência
 * automática; aqui a equipe decide manter o dono ou, só depois do prazo de exclusividade, transferir o cliente para
 * quem tentou (mesma regra de rede_transferir_clientes: entre imobiliárias, só o Super). Motivo obrigatório.
 */
export default function Duplicidades() {
  const base = useBase()
  const qc = useQueryClient()
  const [pendentes, setPendentes] = useState('sim')
  const [resultado, setResultado] = useState('')
  const [offset, setOffset] = useState(0)
  const [acao, setAcao] = useState<{ item: DuplicidadeItem; decisao: DecisaoDuplicidade } | null>(null)

  const filtros: DuplicidadesFiltros = {
    pendentes: pendentes === 'sim' ? true : pendentes === 'nao' ? false : undefined,
    resultado: (resultado || null) as ResultadoDuplicidade | null,
    limite: LIMITE, offset,
  }
  const q = useQuery({
    queryKey: chavesCrm.duplicidades(filtros),
    queryFn: () => crmDuplicidadesListar({ p_filtros: filtros }),
    placeholderData: keepPreviousData,
  })

  async function resolver(motivo: string | null) {
    if (!acao) return
    await crmDuplicidadeResolver({ p_id: acao.item.id, p_decisao: acao.decisao, p_motivo: motivo ?? '' })
    toast.success(acao.decisao === 'transferir' ? 'Cliente transferido para quem tentou.' : 'Dono mantido.')
    void qc.invalidateQueries({ queryKey: ['crm-duplicidades'] })
    void qc.invalidateQueries({ queryKey: chavesCrm.listas })
  }

  return (
    <>
      <CabecalhoPagina
        eyebrow="CRM" titulo="Duplicidades"
        subtitulo="Tentativas de cadastro com documento que já existe. O dono não muda sem decisão da equipe."
        acoes={<SeloProvisorio codigo="A2" />}
      />
      <BarraFiltros>
        <FiltroSelecao rotulo="Situação" valor={pendentes} todos="Todas" aoMudar={(v) => { setPendentes(v); setOffset(0) }}
          opcoes={[{ valor: 'sim', rotulo: 'Pendentes' }, { valor: 'nao', rotulo: 'Resolvidas' }]} />
        <FiltroSelecao rotulo="Resultado" valor={resultado} aoMudar={(v) => { setResultado(v); setOffset(0) }}
          opcoes={(Object.keys(RESULTADOS_DUPLICIDADE) as ResultadoDuplicidade[]).map((r) => ({ valor: r, rotulo: RESULTADOS_DUPLICIDADE[r] }))} />
      </BarraFiltros>

      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : (
        <>
          <Tabela colunas={['Cliente existente', 'Tentativa', 'Resultado', 'Situação', '']} legenda="Duplicidades" vazio="Nenhuma duplicidade." minimo={900}>
            {q.data.itens.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link to={`${base}/crm/${d.cliente.id}`} className="font-semibold hover:text-bronze">{d.cliente.nome}</Link>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <SeloStatus tipo="etapa" valor={d.cliente.etapa} />
                    {d.cliente.corretor.nome} · {d.cliente.imobiliaria.nome}
                  </span>
                  <span className="block text-xs text-muted">
                    Exclusividade: {d.cliente.exclusividade_ate ? `até ${data(d.cliente.exclusividade_ate)}` : 'sem prazo registrado'}
                  </span>
                </td>
                <td className="text-sm">
                  {d.tentado_por ? <>{d.tentado_por.nome} <span className="text-xs text-muted">({PAPEIS[d.tentado_por.papel]})</span></> : 'Pré-cadastro público'}
                  {d.tentado_por_parceiro && (
                    <span className="block text-xs text-muted">
                      Para: {d.tentado_por_parceiro.nome} ({TIPOS_PARCEIRO[d.tentado_por_parceiro.tipo]}) · {d.tentado_por_parceiro.imobiliaria.nome}
                    </span>
                  )}
                  <span className="block text-xs text-muted">{ORIGENS_CLIENTE[d.origem]} · {dataHora(d.ocorrido_em)}</span>
                </td>
                <td><Etiqueta tom={TOM[d.resultado]}>{RESULTADOS_DUPLICIDADE[d.resultado]}</Etiqueta></td>
                <td className="text-xs">
                  {d.resolvido_em ? (
                    <>
                      <Etiqueta tom={d.decisao === 'transferir' ? 'destaque' : 'neutro'}>{d.decisao === 'transferir' ? 'Transferido' : 'Mantido'}</Etiqueta>
                      <span className="mt-1 block text-muted">{d.resolvido_por?.nome ?? '—'} · {dataHora(d.resolvido_em)}</span>
                      {d.motivo_decisao && <span className="block whitespace-pre-line">{d.motivo_decisao}</span>}
                    </>
                  ) : <Etiqueta tom="alerta">Pendente</Etiqueta>}
                </td>
                <td className="text-right">
                  {!d.resolvido_em && (
                    <div className="flex justify-end gap-2">
                      <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => setAcao({ item: d, decisao: 'manter' })}>Manter dono</button>
                      {d.pode_transferir ? (
                        <button type="button" className="btn-primary px-3 py-2 text-xs" onClick={() => setAcao({ item: d, decisao: 'transferir' })}>Transferir</button>
                      ) : dentroDoPrazo(d.cliente.exclusividade_ate) && (
                        <span className="self-center text-xs text-muted">Transferência só depois do prazo</span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Tabela>
          <Paginacao total={q.data.total} limite={LIMITE} offset={offset} aoMudar={setOffset} />
        </>
      )}

      <ConfirmarModal
        aberto={!!acao}
        titulo={acao?.decisao === 'transferir' ? 'Transferir o cliente para quem tentou?' : 'Manter o dono atual?'}
        texto={acao?.decisao === 'transferir'
          ? <>O cliente <strong>{acao.item.cliente.nome}</strong> passa para <strong>{acao.item.tentado_por_parceiro?.nome}</strong>. A transferência fica no histórico e na auditoria. Entre imobiliárias, só o Super transfere.</>
          : 'A tentativa fica registrada como resolvida e o cliente continua com o corretor atual.'}
        rotuloConfirmar={acao?.decisao === 'transferir' ? 'Transferir' : 'Manter dono'}
        perigo={acao?.decisao === 'transferir'}
        motivo={{ rotulo: 'Motivo da decisão', placeholder: 'Registre o que foi considerado' }}
        aoConfirmar={resolver}
        aoFechar={() => setAcao(null)}
      />
    </>
  )
}

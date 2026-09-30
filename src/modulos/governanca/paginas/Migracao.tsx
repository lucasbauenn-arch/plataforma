import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Eye, Filter, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { migracaoPendenciasResolver } from '@/lib/rpc'
import { traduzirErro } from '@/lib/erros'
import { dataHora } from '@/lib/format'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ErroConsulta } from '@/components/app/Consulta'
import { Tabela } from '@/components/app/Tabela'
import { Paginacao } from '@/components/app/Paginacao'
import { Gaveta } from '@/components/app/Modal'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Etiqueta, type Tom } from '@/components/app/Etiqueta'
import { Campo } from '@/components/Campo'
import { Carregando } from '@/components/Estados'
import type { MigracaoPendencia } from '../tipos'

/**
 * Pendências da migração (corte, migration 20260929000018; §2.4 e §4.4). O corte abre uma pendência para cada caso que
 * precisa de decisão da equipe (conflitos de CPF, CPF inválido, dono sem vínculo, …). A correção do dado é feita nas
 * telas de sempre (ficha do cliente, transferência, Rede), que auditam cada ação; aqui a equipe registra O QUE foi
 * decidido e fecha a pendência com `migracao_pendencias_resolver` (internos). O detalhe nunca traz dado pessoal: o
 * registro é aberto pelo link.
 */

const LIMITE = 50
const CHAVE = ['governanca', 'migracao_pendencias'] as const

/** Linha lida pela API (política "internos leem"). O corte grava mais tipos do que os três da §2.4 e a coluna decisao. */
type Pendencia = Omit<MigracaoPendencia, 'tipo'> & { tipo: string; decisao: string | null }

type Situacao = 'abertas' | 'resolvidas' | 'todas'

const TIPOS: Record<string, { rotulo: string; tom: Tom }> = {
  cpf_conflito_portal: { rotulo: 'CPF de cliente do portal', tom: 'alerta' },
  cpf_conflito_cliente: { rotulo: 'CPF de cliente do CRM', tom: 'alerta' },
  cpf_conflito_parceiros: { rotulo: 'CPF em dois parceiros', tom: 'alerta' },
  juntada_divergente: { rotulo: 'Juntada com nome ou RG diferentes', tom: 'alerta' },
  cpf_invalido: { rotulo: 'CPF inválido', tom: 'erro' },
  cpf_parceiro_invalido: { rotulo: 'CPF do parceiro', tom: 'erro' },
  parceiro_pendente_com_clientes: { rotulo: 'Pendente com carteira', tom: 'alerta' },
  dono_sem_vinculo: { rotulo: 'Dono sem vínculo', tom: 'neutro' },
  proposta_cliente_outro_parceiro: { rotulo: 'Proposta de outro parceiro', tom: 'neutro' },
  decisao_invalida: { rotulo: 'Decisão inválida', tom: 'neutro' },
}

const rotuloTipo = (t: string) => TIPOS[t]?.rotulo ?? t
const tomTipo = (t: string): Tom => TIPOS[t]?.tom ?? 'neutro'

/** Onde abrir o registro da pendência (só o que tem tela; o resto mostra o id). */
function linkRegistro(tabela: string, id: string): { para: string; rotulo: string } | null {
  if (tabela === 'clientes') return { para: `/admin/crm/${id}`, rotulo: 'Ficha do cliente' }
  if (tabela === 'parceiros') return { para: `/admin/rede/parceiros/${id}`, rotulo: 'Parceiro na Rede' }
  if (tabela === 'propostas') return { para: '/admin/propostas', rotulo: 'Propostas' }
  return null
}

/** O que é o "relacionado" em cada tipo (o corte grava sempre o mesmo tipo de registro). */
function linkRelacionado(tipo: string, id: string | null): { para: string; rotulo: string } | null {
  if (!id) return null
  if (tipo.startsWith('cpf_conflito_') || tipo === 'proposta_cliente_outro_parceiro') {
    return { para: `/admin/crm/${id}`, rotulo: 'Cliente relacionado' }
  }
  return null
}

const ROTULO_TABELA: Record<string, string> = {
  clientes: 'Cliente', parceiros: 'Parceiro', propostas: 'Proposta', legado_parceiro_clientes: 'Registro antigo do parceiro',
}

async function listar(situacao: Situacao, tipo: string, offset: number) {
  let q = supabase.from('migracao_pendencias')
    .select('id, tipo, tabela, registro_id, relacionado_id, detalhe, decisao, resolvido_em, resolvido_por, criado_em', { count: 'exact' })
  if (situacao === 'abertas') q = q.is('resolvido_em', null)
  if (situacao === 'resolvidas') q = q.not('resolvido_em', 'is', null)
  if (tipo) q = q.eq('tipo', tipo)
  const { data, error, count } = await q.order('criado_em', { ascending: true }).order('id', { ascending: true })
    .range(offset, offset + LIMITE - 1)
  if (error) throw traduzirErro(error)
  return { total: count ?? 0, itens: (data ?? []) as Pendencia[] }
}

export default function Migracao() {
  const qc = useQueryClient()
  const [situacao, setSituacao] = useState<Situacao>('abertas')
  const [tipo, setTipo] = useState('')
  const [offset, setOffset] = useState(0)
  const [aberta, setAberta] = useState<Pendencia | null>(null)
  const [resolver, setResolver] = useState<Pendencia | null>(null)

  const q = useQuery({
    queryKey: [...CHAVE, situacao, tipo, offset],
    queryFn: () => listar(situacao, tipo, offset),
    placeholderData: keepPreviousData,
  })

  async function confirmarResolucao(decisao: string | null) {
    if (!resolver || !decisao) return
    await migracaoPendenciasResolver({ p_id: resolver.id, p_decisao: decisao })
    toast.success('Pendência resolvida.')
    setAberta(null)
    await qc.invalidateQueries({ queryKey: CHAVE })
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Pendências da migração"
        subtitulo="Casos que o corte dos dados antigos não resolveu sozinho. Corrija o registro pela tela indicada e registre aqui a decisão tomada."
      />

      <div className="card mb-6 grid gap-4 p-5 sm:grid-cols-3" role="group" aria-label="Filtros das pendências">
        <Campo label="Situação">
          <select className="input" value={situacao} onChange={(e) => { setSituacao(e.target.value as Situacao); setOffset(0) }}>
            <option value="abertas">Abertas</option>
            <option value="resolvidas">Resolvidas</option>
            <option value="todas">Todas</option>
          </select>
        </Campo>
        <Campo label="Tipo">
          <select className="input" value={tipo} onChange={(e) => { setTipo(e.target.value); setOffset(0) }}>
            <option value="">Todos</option>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
          </select>
        </Campo>
        <p className="flex items-end gap-2 text-xs text-muted">
          <Filter size={14} aria-hidden className="mb-0.5 shrink-0" /> Os filtros valem na hora; a lista mostra as mais antigas primeiro.
        </p>
      </div>

      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : (
        <>
          <p className="mb-3 text-sm text-muted">{q.data.total.toLocaleString('pt-BR')} pendência(s)</p>
          <Tabela
            legenda="Pendências da migração"
            colunas={['Tipo', 'Registro', 'O que aconteceu', 'Desde', 'Situação', { rotulo: '', direita: true }]}
            vazio={situacao === 'abertas' ? 'Nenhuma pendência aberta.' : 'Nenhuma pendência com esses filtros.'}
            minimo={880}
          >
            {q.data.itens.map((p) => {
              const reg = linkRegistro(p.tabela, p.registro_id)
              return (
                <tr key={p.id}>
                  <td><Etiqueta tom={tomTipo(p.tipo)}>{rotuloTipo(p.tipo)}</Etiqueta></td>
                  <td className="whitespace-nowrap">
                    {reg
                      ? <Link to={reg.para} className="font-semibold text-bronze hover:underline">{reg.rotulo}</Link>
                      : <span>{ROTULO_TABELA[p.tabela] ?? p.tabela}</span>}
                  </td>
                  <td className="min-w-64 max-w-md"><span className="line-clamp-3 text-stone/85" title={p.detalhe ?? undefined}>{p.detalhe ?? '—'}</span></td>
                  <td className="whitespace-nowrap text-muted">{dataHora(p.criado_em)}</td>
                  <td className="whitespace-nowrap">
                    {p.resolvido_em ? <Etiqueta tom="ok">Resolvida</Etiqueta> : <Etiqueta tom="alerta">Aberta</Etiqueta>}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-3">
                      <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-bronze" onClick={() => setAberta(p)}>
                        <Eye size={15} aria-hidden /> Detalhes
                      </button>
                      {!p.resolvido_em && (
                        <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-stone" onClick={() => setResolver(p)}>
                          <CheckCircle2 size={15} aria-hidden /> Resolver
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </Tabela>
          <Paginacao total={q.data.total} limite={LIMITE} offset={offset} aoMudar={setOffset} />
        </>
      )}

      <Gaveta aberto={!!aberta} titulo="Pendência da migração" aoFechar={() => setAberta(null)}>
        {aberta && <Detalhe p={aberta} aoResolver={() => setResolver(aberta)} />}
      </Gaveta>

      <ConfirmarModal
        aberto={!!resolver}
        titulo="Resolver pendência"
        texto={resolver && (
          <>
            <p className="mb-2"><strong className="text-stone">{rotuloTipo(resolver.tipo)}.</strong> {resolver.detalhe}</p>
            <p>Descreva o que foi decidido e feito (por exemplo, "CPF confirmado com o corretor e completado na ficha"). A decisão fica registrada com o seu nome e não pode ser alterada depois.</p>
          </>
        )}
        rotuloConfirmar="Registrar decisão"
        motivo={{ rotulo: 'Decisão', minimo: 5, placeholder: 'O que foi decidido e onde foi corrigido' }}
        aoConfirmar={confirmarResolucao}
        aoFechar={() => setResolver(null)}
      />
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

function Detalhe({ p, aoResolver }: { p: Pendencia; aoResolver: () => void }) {
  const reg = linkRegistro(p.tabela, p.registro_id)
  const rel = linkRelacionado(p.tipo, p.relacionado_id)
  return (
    <div className="grid gap-6">
      <dl>
        <Linha rotulo="Tipo"><Etiqueta tom={tomTipo(p.tipo)}>{rotuloTipo(p.tipo)}</Etiqueta></Linha>
        <Linha rotulo="O que aconteceu">{p.detalhe ?? '—'}</Linha>
        <Linha rotulo="Registro">
          {ROTULO_TABELA[p.tabela] ?? p.tabela}
          {reg && <Link to={reg.para} className="ml-2 font-semibold text-bronze hover:underline">{reg.rotulo}</Link>}
          <span className="block font-mono text-xs text-muted">{p.registro_id}</span>
        </Linha>
        {p.relacionado_id && (
          <Linha rotulo="Relacionado">
            {rel ? <Link to={rel.para} className="font-semibold text-bronze hover:underline">{rel.rotulo}</Link> : 'Registro relacionado'}
            <span className="block font-mono text-xs text-muted">{p.relacionado_id}</span>
          </Linha>
        )}
        <Linha rotulo="Aberta em">{dataHora(p.criado_em)}</Linha>
        <Linha rotulo="Situação">{p.resolvido_em ? `Resolvida em ${dataHora(p.resolvido_em)}` : 'Aberta'}</Linha>
        {p.decisao && <Linha rotulo="Decisão">{p.decisao}</Linha>}
      </dl>
      {!p.resolvido_em && (
        <button type="button" className="btn-primary justify-self-start" onClick={aoResolver}>
          <CheckCircle2 size={16} aria-hidden /> Resolver
        </button>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <ShieldCheck size={13} aria-hidden /> A resolução fica na auditoria (quem, quando e o tipo); o texto da decisão fica só aqui.
      </p>
    </div>
  )
}

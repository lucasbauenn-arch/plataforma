import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { crmMinhasTarefas, crmTarefaConcluir } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { useEscopo } from '@/lib/escopo'
import type { StatusTarefa } from '@/lib/types'
import { Abas, type Aba } from '@/components/app/Abas'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { Consulta } from '@/components/app/Consulta'
import { SeloStatus } from '@/components/app/Etiqueta'
import { BarraFiltros, FiltroSelecao } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { Tabela } from '@/components/app/Tabela'
import { useBase } from '@/components/app/useBase'
import { TAREFAS_POR_PAGINA, chavesFunil } from '../api-funil'
import { dataSemFuso } from '../funil'
import { chaveFicha, type TarefaItem, type TarefasFiltros } from '../tipos'

type AbaTarefas = 'minhas' | 'equipe'
type FiltroStatus = StatusTarefa | 'todas'

const OPCOES_STATUS: { valor: FiltroStatus; rotulo: string }[] = [
  { valor: 'pendente', rotulo: 'Pendentes' },
  { valor: 'concluida', rotulo: 'Concluídas' },
  { valor: 'todas', rotulo: 'Todas' },
]

/**
 * [WP3] Tarefas (§7.2): "Minhas" (responsável = quem está logado) e "Da equipe" (clientes no escopo, para gestores e
 * internos), com "atrasada" calculada no servidor. Só voltam tarefas de clientes que ainda estão no escopo: quem perde
 * o cliente numa transferência perde a tarefa.
 */
export default function Tarefas() {
  const base = useBase()
  const qc = useQueryClient()
  const { escopo } = useEscopo()
  const podeEquipe = !!escopo && (escopo.interno || escopo.tipo === 'gerente' || escopo.tipo === 'imobiliaria')
  const [params, setParams] = useSearchParams()
  const aba: AbaTarefas = params.get('aba') === 'equipe' && podeEquipe ? 'equipe' : 'minhas'
  const statusParam = params.get('status')
  const status: FiltroStatus = statusParam === 'concluida' || statusParam === 'todas' ? statusParam : 'pendente'
  const atrasadas = params.get('atrasadas') === '1'
  const offset = Math.max(0, Number(params.get('offset')) || 0)
  const filtros: TarefasFiltros = {
    escopo: aba, status: status === 'todas' ? null : status, atrasadas, limite: TAREFAS_POR_PAGINA, offset,
  }

  const consulta = useQuery({
    queryKey: chavesFunil.minhasTarefas(filtros),
    queryFn: () => crmMinhasTarefas({ p_filtros: filtros }),
    placeholderData: keepPreviousData,
  })
  const concluir = useMutation({
    mutationFn: (t: TarefaItem) => crmTarefaConcluir({ p_id: t.id }),
    onSuccess: (_r, t) => {
      toast.success('Tarefa concluída.')
      void qc.invalidateQueries({ queryKey: chavesFunil.minhasTarefasTodas })
      void qc.invalidateQueries({ queryKey: chavesFunil.tarefas(t.cliente_id) })
      void qc.invalidateQueries({ queryKey: chavesFunil.timeline(t.cliente_id) })
      void qc.invalidateQueries({ queryKey: chaveFicha(t.cliente_id) })
    },
    onError: (e) => toast.error(mensagemErro(e)),
  })

  function mudar(m: Record<string, string | null>) {
    setParams((atual) => {
      const p = new URLSearchParams(atual)
      for (const [k, v] of Object.entries(m)) {
        if (v == null || v === '') p.delete(k)
        else p.set(k, v)
      }
      if (!('offset' in m)) p.delete('offset')
      return p
    }, { replace: true })
  }

  const abas: Aba<AbaTarefas>[] = [{ id: 'minhas', rotulo: 'Minhas' }, ...(podeEquipe ? [{ id: 'equipe' as const, rotulo: 'Da equipe' }] : [])]

  return (
    <section>
      <CabecalhoPagina titulo="Tarefas" subtitulo="Tarefas dos clientes no seu escopo. Para criar ou editar, abra a ficha do cliente." />
      {abas.length > 1 && (
        <div className="mb-4">
          <Abas abas={abas} ativa={aba} aoMudar={(a) => mudar({ aba: a === 'minhas' ? null : a })} rotulo="Tarefas de quem" />
        </div>
      )}
      <BarraFiltros>
        <FiltroSelecao rotulo="Situação" valor={status} todos={null} opcoes={OPCOES_STATUS}
          aoMudar={(v) => mudar({ status: v === 'pendente' ? null : v })} />
        <label className="flex items-center gap-2 pb-3 text-sm">
          <input type="checkbox" className="size-4 accent-bronze" checked={atrasadas} onChange={(e) => mudar({ atrasadas: e.target.checked ? '1' : null })} />
          Só atrasadas
        </label>
      </BarraFiltros>

      <Consulta consulta={consulta} vazio={(d) => d.itens.length === 0} tituloVazio="Nenhuma tarefa"
        textoVazio={aba === 'minhas' ? 'Você não tem tarefas com estes filtros.' : 'A equipe não tem tarefas com estes filtros.'}>
        {(d) => (
          <>
            <Tabela colunas={['Tarefa', 'Cliente', 'Responsável', 'Prazo', 'Situação', { rotulo: 'Ações', direita: true }]} legenda="Tarefas">
              {d.itens.map((t) => (
                <tr key={t.id}>
                  <td className="max-w-80">
                    <p className="font-semibold">{t.titulo}</p>
                    {t.descricao && <p className="line-clamp-2 text-xs text-muted">{t.descricao}</p>}
                  </td>
                  <td><Link to={`${base}/crm/${t.cliente.id}?aba=tarefas`} className="hover:text-bronze">{t.cliente.nome}</Link></td>
                  <td>{t.responsavel?.nome ?? '—'}</td>
                  <td className="whitespace-nowrap">{t.prazo ? dataSemFuso(t.prazo) : 'Sem prazo'}</td>
                  <td><SeloStatus tipo="tarefa" valor={t.status} atrasada={t.atrasada} /></td>
                  <td className="text-right">
                    {t.pode_concluir && (
                      <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={concluir.isPending}
                        onClick={() => concluir.mutate(t)} aria-label={`Concluir: ${t.titulo}`}>
                        <Check size={14} aria-hidden /> Concluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </Tabela>
            <Paginacao total={d.total} limite={TAREFAS_POR_PAGINA} offset={offset} aoMudar={(o) => mudar({ offset: String(o) })} />
          </>
        )}
      </Consulta>
    </section>
  )
}

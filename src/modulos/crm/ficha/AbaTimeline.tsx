import { useInfiniteQuery } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowRightLeft, CheckSquare, FileCheck2, FilePlus2, FileSignature, FileUp, History, MessageSquare, Send, Shield,
  Shuffle, SquarePlus, UserPlus, type LucideIcon,
} from 'lucide-react'
import { crmTimeline } from '@/lib/rpc'
import { ETAPAS } from '@/lib/constants'
import { dataHora } from '@/lib/format'
import { Carregando, Vazio } from '@/components/Estados'
import { ErroConsulta } from '@/components/app/Consulta'
import { EVENTOS_POR_PAGINA, chavesFunil } from '../api-funil'
import { agruparPorMes } from '../funil'
import type { PropsAbaFicha, TimelineEvento, TipoEventoCliente } from '../tipos'

const ICONES: Record<TipoEventoCliente, LucideIcon> = {
  cadastro: UserPlus, pre_cadastro: UserPlus, etapa: ArrowRightLeft, nota: MessageSquare, tarefa_criada: SquarePlus,
  tarefa_concluida: CheckSquare, documento_solicitado: FilePlus2, documento_enviado: FileUp, documento_analisado: FileCheck2,
  contrato_gerado: FileSignature, contrato_enviado: FileSignature, contrato_assinado: FileSignature, contrato_encerrado: FileSignature,
  transferencia: Shuffle, proposta_enviada: Send, proposta_respondida: Send, consentimento: Shield, migracao: History,
  tentativa_duplicada: AlertTriangle,
}

/** Detalhe do evento além do título (só etapas e motivo; a timeline não guarda dado pessoal). */
function Detalhe({ e }: { e: TimelineEvento }) {
  if (e.tipo === 'etapa') {
    const { de, para, motivo } = e.dados
    return (
      <>
        <p className="text-xs text-muted">{ETAPAS[de]?.rotulo ?? de} → {ETAPAS[para]?.rotulo ?? para}</p>
        {motivo && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone/85">Motivo: {motivo}</p>}
      </>
    )
  }
  return null
}

/**
 * [WP3] Aba Timeline (F3, §7.3): eventos do mais novo ao mais antigo, agrupados por mês/ano, paginados por
 * `p_antes` (a página nunca corta eventos do mesmo instante). Ator acima ou ao lado de quem consulta vem genérico (PAR-3).
 */
export default function AbaTimeline({ clienteId }: PropsAbaFicha) {
  const consulta = useInfiniteQuery({
    queryKey: chavesFunil.timeline(clienteId),
    queryFn: ({ pageParam }) => crmTimeline({ p_id: clienteId, p_antes: pageParam, p_limite: EVENTOS_POR_PAGINA }),
    initialPageParam: null as string | null,
    getNextPageParam: (ultima) => (ultima?.mais && ultima.itens.length ? ultima.itens[ultima.itens.length - 1].ocorrido_em : undefined),
  })

  if (consulta.isPending) return <Carregando />
  if (consulta.error) return <ErroConsulta erro={consulta.error} tentarDeNovo={consulta.refetch} />
  const paginas = consulta.data.pages
  if (paginas[0] == null) return <Vazio titulo="Sem acesso" texto="Este cliente não está no seu escopo." />
  const eventos = paginas.flatMap((p) => p?.itens ?? [])
  const grupos = agruparPorMes(eventos)

  return (
    <section aria-labelledby="titulo-timeline">
      <h3 id="titulo-timeline" className="mb-4 text-lg font-semibold">Timeline</h3>
      {grupos.length === 0 && <Vazio titulo="Nenhum evento" texto="Cadastro, etapas, notas, tarefas e documentos aparecem aqui." />}
      <div className="grid gap-8">
        {grupos.map((g) => (
          <section key={g.chave} aria-label={g.rotulo}>
            <h4 className="eyebrow mb-3">{g.rotulo}</h4>
            <ol className="relative grid gap-4 border-l border-line pl-6">
              {g.eventos.map((e) => {
                const Icone = ICONES[e.tipo] ?? History
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute top-0.5 -left-[2.1rem] flex size-6 items-center justify-center border border-line bg-ink text-bronze" aria-hidden>
                      <Icone size={13} />
                    </span>
                    <p className="text-sm font-semibold">{e.titulo}</p>
                    <Detalhe e={e} />
                    <p className="mt-1 text-xs text-muted">
                      {dataHora(e.ocorrido_em)} · {e.ator_nome ?? (e.tipo === 'tentativa_duplicada' ? 'Outro cadastro' : 'Sistema')}
                    </p>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
      {consulta.hasNextPage && (
        <button type="button" className="btn-ghost mt-6" disabled={consulta.isFetchingNextPage} onClick={() => void consulta.fetchNextPage()}>
          {consulta.isFetchingNextPage ? 'Carregando…' : 'Ver eventos mais antigos'}
        </button>
      )}
    </section>
  )
}

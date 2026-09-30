import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { AlarmClock, Clock, FileWarning, GripVertical, MessageCircle } from 'lucide-react'
import { ETAPAS } from '@/lib/constants'
import { dataHora, whatsappBR } from '@/lib/format'
import { textoDiasNaEtapa, type DestinoArraste } from '../funil'
import type { KanbanCartao } from '../tipos'

/**
 * Cartão do kanban (§7.3): nome (abre a ficha), WhatsApp, corretor (só para gestores e internos, o servidor manda nulo
 * para o próprio corretor), dias na etapa, documentos pendentes e tarefa atrasada. Arrasta por HTML5 nativo; o menu
 * "Mover para…" é o caminho acessível (teclado e leitor de tela) para os mesmos destinos.
 */
export function CartaoKanban({ cartao, base, destinos, movendo, aoMover, aoIniciarArrasto, aoTerminarArrasto }: {
  cartao: KanbanCartao
  base: string
  /** Destinos permitidos para quem está vendo (vazio = não arrasta). */
  destinos: DestinoArraste[]
  movendo: boolean
  aoMover: (d: DestinoArraste) => void
  aoIniciarArrasto: () => void
  aoTerminarArrasto: () => void
}) {
  const wa = whatsappBR(cartao.telefone)
  const arrastavel = destinos.length > 0 && !movendo
  return (
    <article
      draggable={arrastavel}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', cartao.id)
        e.dataTransfer.effectAllowed = 'move'
        aoIniciarArrasto()
      }}
      onDragEnd={aoTerminarArrasto}
      aria-label={cartao.nome}
      aria-busy={movendo || undefined}
      data-cartao={cartao.id}
      className={clsx('card p-3 transition', arrastavel && 'cursor-grab active:cursor-grabbing', movendo && 'opacity-60')}
    >
      <div className="flex items-start gap-2">
        {arrastavel && <GripVertical size={16} aria-hidden className="mt-0.5 shrink-0 text-muted" />}
        <div className="min-w-0 flex-1">
          <Link to={`${base}/crm/${cartao.id}`} className="block truncate font-semibold hover:text-bronze" draggable={false}>
            {cartao.nome}
          </Link>
          {cartao.corretor && <p className="truncate text-xs text-muted">{cartao.corretor.nome}</p>}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-stone/80">
        <span className="inline-flex items-center gap-1" title={`Na etapa desde ${dataHora(cartao.etapa_desde)}`}>
          <Clock size={13} aria-hidden /> {textoDiasNaEtapa(cartao.dias_na_etapa)}
        </span>
        {cartao.documentos_pendentes > 0 && (
          <span className="inline-flex items-center gap-1 text-bronze">
            <FileWarning size={13} aria-hidden />
            {cartao.documentos_pendentes === 1 ? '1 documento pendente' : `${cartao.documentos_pendentes} documentos pendentes`}
          </span>
        )}
        {cartao.tarefa_atrasada && (
          <span className="inline-flex items-center gap-1 text-perigo"><AlarmClock size={13} aria-hidden /> Tarefa atrasada</span>
        )}
      </div>

      {cartao.motivo_perda && <p className="mt-2 line-clamp-2 text-xs text-muted" title={cartao.motivo_perda}>Motivo: {cartao.motivo_perda}</p>}

      {(wa || destinos.length > 0) && (
        <div className="mt-3 flex items-center justify-between gap-2">
          {wa ? (
            <a
              href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" draggable={false}
              className="inline-flex items-center gap-1 text-xs text-sage hover:underline" aria-label={`WhatsApp de ${cartao.nome}`}
            >
              <MessageCircle size={14} aria-hidden /> WhatsApp
            </a>
          ) : <span />}
          {destinos.length > 0 && (
            <select
              aria-label={`Mover ${cartao.nome} para…`} value="" disabled={movendo}
              onChange={(e) => {
                const d = destinos.find((x) => x.para === e.target.value)
                if (d) aoMover(d)
              }}
              className="input w-auto max-w-40 px-2 py-1.5 text-xs"
            >
              <option value="">Mover para…</option>
              {destinos.map((d) => <option key={d.para} value={d.para}>{ETAPAS[d.para].rotulo}</option>)}
            </select>
          )}
        </div>
      )}
    </article>
  )
}

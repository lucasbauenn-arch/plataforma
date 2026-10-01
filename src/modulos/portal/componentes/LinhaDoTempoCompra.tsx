import clsx from 'clsx'
import { CalendarCheck } from 'lucide-react'
import { dataCalendario, ROTULOS_MARCO, situacaoMarco, textoMarco } from '../rotulos'
import type { PortalNegocioLinha } from '../tipos'

/**
 * "Linha do tempo da compra" de um negócio (portal_linha_do_tempo): Contrato assinado → Obra → Vistoria → Entrega das
 * chaves, com as datas previstas e realizadas que a equipe registra. Na obra, o último percentual publicado. Marcos
 * quadrados (cantos retos); concluído em sage, previsto em bronze, sem data em cinza.
 */
export function LinhaDoTempoCompra({ linha }: { linha: PortalNegocioLinha }) {
  return (
    <section aria-label={`Linha do tempo da compra: ${linha.titulo}`}>
      <h3 className="mb-4 flex items-center gap-2 font-semibold"><CalendarCheck size={18} className="text-bronze" aria-hidden /> Linha do tempo da compra</h3>
      <ol className="grid gap-4 sm:grid-cols-4 sm:gap-0">
        {linha.marcos.map((m, i) => {
          const situacao = situacaoMarco(m)
          return (
            <li key={m.tipo} className="relative flex gap-3 sm:flex-col sm:gap-2 sm:pr-4">
              {/* trilho entre os marcos (só no desktop) */}
              {i < linha.marcos.length - 1 && <span aria-hidden className="absolute left-3 top-3 hidden h-px w-full bg-line sm:block" />}
              <span
                aria-hidden
                className={clsx('relative z-10 mt-0.5 h-6 w-6 shrink-0 border-2',
                  situacao === 'concluido' ? 'border-sage bg-sage' : situacao === 'previsto' ? 'border-bronze bg-ink' : 'border-line bg-ink')}
              />
              <div className="min-w-0">
                <p className="font-semibold">{ROTULOS_MARCO[m.tipo]}</p>
                <p className={clsx('text-sm', situacao === 'concluido' ? 'text-sage' : situacao === 'previsto' ? 'text-stone' : 'text-muted')}>
                  {textoMarco(m)}
                </p>
                {m.data_realizada && m.data_prevista && m.data_prevista !== m.data_realizada && (
                  <p className="text-xs text-muted">Previsão: {dataCalendario(m.data_prevista)}</p>
                )}
                {m.tipo === 'obra' && linha.obra_percentual != null && (
                  <p className="text-xs text-muted">Andamento: {linha.obra_percentual}%</p>
                )}
                {m.observacao && <p className="mt-1 whitespace-pre-line text-xs text-stone/80">{m.observacao}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

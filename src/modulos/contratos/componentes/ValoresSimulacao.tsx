import { brlCentavos, percentual } from '@/lib/format'
import type { ValoresSimulacao as Valores } from '@shared/simulacao'

/** Valores da simulação (oficiais do servidor ou prévia). Resíduo e valor restante são informativos (N17, §3.6). */
export function ValoresSimulacao({ v, rotulo }: { v: Valores; rotulo?: string }) {
  const linhas: [string, string][] = [
    ['Valor do produto', brlCentavos(v.valor_imovel)],
    ['Aporte próprio', `${percentual(v.perc_aporte, 4)} · ${brlCentavos(v.valor_aporte)}`],
    ['Entrada', brlCentavos(v.valor_entrada)],
    ['Base parcelada', brlCentavos(v.base_parcelada)],
  ]
  if (v.n_parcelas != null) {
    linhas.push(['Parcelas', `${v.n_parcelas}× de ${brlCentavos(v.valor_parcela)}`])
    linhas.push(['Taxa do aporte', percentual(v.taxa_aporte, 4)])
    linhas.push(['Total das parcelas', brlCentavos(v.valor_total_parcelas)])
    if (v.residuo) linhas.push(['Resíduo de arredondamento', `${brlCentavos(v.residuo)} (ajustado na última parcela, etapa financeira)`])
  }
  if (v.valor_minimo_flex != null) linhas.push(['Mínimo por pagamento (flexível)', brlCentavos(v.valor_minimo_flex)])
  linhas.push(['Restante do valor (informativo)', brlCentavos(v.valor_restante)])
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" aria-label={rotulo}>
      {linhas.map(([k, val]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1.5">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right font-medium tabular-nums">{val}</dd>
        </div>
      ))}
    </dl>
  )
}

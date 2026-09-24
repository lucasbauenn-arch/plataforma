import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { brl } from '@/lib/format'
import { STATUS_PROPOSTA } from '@/lib/constants'
import { PERIODOS, ORIGEM_LABEL, type Relatorio, type ChavePeriodo } from '@/lib/relatorio'
import { BarrasMensal } from '@/components/charts/BarrasMensal'
import { Ranking } from '@/components/charts/Ranking'
import { BarraEmpilhada, type Segmento } from '@/components/charts/BarraEmpilhada'
import { EstoquePorEmpreendimento } from '@/components/charts/EstoquePorEmpreendimento'
import { Carregando } from '@/components/Estados'
import { Titulo } from './ui'

const CORES_PROPOSTA: Record<string, string> = { enviada: 'var(--color-sand)', em_analise: 'var(--color-bronze)', aprovada: 'var(--color-sage)', recusada: '#fca5a5' }

function Cartao({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <h2 className="font-semibold">{titulo}</h2>
      {subtitulo && <p className="mt-0.5 text-xs text-muted">{subtitulo}</p>}
      <div className="mt-5">{children}</div>
    </div>
  )
}

function Tile({ label, valor, delta }: { label: string; valor: number | string; delta?: number | null }) {
  return (
    <div className="card p-6">
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="display text-5xl">{valor}</p>
        {delta != null && Number.isFinite(delta) && (
          <span className={`mb-1.5 flex items-center gap-1 text-xs font-semibold ${delta >= 0 ? 'text-sage' : 'text-red-300'}`}>
            {delta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {Math.abs(delta)}%
          </span>
        )}
      </div>
    </div>
  )
}

export default function Relatorios() {
  const [periodo, setPeriodo] = useState<ChavePeriodo>('30d')
  const dias = PERIODOS.find((p) => p.chave === periodo)!.dias

  const { data: r, isLoading } = useQuery({
    queryKey: ['relatorio', periodo],
    queryFn: async () => {
      // calculado aqui (não no corpo do componente): roda na busca, não a cada render
      const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
      const { data, error } = await supabase.rpc('relatorio', { p_desde: desde })
      if (error) throw error
      return data as Relatorio
    },
  })

  const deltaLeads = r && r.leads_anterior > 0 ? Math.round(((r.leads - r.leads_anterior) / r.leads_anterior) * 100) : null
  const propostasTotal = r ? Object.values(r.propostas).reduce((s, n) => s + (n ?? 0), 0) : 0
  const segmentosProposta: Segmento[] = r
    ? (Object.keys(STATUS_PROPOSTA) as (keyof typeof STATUS_PROPOSTA)[]).map((k) => ({ chave: k, label: STATUS_PROPOSTA[k], valor: r.propostas[k] ?? 0, cor: CORES_PROPOSTA[k] }))
    : []

  return (
    <>
      <Titulo
        acao={
          <div className="flex gap-1 bg-ink-soft p-1 text-sm">
            {PERIODOS.map((p) => (
              <button key={p.chave} onClick={() => setPeriodo(p.chave)}
                className={`px-3 py-1.5 font-semibold ${periodo === p.chave ? 'bg-stone text-ink' : 'text-stone/70 hover:text-stone'}`}>
                {p.label}
              </button>
            ))}
          </div>
        }
      >
        Relatórios
      </Titulo>

      {isLoading || !r ? <Carregando /> : (
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label={`Leads (${PERIODOS.find((p) => p.chave === periodo)!.label.toLowerCase()})`} valor={r.leads} delta={deltaLeads} />
            <Tile label="Propostas no período" valor={propostasTotal} />
            <Tile label="Parceiros aguardando aprovação" valor={r.parceiros_pendentes} />
            <Tile label="Acessos ao portal do cliente" valor={r.acessos_portal} />
          </div>

          <Cartao titulo="Leads por mês" subtitulo="Últimos 12 meses, independente do período acima">
            <BarrasMensal dados={r.leads_mensal} />
          </Cartao>

          <div className="grid gap-6 lg:grid-cols-2">
            <Cartao titulo="Leads por empreendimento">
              <Ranking itens={r.leads_por_empreendimento.map((e) => ({ label: e.nome, valor: e.total }))} />
            </Cartao>
            <Cartao titulo="Origem dos leads">
              <Ranking itens={r.leads_por_origem.map((o) => ({ label: ORIGEM_LABEL[o.origem] ?? o.origem, valor: o.total }))} />
            </Cartao>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Cartao titulo="Propostas por status">
              <BarraEmpilhada segmentos={segmentosProposta} />
            </Cartao>
            <Cartao titulo="Parceiros mais ativos" subtitulo="Por propostas enviadas no período">
              <Ranking itens={r.parceiros_ranking.map((p) => ({ label: p.nome, valor: p.total, sub: p.aprovadas ? `${p.aprovadas} aprovada${p.aprovadas > 1 ? 's' : ''}` : undefined }))} />
            </Cartao>
          </div>

          <Cartao titulo="Estoque por empreendimento" subtitulo={`VGV disponível: ${brl(r.estoque.reduce((s, e) => s + e.vgv_disponivel, 0))}`}>
            <EstoquePorEmpreendimento itens={r.estoque} />
          </Cartao>
        </div>
      )}
    </>
  )
}

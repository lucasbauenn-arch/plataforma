import { useQuery } from '@tanstack/react-query'
import { useEscopo } from '@/lib/escopo'
import { BarraFiltros, CampoBusca, FiltroSelecao } from '@/components/app/Filtros'
import { SeletorParceiro } from '@/components/app/SeletorParceiro'
import { chavesFunil, listarImobiliarias } from '../api-funil'
import type { KanbanFiltros } from '../tipos'

/** Filtros que mudam; `null`/`''`/`false` = remover da URL. */
export type MudancaFiltros = Partial<Record<keyof KanbanFiltros, string | boolean | null>>

/**
 * Filtros do kanban conforme o papel (§7.3): busca por nome e período para todos; responsável (corretor) para
 * gerente, imobiliária e internos; gerente para imobiliária e internos; imobiliária só para internos; "só os meus"
 * para o gerente (clientes dele como corretor, A1). O servidor cruza tudo com o escopo: filtro nunca amplia.
 */
export function FiltrosKanban({ filtros, aoMudar }: { filtros: KanbanFiltros; aoMudar: (m: MudancaFiltros) => void }) {
  const { escopo } = useEscopo()
  const interno = !!escopo?.interno
  const tipo = escopo?.tipo ?? null
  const gestor = interno || tipo === 'gerente' || tipo === 'imobiliaria'
  const imobiliarias = useQuery({ queryKey: chavesFunil.imobiliarias, queryFn: listarImobiliarias, enabled: interno, staleTime: 5 * 60_000 })

  return (
    <BarraFiltros>
      <CampoBusca valor={filtros.busca ?? ''} aoMudar={(v) => aoMudar({ busca: v })} placeholder="Buscar por nome" rotulo="Buscar cliente por nome" />
      {interno && (
        <FiltroSelecao
          rotulo="Imobiliária" valor={filtros.imobiliaria_id ?? ''} aoMudar={(v) => aoMudar({ imobiliaria_id: v })} todos="Todas"
          opcoes={(imobiliarias.data ?? []).map((i) => ({ valor: i.id, rotulo: i.nome }))}
        />
      )}
      {(interno || tipo === 'imobiliaria') && (
        <label className="block min-w-48">
          <span className="label">Gerente</span>
          <SeletorParceiro
            tipos={['gerente']} valor={filtros.gerente_id} vazio="Todos" imobiliariaId={filtros.imobiliaria_id ?? undefined}
            aoMudar={(id) => aoMudar({ gerente_id: id })}
          />
        </label>
      )}
      {gestor && (
        <label className="block min-w-48">
          <span className="label">Responsável</span>
          <SeletorParceiro
            tipos={tipo === 'gerente' ? ['corretor'] : ['corretor', 'gerente']} valor={filtros.corretor_id} vazio="Todos"
            imobiliariaId={filtros.imobiliaria_id ?? undefined} gerenteId={tipo === 'gerente' ? undefined : filtros.gerente_id ?? undefined}
            aoMudar={(id) => aoMudar({ corretor_id: id })}
          />
        </label>
      )}
      {tipo === 'gerente' && (
        <label className="flex items-center gap-2 pb-3 text-sm">
          <input type="checkbox" checked={!!filtros.so_meus} onChange={(e) => aoMudar({ so_meus: e.target.checked })} className="size-4 accent-bronze" />
          Só os meus
        </label>
      )}
      <label className="block">
        <span className="label">Período de</span>
        <input type="date" className="input w-auto py-2.5" value={filtros.periodo_de ?? ''} max={filtros.periodo_ate ?? undefined}
          onChange={(e) => aoMudar({ periodo_de: e.target.value })} />
      </label>
      <label className="block">
        <span className="label">até</span>
        <input type="date" className="input w-auto py-2.5" value={filtros.periodo_ate ?? ''} min={filtros.periodo_de ?? undefined}
          onChange={(e) => aoMudar({ periodo_ate: e.target.value })} />
      </label>
    </BarraFiltros>
  )
}

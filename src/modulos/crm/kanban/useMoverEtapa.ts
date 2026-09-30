import { useMutation, useQueryClient } from '@tanstack/react-query'
import { crmMudarEtapa } from '@/lib/rpc'
import type { EtapaFunil, Uuid } from '@/lib/types'
import { chavesFunil } from '../api-funil'
import { moverCartao } from '../funil'
import { chaveFicha, type KanbanFiltros, type KanbanResultado } from '../tipos'

export interface PedidoMudanca { id: Uuid; para: EtapaFunil; motivo: string | null }

/**
 * `crm_mudar_etapa` com movimento otimista no kanban dos `filtros`: o cartão muda na hora e volta se o servidor
 * recusar. Quem chama mostra o erro (toast ou o próprio modal). No fim, recarrega o kanban (contadores) e a ficha.
 */
export function useMoverEtapa(filtros: KanbanFiltros) {
  const qc = useQueryClient()
  const chave = chavesFunil.kanban(filtros)
  return useMutation({
    mutationFn: ({ id, para, motivo }: PedidoMudanca) => crmMudarEtapa({ p_id: id, p_para: para, p_motivo: motivo }),
    onMutate: async ({ id, para, motivo }: PedidoMudanca) => {
      await qc.cancelQueries({ queryKey: chave })
      const antes = qc.getQueryData<KanbanResultado>(chave)
      if (antes) qc.setQueryData<KanbanResultado>(chave, moverCartao(antes, id, para, new Date().toISOString(), motivo))
      return { antes }
    },
    onError: (_erro, _pedido, contexto) => {
      if (contexto?.antes) qc.setQueryData(chave, contexto.antes)
    },
    onSettled: (_r, _e, pedido) => {
      void qc.invalidateQueries({ queryKey: chavesFunil.kanbanTodas })
      void qc.invalidateQueries({ queryKey: chaveFicha(pedido.id) })
      void qc.invalidateQueries({ queryKey: chavesFunil.timeline(pedido.id) })
      void qc.invalidateQueries({ queryKey: chavesFunil.documentos(pedido.id) })
    },
  })
}

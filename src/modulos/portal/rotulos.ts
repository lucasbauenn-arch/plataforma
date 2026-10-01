// Rótulos e regras de exibição da linha do tempo da compra e das solicitações do portal (migration 24). Módulo puro:
// sem React nem rede, para ser testado no Vitest.

import type { Tom } from '@/components/app/Etiqueta'
import type { PortalMarco, StatusSolicitacao, TipoMarco, TipoSolicitacao } from './tipos'

export const MARCOS: readonly TipoMarco[] = ['contrato_assinado', 'obra', 'vistoria', 'entrega_chaves']

export const ROTULOS_MARCO: Record<TipoMarco, string> = {
  contrato_assinado: 'Contrato assinado',
  obra: 'Obra',
  vistoria: 'Vistoria',
  entrega_chaves: 'Entrega das chaves',
}

export const ROTULOS_SOLICITACAO: Record<TipoSolicitacao, string> = {
  segunda_via_boleto: '2ª via de boleto',
  antecipacao_parcelas: 'Antecipação de parcelas',
  agendar_vistoria: 'Agendar vistoria',
  duvida_contrato: 'Dúvida sobre o contrato',
  outro: 'Outro assunto',
}

export const TIPOS_SOLICITACAO = Object.keys(ROTULOS_SOLICITACAO) as TipoSolicitacao[]

export const ROTULOS_STATUS_SOLICITACAO: Record<StatusSolicitacao, string> = {
  aberta: 'Aberta',
  em_atendimento: 'Em atendimento',
  concluida: 'Concluída',
}

export const TOM_STATUS_SOLICITACAO: Record<StatusSolicitacao, Tom> = {
  aberta: 'alerta',
  em_atendimento: 'destaque',
  concluida: 'ok',
}

/** Próximos status que a equipe pode escolher (concluída é final; em atendimento não volta para aberta). */
export function proximosStatus(atual: StatusSolicitacao): StatusSolicitacao[] {
  if (atual === 'aberta') return ['aberta', 'em_atendimento', 'concluida']
  if (atual === 'em_atendimento') return ['em_atendimento', 'concluida']
  return []
}

/** Tipos em que a mensagem é obrigatória. */
export const mensagemObrigatoria = (t: TipoSolicitacao) => t === 'outro'

export type SituacaoMarco = 'concluido' | 'previsto' | 'pendente'

/** Concluído (tem data realizada), previsto (só a prevista) ou pendente (sem data). */
export function situacaoMarco(m: Pick<PortalMarco, 'data_prevista' | 'data_realizada'>): SituacaoMarco {
  if (m.data_realizada) return 'concluido'
  if (m.data_prevista) return 'previsto'
  return 'pendente'
}

/** dd/mm/aaaa de uma data ISO (yyyy-mm-dd), sem fuso (é uma data de calendário). */
export function dataCalendario(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** Texto curto do marco para a tela ("Realizado em 20/09/2026", "Previsto para 10/03/2027", "Data a definir"). */
export function textoMarco(m: Pick<PortalMarco, 'data_prevista' | 'data_realizada'>): string {
  if (m.data_realizada) return `Realizado em ${dataCalendario(m.data_realizada)}`
  if (m.data_prevista) return `Previsto para ${dataCalendario(m.data_prevista)}`
  return 'Data a definir'
}

/** Número de exibição do pedido: nº 000042. */
export const numeroSolicitacao = (n: number) => `nº ${String(n).padStart(6, '0')}`

/** Chaves do TanStack Query do portal e da equipe (invalidadas depois de solicitar, atender ou salvar marcos). */
export const chavesPortal = {
  solicitacoes: ['portal', 'solicitacoes'] as const,
  solicitacoesEquipe: ['crm-portal-solicitacoes'] as const,
  marcosEquipe: (clienteId: string) => ['crm-portal-marcos', clienteId] as const,
}

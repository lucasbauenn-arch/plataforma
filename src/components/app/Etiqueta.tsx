import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  ETAPAS, STATUS_ASSINATURA, STATUS_CONTRATO, STATUS_DOCUMENTO, STATUS_IMOVEL, STATUS_LEAD, STATUS_PARCEIRO, STATUS_PROPOSTA,
  STATUS_TAREFA,
} from '@/lib/constants'
import type {
  EtapaFunil, StatusAssinatura, StatusContrato, StatusDocumento, StatusImovel, StatusLead, StatusParceiro, StatusProposta,
  StatusTarefa,
} from '@/lib/types'

export type Tom = 'neutro' | 'ok' | 'alerta' | 'erro' | 'destaque'

const CLASSES: Record<Tom, string> = {
  neutro: 'bg-sand text-stone',
  ok: 'bg-sage/15 text-sage',
  alerta: 'bg-bronze/15 text-bronze',
  erro: 'bg-perigo/15 text-perigo',
  destaque: 'bg-stone text-ink',
}

/** Etiqueta retangular de status ou categoria. */
export function Etiqueta({ tom = 'neutro', children, titulo }: { tom?: Tom; children: ReactNode; titulo?: string }) {
  return <span title={titulo} className={clsx('inline-block whitespace-nowrap px-2.5 py-0.5 text-xs font-semibold', CLASSES[tom])}>{children}</span>
}

type Selo =
  | { tipo: 'etapa'; valor: EtapaFunil }
  | { tipo: 'contrato'; valor: StatusContrato }
  | { tipo: 'documento'; valor: StatusDocumento }
  | { tipo: 'imovel'; valor: StatusImovel }
  | { tipo: 'tarefa'; valor: StatusTarefa; atrasada?: boolean }
  | { tipo: 'parceiro'; valor: StatusParceiro }
  | { tipo: 'lead'; valor: StatusLead }
  | { tipo: 'proposta'; valor: StatusProposta }
  | { tipo: 'assinatura'; valor: StatusAssinatura }

const TOM_ETAPA: Record<EtapaFunil, Tom> = { novo_contato: 'neutro', contato_iniciado: 'alerta', documentacao: 'alerta', finalizado: 'ok', perdido: 'erro' }
const TOM_CONTRATO: Record<StatusContrato, Tom> = {
  rascunho: 'neutro', documentacao_pendente: 'alerta', em_analise: 'alerta', assinatura_pendente: 'alerta', assinado: 'ok',
  recusado: 'erro', expirado: 'erro', cancelado: 'erro', arquivado: 'neutro',
}
const TOM_DOCUMENTO: Record<StatusDocumento, Tom> = { pendente: 'neutro', em_analise: 'alerta', aprovado: 'ok', rejeitado: 'erro' }
const TOM_IMOVEL: Record<StatusImovel, Tom> = { rascunho: 'neutro', pendente: 'alerta', em_revisao: 'alerta', aprovado: 'ok', no_contrato: 'destaque' }
const TOM_PARCEIRO: Record<StatusParceiro, Tom> = { pendente: 'alerta', aprovado: 'ok', bloqueado: 'erro', inativo: 'neutro' }
const TOM_LEAD: Record<StatusLead, Tom> = { novo: 'alerta', convertido: 'ok', descartado: 'neutro' }
const TOM_PROPOSTA: Record<StatusProposta, Tom> = { enviada: 'neutro', em_analise: 'alerta', aprovada: 'ok', recusada: 'erro' }
const TOM_ASSINATURA: Record<StatusAssinatura, Tom> = { pendente: 'alerta', assinado: 'ok', recusado: 'erro' }

function resolver(s: Selo): { rotulo: string; tom: Tom; codigo?: string | null } {
  switch (s.tipo) {
    case 'etapa': return { rotulo: ETAPAS[s.valor].rotulo, tom: TOM_ETAPA[s.valor], codigo: ETAPAS[s.valor].codigo }
    case 'contrato': return { rotulo: STATUS_CONTRATO[s.valor].rotulo, tom: TOM_CONTRATO[s.valor], codigo: STATUS_CONTRATO[s.valor].codigo }
    case 'documento': return { rotulo: STATUS_DOCUMENTO[s.valor].rotulo, tom: TOM_DOCUMENTO[s.valor], codigo: STATUS_DOCUMENTO[s.valor].codigo }
    case 'imovel': return { rotulo: STATUS_IMOVEL[s.valor].rotulo, tom: TOM_IMOVEL[s.valor], codigo: STATUS_IMOVEL[s.valor].codigo }
    case 'tarefa':
      return s.valor === 'pendente' && s.atrasada ? { rotulo: 'Atrasada', tom: 'erro' } : { rotulo: STATUS_TAREFA[s.valor], tom: s.valor === 'concluida' ? 'ok' : 'neutro' }
    case 'parceiro': return { rotulo: STATUS_PARCEIRO[s.valor], tom: TOM_PARCEIRO[s.valor] }
    case 'lead': return { rotulo: STATUS_LEAD[s.valor], tom: TOM_LEAD[s.valor] }
    case 'proposta': return { rotulo: STATUS_PROPOSTA[s.valor], tom: TOM_PROPOSTA[s.valor] }
    case 'assinatura': return { rotulo: STATUS_ASSINATURA[s.valor], tom: TOM_ASSINATURA[s.valor] }
  }
}

/** Selo de status com rótulo e cor padronizados (o código do legado vai no `title`). */
export function SeloStatus(props: Selo) {
  const { rotulo, tom, codigo } = resolver(props)
  return <Etiqueta tom={tom} titulo={codigo ? `Código ${codigo}` : undefined}>{rotulo}</Etiqueta>
}

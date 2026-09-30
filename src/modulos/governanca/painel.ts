// Cartões da visão geral a partir de `painel_resumo()` (docs/ARQUITETURA_EXPANSAO.md §7.4 admin/Dashboard). Módulo
// puro: cada seção nula (sem permissão) some; as contagens já vêm no escopo de quem consulta.

import type { PainelResumo } from './tipos'
import { ETAPAS, ORDEM_ETAPAS, STATUS_CONTRATO, STATUS_IMOVEL } from '@/lib/constants'
import type { StatusContrato, StatusImovel } from '@/lib/types'

export interface Cartao {
  id: string
  rotulo: string
  valor: number
  /** Rota do detalhe (relativa à base da área: '/admin' ou '/parceiros/painel'). */
  para: string
  /** Pede atenção (pendência com valor > 0). */
  destaque?: boolean
  detalhe?: string
}

export interface Grupo { id: string; titulo: string; cartoes: Cartao[] }

const soma = (o: Record<string, number> | null | undefined) => Object.values(o ?? {}).reduce((a, b) => a + (b || 0), 0)

const CONTRATOS_EM_ANDAMENTO: StatusContrato[] = ['rascunho', 'documentacao_pendente', 'em_analise', 'assinatura_pendente']

/** Grupos de cartões na ordem da tela. `base` = '/admin' ou '/parceiros/painel'. */
export function gruposDoPainel(r: PainelResumo, base: string): Grupo[] {
  const grupos: Grupo[] = []

  const pendencias: Cartao[] = []
  if (r.rede?.autocadastros_pendentes != null) {
    pendencias.push({ id: 'autocadastros', rotulo: 'Autocadastros aguardando aprovação', valor: r.rede.autocadastros_pendentes, para: `${base}/rede/pendentes`, destaque: r.rede.autocadastros_pendentes > 0 })
  }
  if (r.duplicidades_pendentes != null) {
    pendencias.push({ id: 'duplicidades', rotulo: 'Duplicidades para decidir', valor: r.duplicidades_pendentes, para: `${base}/duplicidades`, destaque: r.duplicidades_pendentes > 0 })
  }
  if (r.propostas) {
    const novas = r.propostas.por_status.enviada ?? 0
    pendencias.push({ id: 'propostas-novas', rotulo: 'Propostas novas', valor: novas, para: `${base}/propostas`, destaque: novas > 0 })
  }
  if (r.leads) pendencias.push({ id: 'leads-novos', rotulo: 'Leads do site sem tratamento', valor: r.leads.novos, para: `${base}/leads`, destaque: r.leads.novos > 0, detalhe: `${r.leads.total} no total` })
  if (r.migracao_pendencias != null) {
    pendencias.push({ id: 'migracao', rotulo: 'Pendências da migração', valor: r.migracao_pendencias, para: `${base}/migracao`, destaque: r.migracao_pendencias > 0 })
  }
  if (r.imoveis) {
    const revisar = (r.imoveis.por_status.pendente ?? 0) + (r.imoveis.por_status.em_revisao ?? 0)
    pendencias.push({ id: 'imoveis-revisao', rotulo: 'Imóveis aguardando revisão', valor: revisar, para: `${base}/imoveis`, destaque: revisar > 0 })
  }
  if (pendencias.length) grupos.push({ id: 'pendencias', titulo: 'Pendências', cartoes: pendencias })

  if (r.crm) {
    const c = r.crm
    grupos.push({
      id: 'crm', titulo: 'CRM',
      cartoes: [
        { id: 'crm-total', rotulo: 'Clientes ativos', valor: c.total, para: `${base}/crm/lista` },
        ...ORDEM_ETAPAS.map((e) => ({ id: `etapa-${e}`, rotulo: ETAPAS[e].rotulo, valor: c.por_etapa[e] ?? 0, para: `${base}/crm` })),
        { id: 'tarefas-atrasadas', rotulo: 'Tarefas atrasadas', valor: c.tarefas_atrasadas, para: `${base}/tarefas`, destaque: c.tarefas_atrasadas > 0, detalhe: `${c.tarefas_pendentes} pendentes` },
        { id: 'docs-analise', rotulo: 'Documentos para analisar', valor: c.documentos_em_analise, para: `${base}/crm/lista`, destaque: c.documentos_em_analise > 0 },
      ],
    })
  }

  if (r.contratos) {
    const ps = r.contratos.por_status
    const andamento = CONTRATOS_EM_ANDAMENTO.reduce((a, s) => a + (ps[s] ?? 0), 0)
    grupos.push({
      id: 'contratos', titulo: 'Contratos',
      cartoes: [
        { id: 'contratos-andamento', rotulo: 'Em andamento', valor: andamento, para: `${base}/contratos` },
        { id: 'contratos-assinatura', rotulo: STATUS_CONTRATO.assinatura_pendente.rotulo, valor: ps.assinatura_pendente ?? 0, para: `${base}/contratos` },
        { id: 'contratos-assinados', rotulo: STATUS_CONTRATO.assinado.rotulo, valor: ps.assinado ?? 0, para: `${base}/contratos` },
      ],
    })
  }

  if (r.imoveis) {
    const pi = r.imoveis.por_status
    grupos.push({
      id: 'imoveis', titulo: 'Imóveis',
      cartoes: (['rascunho', 'pendente', 'em_revisao', 'aprovado', 'no_contrato'] as StatusImovel[])
        .map((s) => ({ id: `imovel-${s}`, rotulo: STATUS_IMOVEL[s].rotulo, valor: pi[s] ?? 0, para: `${base}/imoveis` })),
    })
  }

  const outros: Cartao[] = []
  if (r.empreendimentos) {
    outros.push({ id: 'emp', rotulo: 'Empreendimentos publicados', valor: r.empreendimentos.publicados, para: base === '/admin' ? '/admin/empreendimentos' : base, detalhe: `${r.empreendimentos.unidades_disponiveis} unidades disponíveis` })
  }
  if (r.propostas) outros.push({ id: 'propostas', rotulo: 'Propostas', valor: soma(r.propostas.por_status), para: `${base}/propostas` })
  if (r.rede) {
    outros.push({ id: 'rede-corretores', rotulo: 'Corretores ativos', valor: r.rede.corretores, para: base === '/admin' ? '/admin/rede' : `${base}/equipe`, detalhe: `${r.rede.gerentes} gerente(s)` })
    if (base === '/admin') outros.push({ id: 'rede-imobiliarias', rotulo: 'Imobiliárias ativas', valor: r.rede.imobiliarias, para: '/admin/rede' })
  }
  if (outros.length) grupos.push({ id: 'geral', titulo: 'Geral', cartoes: outros })

  return grupos
}

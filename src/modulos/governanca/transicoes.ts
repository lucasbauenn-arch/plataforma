// Tela de transições (status_transicoes, §3.8): rótulos e quais papéis cada linha aceita. Módulo puro (testado em
// transicoes.test.ts), espelho das regras do gatilho _status_transicoes_valida (migration 08) para a tela não oferecer
// o que o banco recusaria — o banco continua sendo quem decide (23514 com a frase em pt-BR).

import { ETAPAS, PAPEIS, STATUS_CONTRATO, STATUS_DOCUMENTO, STATUS_IMOVEL } from '@/lib/constants'
import type { EntidadeTransicao, EtapaFunil, Papel, StatusContrato, StatusDocumento, StatusImovel } from '@/lib/types'
import type { StatusTransicao } from '@/modulos/config/tipos'

export const ENTIDADES: { id: EntidadeTransicao; rotulo: string }[] = [
  { id: 'cliente_etapa', rotulo: 'Etapas do funil (CRM)' },
  { id: 'documento', rotulo: 'Documentos' },
  { id: 'contrato', rotulo: 'Contratos' },
  { id: 'imovel', rotulo: 'Imóveis' },
]

export function rotuloStatus(entidade: EntidadeTransicao, s: string): string {
  switch (entidade) {
    case 'cliente_etapa': return ETAPAS[s as EtapaFunil]?.rotulo ?? s
    case 'documento': return STATUS_DOCUMENTO[s as StatusDocumento]?.rotulo ?? s
    case 'contrato': return STATUS_CONTRATO[s as StatusContrato]?.rotulo ?? s
    case 'imovel': return STATUS_IMOVEL[s as StatusImovel]?.rotulo ?? s
  }
}

const INTERNOS: Papel[] = ['super', 'admin']
const PARCEIROS: Papel[] = ['imobiliaria', 'gerente', 'corretor', 'parceiro']

/** Transições que dependem do D4Sign ou do envio: só o sistema aciona (o gatilho recusa qualquer papel). */
export function soDoSistema(t: Pick<StatusTransicao, 'entidade' | 'de' | 'para'>): boolean {
  if (t.entidade === 'contrato') return ['assinatura_pendente', 'assinado', 'recusado', 'expirado'].includes(t.para)
  if (t.entidade === 'imovel') return t.de === 'no_contrato' || t.para === 'no_contrato'
  return false
}

/** Papéis que a linha aceita (colaborador nunca; cliente só no envio de documento; saída de assinatura só internos). */
export function papeisPermitidos(t: Pick<StatusTransicao, 'entidade' | 'de' | 'para'>): Papel[] {
  if (soDoSistema(t)) return []
  if (t.entidade === 'contrato' && t.de === 'assinatura_pendente') return INTERNOS
  const lista = [...INTERNOS, ...PARCEIROS]
  if (t.entidade === 'documento' && t.para === 'em_analise') lista.push('cliente')
  return lista
}

export const rotuloPapel = (p: Papel) => PAPEIS[p]

/** Linhas de uma entidade na ordem de `de` e `para`. */
export function linhasDaEntidade(ts: readonly StatusTransicao[], entidade: EntidadeTransicao): StatusTransicao[] {
  return ts.filter((t) => t.entidade === entidade).sort((a, b) => a.de.localeCompare(b.de) || a.para.localeCompare(b.para))
}

const ROTULOS_VALIDACAO: Record<string, string> = {
  contrato_assinado: 'contrato assinado', campos_obrigatorios_imovel: 'campos obrigatórios do imóvel', pdf_gerado: 'PDF gerado',
  signatarios_configurados: 'signatários configurados', vendedora_configurada: 'dados da vendedora', modelo_liberado: 'modelo liberado',
  email_cliente: 'e-mail do cliente', valor_produto_atual: 'valor do produto atual', arquivo_enviado: 'arquivo enviado',
}
const ROTULOS_EFEITO: Record<string, string> = {
  solicitar_documentos_basicos: 'solicita os documentos básicos', limpar_motivo_perda: 'limpa o motivo da perda',
  notificar_documento_rejeitado: 'avisa o cliente da rejeição', imovel_no_contrato: 'imóvel vai para "No contrato"',
  imovel_aprovado: 'imóvel volta para "Aprovado"', cliente_finalizado: 'cliente vai para Finalizado',
  evento_contrato_assinado: 'registra o evento de contrato assinado',
}
export const rotuloValidacao = (v: string) => ROTULOS_VALIDACAO[v] ?? v.replace(/_/g, ' ')
export const rotuloEfeito = (v: string) => ROTULOS_EFEITO[v] ?? v.replace(/_/g, ' ')

import { describe, expect, it } from 'vitest'
import {
  dataCalendario, MARCOS, mensagemObrigatoria, numeroSolicitacao, proximosStatus, ROTULOS_MARCO, situacaoMarco, textoMarco,
  TIPOS_SOLICITACAO,
} from './rotulos'

describe('linha do tempo da compra', () => {
  it('quatro marcos na ordem da compra', () => {
    expect(MARCOS.map((m) => ROTULOS_MARCO[m])).toEqual(['Contrato assinado', 'Obra', 'Vistoria', 'Entrega das chaves'])
  })

  it('situação e texto de cada marco', () => {
    expect(situacaoMarco({ data_prevista: '2027-03-10', data_realizada: '2027-03-12' })).toBe('concluido')
    expect(situacaoMarco({ data_prevista: '2027-03-10', data_realizada: null })).toBe('previsto')
    expect(situacaoMarco({ data_prevista: null, data_realizada: null })).toBe('pendente')
    expect(textoMarco({ data_prevista: '2027-03-10', data_realizada: '2026-09-20' })).toBe('Realizado em 20/09/2026')
    expect(textoMarco({ data_prevista: '2027-03-10', data_realizada: null })).toBe('Previsto para 10/03/2027')
    expect(textoMarco({ data_prevista: null, data_realizada: null })).toBe('Data a definir')
  })

  it('data de calendário sem fuso (nunca "volta um dia")', () => {
    expect(dataCalendario('2027-01-01')).toBe('01/01/2027')
    expect(dataCalendario(null)).toBe('')
    expect(dataCalendario('lixo')).toBe('')
  })
})

describe('solicitações do portal', () => {
  it('cinco tipos, mensagem obrigatória só em "outro"', () => {
    expect(TIPOS_SOLICITACAO).toEqual(['segunda_via_boleto', 'antecipacao_parcelas', 'agendar_vistoria', 'duvida_contrato', 'outro'])
    expect(TIPOS_SOLICITACAO.filter(mensagemObrigatoria)).toEqual(['outro'])
  })

  it('status: concluída é final e em atendimento não volta para aberta (mesma regra do servidor)', () => {
    expect(proximosStatus('aberta')).toEqual(['aberta', 'em_atendimento', 'concluida'])
    expect(proximosStatus('em_atendimento')).toEqual(['em_atendimento', 'concluida'])
    expect(proximosStatus('concluida')).toEqual([])
  })

  it('número de exibição', () => {
    expect(numeroSolicitacao(42)).toBe('nº 000042')
  })
})

import { describe, expect, it } from 'vitest'
import { linhasDaEntidade, papeisPermitidos, rotuloStatus, soDoSistema } from './transicoes'
import type { StatusTransicao } from '@/modulos/config/tipos'

const t = (entidade: StatusTransicao['entidade'], de: string, para: string): StatusTransicao => ({
  entidade, de, para, papeis: [], permite_criador: false, sistema: false, exige_motivo: false, validacoes: [], efeitos: [],
  ativa: true, atualizado_em: '2026-09-29T00:00:00Z', atualizado_por: null,
})

describe('transições na tela', () => {
  it('só o sistema: envio e retorno do D4Sign, imóvel no contrato', () => {
    expect(soDoSistema(t('contrato', 'em_analise', 'assinatura_pendente'))).toBe(true)
    expect(soDoSistema(t('contrato', 'assinatura_pendente', 'assinado'))).toBe(true)
    expect(soDoSistema(t('imovel', 'aprovado', 'no_contrato'))).toBe(true)
    expect(soDoSistema(t('imovel', 'no_contrato', 'aprovado'))).toBe(true)
    expect(soDoSistema(t('cliente_etapa', 'novo_contato', 'contato_iniciado'))).toBe(false)
    expect(papeisPermitidos(t('contrato', 'assinatura_pendente', 'assinado'))).toEqual([])
  })

  it('cliente só no envio de documento; nunca colaborador', () => {
    expect(papeisPermitidos(t('documento', 'pendente', 'em_analise'))).toContain('cliente')
    expect(papeisPermitidos(t('documento', 'em_analise', 'aprovado'))).not.toContain('cliente')
    for (const x of [t('cliente_etapa', 'novo_contato', 'perdido'), t('documento', 'pendente', 'em_analise')]) {
      expect(papeisPermitidos(x)).not.toContain('colaborador')
    }
  })

  it('saída de assinatura_pendente (cancelar): só internos', () => {
    expect(papeisPermitidos(t('contrato', 'assinatura_pendente', 'cancelado'))).toEqual(['super', 'admin'])
  })

  it('rótulos e ordem', () => {
    expect(rotuloStatus('cliente_etapa', 'novo_contato')).toBe('Novo contato')
    expect(rotuloStatus('imovel', 'desconhecido')).toBe('desconhecido')
    const ls = linhasDaEntidade([t('imovel', 'b', 'a'), t('cliente_etapa', 'x', 'y'), t('imovel', 'a', 'b')], 'imovel')
    expect(ls.map((x) => `${x.de}>${x.para}`)).toEqual(['a>b', 'b>a'])
  })
})

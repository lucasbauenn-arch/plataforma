import { describe, expect, it } from 'vitest'
import { CAMPOS_CONFIG, formDaConfig, mudancasDaConfig } from './configuracao'
import type { ConfiguracaoGeral } from '@/modulos/config/tipos'

const atual: ConfiguracaoGeral = {
  id: true, imobiliaria_casa_id: 'i', gerente_casa_id: 'g', corretor_casa_id: 'c',
  exclusividade_dias: 90, duplicidade_bloqueios_hora: 10,
  documentos_basicos: ['CPF', 'CNH', 'Comprovante de residência', 'Comprovante de renda'],
  documento_max_bytes: 5242880, portal_libera_pre_cadastro: false,
  vendedora_razao_social: null, vendedora_cnpj: null, vendedora_endereco: null, prazo_assinatura_dias: null,
  imovel_fotos_max: 20, imovel_foto_max_bytes: 5242880,
  exigir_mfa_interno: false, sessao_inatividade_horas: 8, retencao_acesso_meses: 24, retencao_operacao_meses: 60,
  download_ttl_segundos: 60, criado_em: '2026-09-29T00:00:00Z', atualizado_em: null, atualizado_por: null,
}

describe('configurações gerais', () => {
  it('não edita os ids da casa nem o carimbo', () => {
    const chaves = CAMPOS_CONFIG.map((c) => c.chave as string)
    for (const proibida of ['id', 'imobiliaria_casa_id', 'gerente_casa_id', 'corretor_casa_id', 'criado_em', 'atualizado_em', 'atualizado_por']) {
      expect(chaves).not.toContain(proibida)
    }
  })

  it('formulário sem mudança: nada a enviar', () => {
    expect(mudancasDaConfig(atual, formDaConfig(atual))).toEqual({ ok: true, mudancas: {} })
  })

  it('só as chaves alteradas, convertidas', () => {
    const f = formDaConfig(atual)
    f.exclusividade_dias = '120'
    f.vendedora_cnpj = '11.222.333/0001-81'
    f.vendedora_razao_social = '  Arken Incorporadora Ltda  '
    f.documentos_basicos = 'CPF\n\n RG \n'
    f.documento_max_bytes = '2,5'
    f.exigir_mfa_interno = true
    expect(mudancasDaConfig(atual, f)).toEqual({
      ok: true,
      mudancas: {
        exclusividade_dias: 120, vendedora_cnpj: '11222333000181', vendedora_razao_social: 'Arken Incorporadora Ltda',
        documentos_basicos: ['CPF', 'RG'], documento_max_bytes: 2621440, exigir_mfa_interno: true,
      },
    })
  })

  it('erros por campo, com os limites da tabela', () => {
    const f = formDaConfig(atual)
    f.exclusividade_dias = '0'
    f.retencao_acesso_meses = '3'
    f.vendedora_cnpj = '11.222.333/0001-00'
    f.documentos_basicos = 'CPF\ncpf'
    f.sessao_inatividade_horas = ''
    f.documento_max_bytes = '6'
    const r = mudancasDaConfig(atual, f)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(Object.keys(r.erros).sort()).toEqual(['documento_max_bytes', 'documentos_basicos', 'exclusividade_dias', 'retencao_acesso_meses', 'sessao_inatividade_horas', 'vendedora_cnpj'])
      expect(r.erros.vendedora_cnpj).toBe('CNPJ inválido')
    }
  })

  it('opcional vazio vira nulo (sem mudança quando já era nulo)', () => {
    const f = formDaConfig({ ...atual, prazo_assinatura_dias: 30 })
    f.prazo_assinatura_dias = ''
    expect(mudancasDaConfig({ ...atual, prazo_assinatura_dias: 30 }, f)).toEqual({ ok: true, mudancas: { prazo_assinatura_dias: null } })
  })

  it('formato de exibição', () => {
    const f = formDaConfig({ ...atual, vendedora_cnpj: '11222333000181' })
    expect(f.vendedora_cnpj).toBe('11.222.333/0001-81')
    expect(f.documento_max_bytes).toBe('5')
    expect(f.documentos_basicos).toBe('CPF\nCNH\nComprovante de residência\nComprovante de renda')
  })
})

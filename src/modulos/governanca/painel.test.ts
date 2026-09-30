import { describe, expect, it } from 'vitest'
import { gruposDoPainel } from './painel'
import type { PainelResumo } from './tipos'

const vazio: PainelResumo = {
  papel: 'corretor', empreendimentos: null, crm: null, contratos: null, imoveis: null, propostas: null, rede: null, leads: null,
  duplicidades_pendentes: null, migracao_pendencias: null,
}

const completo: PainelResumo = {
  papel: 'admin',
  empreendimentos: { publicados: 4, unidades_disponiveis: 30 },
  crm: {
    total: 10, por_etapa: { novo_contato: 4, contato_iniciado: 3, documentacao: 2, finalizado: 1, perdido: 0 },
    tarefas_pendentes: 5, tarefas_atrasadas: 2, documentos_em_analise: 1,
  },
  contratos: { por_status: { rascunho: 1, em_analise: 1, assinatura_pendente: 2, assinado: 3 } },
  imoveis: { por_status: { pendente: 1, em_revisao: 1, aprovado: 5 } },
  propostas: { por_status: { enviada: 2, em_analise: 1, aprovada: 0, recusada: 1 } },
  rede: { imobiliarias: 3, gerentes: 4, corretores: 12, autocadastros_pendentes: 1 },
  leads: { novos: 6, total: 20 },
  duplicidades_pendentes: 0,
  migracao_pendencias: 2,
}

describe('cartões da visão geral', () => {
  it('sem permissões, sem grupos', () => {
    expect(gruposDoPainel(vazio, '/admin')).toEqual([])
  })

  it('grupos na ordem e pendências em destaque', () => {
    const g = gruposDoPainel(completo, '/admin')
    expect(g.map((x) => x.id)).toEqual(['pendencias', 'crm', 'contratos', 'imoveis', 'geral'])
    const pend = g[0].cartoes
    expect(pend.map((c) => c.id)).toEqual(['autocadastros', 'duplicidades', 'propostas-novas', 'leads-novos', 'migracao', 'imoveis-revisao'])
    expect(pend.find((c) => c.id === 'duplicidades')?.destaque).toBe(false)
    expect(pend.find((c) => c.id === 'migracao')).toMatchObject({ valor: 2, destaque: true, para: '/admin/migracao' })
    expect(pend.find((c) => c.id === 'imoveis-revisao')?.valor).toBe(2)
  })

  it('contratos em andamento somam os status ativos antes da assinatura', () => {
    const c = gruposDoPainel(completo, '/admin').find((x) => x.id === 'contratos')!
    expect(c.cartoes[0]).toMatchObject({ id: 'contratos-andamento', valor: 4 })
    expect(c.cartoes[2]).toMatchObject({ id: 'contratos-assinados', valor: 3 })
  })

  it('status ausente conta zero', () => {
    const i = gruposDoPainel(completo, '/admin').find((x) => x.id === 'imoveis')!
    expect(i.cartoes.find((c) => c.id === 'imovel-no_contrato')?.valor).toBe(0)
  })

  it('links na área do painel de parceiros', () => {
    const g = gruposDoPainel({ ...completo, papel: 'gerente', leads: null, migracao_pendencias: null, duplicidades_pendentes: null,
      rede: { imobiliarias: 1, gerentes: 1, corretores: 2, autocadastros_pendentes: null } }, '/parceiros/painel')
    expect(g[0].cartoes.map((c) => c.id)).toEqual(['propostas-novas', 'imoveis-revisao'])
    const geral = g.find((x) => x.id === 'geral')!
    expect(geral.cartoes.find((c) => c.id === 'rede-corretores')?.para).toBe('/parceiros/painel/equipe')
    expect(geral.cartoes.find((c) => c.id === 'rede-imobiliarias')).toBeUndefined()
  })
})

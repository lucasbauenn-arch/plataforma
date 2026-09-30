import { describe, expect, it } from 'vitest'
import { alteracoes, FILTROS_VAZIOS, formatarValor, montarFiltros, rotuloAcao, rotuloOrigem } from './auditoria'

describe('filtros da auditoria', () => {
  it('vazio: nenhum filtro', () => {
    expect(montarFiltros(FILTROS_VAZIOS)).toEqual({ ok: true, filtros: {} })
  })

  it('só as chaves preenchidas, aparadas', () => {
    const r = montarFiltros({
      ...FILTROS_VAZIOS, categoria: 'acesso', acao: ' consultar ', entidade: 'Clientes', de: '2026-09-01', ate: '2026-09-30',
      cliente_id: ' D0000000-0000-4000-8000-000000000001 ',
    })
    expect(r).toEqual({
      ok: true,
      filtros: { categoria: 'acesso', acao: 'consultar', entidade: 'clientes', de: '2026-09-01', ate: '2026-09-30', cliente_id: 'd0000000-0000-4000-8000-000000000001' },
    })
  })

  it('recusa o que o servidor recusaria', () => {
    expect(montarFiltros({ ...FILTROS_VAZIOS, categoria: 'outra' })).toMatchObject({ ok: false })
    expect(montarFiltros({ ...FILTROS_VAZIOS, acao: 'drop table' })).toMatchObject({ ok: false })
    expect(montarFiltros({ ...FILTROS_VAZIOS, entidade: 'clientes; --' })).toMatchObject({ ok: false })
    expect(montarFiltros({ ...FILTROS_VAZIOS, cliente_id: 'abc' })).toEqual({ ok: false, erro: 'ID do cliente inválido.' })
    expect(montarFiltros({ ...FILTROS_VAZIOS, ator_id: '123' })).toEqual({ ok: false, erro: 'ID de quem agiu inválido.' })
    expect(montarFiltros({ ...FILTROS_VAZIOS, de: '2026-09-10', ate: '2026-09-01' })).toEqual({ ok: false, erro: 'A data final é anterior à inicial.' })
    expect(montarFiltros({ ...FILTROS_VAZIOS, de: '10/09/2026' })).toMatchObject({ ok: false })
  })

  it('entidade_id livre é aceito (o servidor registra só "true")', () => {
    expect(montarFiltros({ ...FILTROS_VAZIOS, entidade_id: '42' })).toEqual({ ok: true, filtros: { entidade_id: '42' } })
  })
})

describe('exibição', () => {
  it('rótulos de ação e origem', () => {
    expect(rotuloAcao('acesso_negado')).toBe('Acesso negado')
    expect(rotuloAcao('algo_novo')).toBe('algo novo')
    expect(rotuloOrigem('edge:lgpd-anonimizar')).toBe('Função lgpd-anonimizar')
    expect(rotuloOrigem('webhook:d4sign')).toBe('Webhook d4sign')
    expect(rotuloOrigem('cron')).toBe('Rotina agendada')
  })

  it('valores', () => {
    expect(formatarValor(null)).toBe('—')
    expect(formatarValor(true)).toBe('sim')
    expect(formatarValor(1500)).toBe('1.500')
    expect(formatarValor(['a'])).toBe('["a"]')
  })

  it('alterações juntam campos, antes e depois', () => {
    expect(alteracoes({ campos: ['papel'], antes: { papel: 'admin' }, depois: { papel: 'super' } }))
      .toEqual([{ campo: 'papel', antes: 'admin', depois: 'super' }])
    expect(alteracoes({ campos: ['cpf', 'email'], antes: null, depois: null }))
      .toEqual([{ campo: 'cpf', antes: null, depois: null }, { campo: 'email', antes: null, depois: null }])
    expect(alteracoes({ campos: null, antes: null, depois: null })).toEqual([])
  })
})

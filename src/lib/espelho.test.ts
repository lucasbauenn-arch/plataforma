import { describe, expect, it } from 'vitest'
import { chaveUnidade, lerEspelhoVendas, numeroBR, planejarImportacao, type UnidadeCadastrada } from './espelho'

describe('numeroBR', () => {
  it.each([
    ['R$ 280.000,00', 280000],
    ['280.000', 280000],
    ['1.250.000,50', 1250000.5],
    ['52,5', 52.5],
    ['52.50', 52.5],
    ['52', 52],
    ['', null],
    ['—', null],
  ])('%s → %s', (entrada, esperado) => expect(numeroBR(entrada)).toBe(esperado))
})

describe('lerEspelhoVendas', () => {
  it('Excel pt-BR com ";" e decimais com vírgula (antes quebrava as colunas)', () => {
    const csv = 'Unidade;Metragem;Valor;Status\nAPTO 01;52,5;R$ 280.000,00;disponível\nAPTO 02;55,0;295.000;Vendida\n'
    expect(lerEspelhoVendas(csv)).toEqual([
      { identificador: 'APTO 01', metragem: 52.5, valor: 280000, status: 'disponivel', statusInformado: true, statusDesconhecido: false },
      { identificador: 'APTO 02', metragem: 55, valor: 295000, status: 'vendida', statusInformado: true, statusDesconhecido: false },
    ])
  })
  it('CSV com vírgula e aspas', () => {
    const csv = '"unidade","metragem","valor","status"\n"101","45.3","250000","reservada"'
    expect(lerEspelhoVendas(csv)).toEqual([
      { identificador: '101', metragem: 45.3, valor: 250000, status: 'reservada', statusInformado: true, statusDesconhecido: false },
    ])
  })
  it('colado de planilha (TAB), status desconhecido vira disponível (sem valer para unidade existente) e linhas vazias somem', () => {
    const tsv = 'APTO 11\t40\t199.900\tbloqueada\n\n\nAPTO 12\t41\t\t'
    expect(lerEspelhoVendas(tsv)).toEqual([
      { identificador: 'APTO 11', metragem: 40, valor: 199900, status: 'disponivel', statusInformado: false, statusDesconhecido: true },
      { identificador: 'APTO 12', metragem: 41, valor: null, status: 'disponivel', statusInformado: false, statusDesconhecido: false },
    ])
  })
})

const cad = (id: string, identificador: string, extra: Partial<UnidadeCadastrada> = {}): UnidadeCadastrada =>
  ({ id, identificador, metragem: 50, valor: 300000, status: 'disponivel', ...extra })

describe('chaveUnidade', () => {
  it('ignora acento, caixa e espaços repetidos', () => {
    expect(chaveUnidade('  apto   01 ')).toBe('APTO 01')
    expect(chaveUnidade('Cobertura Nº 1')).toBe(chaveUnidade('COBERTURA Nº 1'))
    expect(chaveUnidade('Térreo 2')).toBe('TERREO 2')
  })
})

describe('planejarImportacao (FUX-01: nunca apaga, nunca duplica)', () => {
  it('unidade que já existe é atualizada por id (mesmo sob contrato); só o que muda vai no UPDATE', () => {
    const plano = planejarImportacao(
      lerEspelhoVendas('APTO 01;50;R$ 320.000,00;vendida\nAPTO 02;52;300000;disponível'),
      [cad('u1', 'APTO 01'), cad('u2', 'APTO 02', { metragem: 52 })],
    )
    expect(plano.criar).toEqual([])
    expect(plano.atualizar).toEqual([{ id: 'u1', identificador: 'APTO 01', campos: { valor: 320000, status: 'vendida' } }])
    expect(plano.semMudanca).toBe(1)
    expect(plano.foraDoArquivo).toBe(0)
  })

  it('nome com outra caixa ou espaços casa com a unidade existente (não cria uma cópia)', () => {
    const plano = planejarImportacao(lerEspelhoVendas('apto  01;50;300000;disponível'), [cad('u1', 'APTO 01')])
    expect(plano.criar).toEqual([])
    expect(plano.atualizar).toEqual([])
    expect(plano.semMudanca).toBe(1)
  })

  it('unidade nova é criada; a que só existe no cadastro é mantida e contada (nunca apagada)', () => {
    const plano = planejarImportacao(lerEspelhoVendas('APTO 03;60;400000;reservada'), [cad('u1', 'APTO 01'), cad('u2', 'APTO 02')])
    expect(plano.criar).toEqual([{ identificador: 'APTO 03', metragem: 60, valor: 400000, status: 'reservada' }])
    expect(plano.atualizar).toEqual([])
    expect(plano.foraDoArquivo).toBe(2)
  })

  it('célula vazia e status ausente ou desconhecido não apagam nem trocam o dado atual', () => {
    const plano = planejarImportacao(
      lerEspelhoVendas('APTO 01;;;\nAPTO 02;;;bloqueada'),
      [cad('u1', 'APTO 01', { status: 'vendida' }), cad('u2', 'APTO 02', { status: 'reservada' })],
    )
    expect(plano.atualizar).toEqual([])
    expect(plano.semMudanca).toBe(2)
    expect(plano.statusNaoReconhecido).toBe(1)
  })

  it('status desconhecido de unidade nova entra como disponível', () => {
    const plano = planejarImportacao(lerEspelhoVendas('APTO 09;40;200000;bloqueada'), [])
    expect(plano.criar).toEqual([{ identificador: 'APTO 09', metragem: 40, valor: 200000, status: 'disponivel' }])
  })

  it('nome repetido no arquivo recusa a importação inteira (nada é planejado)', () => {
    const plano = planejarImportacao(lerEspelhoVendas('APTO 01;50;1;disponível\nApto 01;51;2;vendida\nAPTO 02;50;1;disponível'), [cad('u2', 'APTO 02')])
    expect(plano.repetidasNoArquivo).toEqual(['APTO 01', 'Apto 01'])
    expect(plano.criar).toEqual([])
    expect(plano.atualizar).toEqual([])
  })

  it('nome que casa com duas unidades do cadastro (duplicadas de antes) não é tocado', () => {
    const plano = planejarImportacao(
      lerEspelhoVendas('APTO 01;50;999999;vendida\nAPTO 02;50;300000;disponível'),
      [cad('u1', 'APTO 01'), cad('u1b', 'APTO 01', { status: 'vendida' }), cad('u2', 'APTO 02')],
    )
    expect(plano.ambiguas).toEqual(['APTO 01'])
    expect(plano.atualizar).toEqual([])
    expect(plano.criar).toEqual([])
    expect(plano.foraDoArquivo).toBe(0)
  })

  it('diferença de centavos por arredondamento não gera UPDATE', () => {
    const plano = planejarImportacao(lerEspelhoVendas('APTO 01;52,5;300000,001;disponível'), [cad('u1', 'APTO 01', { metragem: 52.5 })])
    expect(plano.atualizar).toEqual([])
    expect(plano.semMudanca).toBe(1)
  })
})

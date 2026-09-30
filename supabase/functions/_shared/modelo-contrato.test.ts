// Marcação restrita "marcacao_v1" (§6.3): análise, variáveis, formatação e bloqueio de documento incompleto.
import { describe, expect, it } from 'vitest'
import {
  analisarInline, analisarMarcacao, codigoContrato, DADOS_EXEMPLO, dataPorExtenso, formatarVariavel, mascaraCpfCnpj,
  renderizarModelo, ROTULOS_VARIAVEIS, textoPlano, validarModelo, VARIAVEIS_DO_CLIENTE, VARIAVEIS_MODELO, variavelPermitida,
} from './modelo-contrato.ts'

describe('lista de variáveis', () => {
  it('são as 32 da §6.3 (as 12 da doc + as acrescentadas), iguais às do gatilho da migration 07', () => {
    expect(VARIAVEIS_MODELO).toHaveLength(32)
    for (const v of ['codigo', 'nome', 'sobrenome', 'cpf-cnpj', 'logradouro', 'numero', 'bairro', 'cidade', 'estado', 'cep',
      'valor-propriedade', 'valor-parcela']) expect(variavelPermitida(v)).toBe(true)
    expect(variavelPermitida('senha')).toBe(false)
    expect(Object.keys(ROTULOS_VARIAVEIS).sort()).toEqual([...VARIAVEIS_MODELO].sort())
    expect(Object.keys(DADOS_EXEMPLO).sort()).toEqual([...VARIAVEIS_MODELO].sort())
    expect(VARIAVEIS_DO_CLIENTE.every(variavelPermitida)).toBe(true)
  })
})

describe('análise da marcação', () => {
  it('títulos, parágrafos, listas e quebra de página', () => {
    const blocos = analisarMarcacao([
      '# Título', '', 'Linha um', 'continua aqui.', '', '## Seção 2', '- item a', '- item b', '', '3. três', '4) quatro',
      '---', '### Fim',
    ].join('\n'))
    expect(blocos.map((b) => b.tipo)).toEqual(['titulo', 'paragrafo', 'titulo', 'lista', 'lista', 'quebra_pagina', 'titulo'])
    expect(blocos[1]).toEqual({ tipo: 'paragrafo', conteudo: [{ tipo: 'texto', texto: 'Linha um continua aqui.' }] })
    expect(blocos[3]).toMatchObject({ tipo: 'lista', ordenada: false, inicio: 1 })
    expect(blocos[4]).toMatchObject({ tipo: 'lista', ordenada: true, inicio: 3 })
    expect(blocos[6]).toMatchObject({ tipo: 'titulo', nivel: 3 })
  })

  it('quatro # não é título; CRLF é aceito', () => {
    expect(analisarMarcacao('#### não é título\r\n')[0].tipo).toBe('paragrafo')
  })

  it('negrito, itálico, escapes e marcador sem par', () => {
    expect(analisarInline('a **b** c *d* \\*e\\* f * g')).toEqual([
      { tipo: 'texto', texto: 'a ' },
      { tipo: 'negrito', filhos: [{ tipo: 'texto', texto: 'b' }] },
      { tipo: 'texto', texto: ' c ' },
      { tipo: 'italico', filhos: [{ tipo: 'texto', texto: 'd' }] },
      { tipo: 'texto', texto: ' *e* f * g' },
    ])
  })

  it('variável dentro de negrito', () => {
    expect(analisarInline('**{{nome}}**')).toEqual([{ tipo: 'negrito', filhos: [{ tipo: 'variavel', nome: 'nome' }] }])
  })

  it('HTML não é interpretado: vira texto', () => {
    expect(analisarInline('<b>x</b>')).toEqual([{ tipo: 'texto', texto: '<b>x</b>' }])
  })
})

describe('validação (espelho do gatilho da 07)', () => {
  it('variáveis distintas em ordem alfabética, inválidas e chaves sem par', () => {
    expect(validarModelo('{{nome}} {{codigo}} {{nome}} {{senha}}')).toEqual({
      variaveis: ['codigo', 'nome', 'senha'], invalidas: ['senha'], chavesSemPar: false,
    })
    expect(validarModelo('{{nome}} {{codigo}').chavesSemPar).toBe(true)
    expect(validarModelo('texto }} solto').chavesSemPar).toBe(true)
  })
})

describe('formatação das variáveis', () => {
  it('dinheiro com centavos, percentuais, CPF/CNPJ e CEP mascarados, data por extenso', () => {
    expect(formatarVariavel('valor-parcela', 1808.33)).toBe('R$ 1.808,33')
    expect(formatarVariavel('valor-propriedade', 500000)).toBe('R$ 500.000,00')
    expect(formatarVariavel('taxa-aporte', 8.5)).toBe('8,5%')
    expect(formatarVariavel('cpf-cnpj', '12345678909')).toBe('123.456.789-09')
    expect(formatarVariavel('cpf-cnpj', '11222333000181')).toBe('11.222.333/0001-81')
    expect(formatarVariavel('vendedora-cnpj', '11222333000181')).toBe('11.222.333/0001-81')
    expect(formatarVariavel('cep', '01310100')).toBe('01310-100')
    expect(formatarVariavel('data', '2026-09-28')).toBe('28 de setembro de 2026')
    expect(formatarVariavel('codigo', 123)).toBe('0000123')
    expect(formatarVariavel('estado-civil', 'uniao_estavel')).toBe('em união estável')
    expect(formatarVariavel('numero-parcelas', 60)).toBe('60')
  })

  it('vazio vira nulo (bloqueia o documento)', () => {
    expect(formatarVariavel('nome', null)).toBeNull()
    expect(formatarVariavel('nome', '   ')).toBeNull()
    expect(formatarVariavel('valor-parcela', Number.NaN)).toBeNull()
  })

  it('auxiliares', () => {
    expect(mascaraCpfCnpj('123')).toBe('123')
    expect(dataPorExtenso('28/09/2026')).toBe('28/09/2026')
    expect(codigoContrato('#12')).toBe('0000012')
  })
})

describe('renderização', () => {
  const modelo = '# Contrato {{codigo}}\n\nComprador: **{{nome}}**, CPF {{cpf-cnpj}}.\n\n- Parcela de {{valor-parcela}}'

  it('troca as variáveis por texto formatado', () => {
    const r = renderizarModelo(modelo, { codigo: 7, nome: 'Maria', 'cpf-cnpj': '12345678909', 'valor-parcela': 1808.33 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.texto).toBe('# Contrato 0000007\n\nComprador: Maria, CPF 123.456.789-09.\n\n- Parcela de R$ 1.808,33')
    expect(r.variaveis).toEqual(['codigo', 'cpf-cnpj', 'nome', 'valor-parcela'])
    expect(r.blocos[1]).toEqual({
      tipo: 'paragrafo',
      trechos: [
        { texto: 'Comprador: ', negrito: false, italico: false },
        { texto: 'Maria', negrito: true, italico: false },
        { texto: ', CPF 123.456.789-09.', negrito: false, italico: false },
      ],
    })
  })

  it('variável desconhecida ou usada e vazia bloqueia, listando os campos', () => {
    expect(renderizarModelo(modelo + ' {{senha}}', { codigo: 7, nome: '', 'cpf-cnpj': '12345678909', 'valor-parcela': null }))
      .toEqual({ ok: false, desconhecidas: ['senha'], vazias: ['nome', 'valor-parcela'] })
  })

  it('marcação dentro de um valor vira texto (sem injeção)', () => {
    const r = renderizarModelo('Nome: {{nome}}\n\nfim', { nome: '**x** {{codigo}} # y\n\n---' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.blocos).toHaveLength(2)
    expect(r.blocos[0]).toEqual({ tipo: 'paragrafo', trechos: [{ texto: 'Nome: **x** {{codigo}} # y ---', negrito: false, italico: false }] })
  })

  it('variável não usada não precisa de valor', () => {
    expect(renderizarModelo('Só {{nome}} aqui, nada mais.', { nome: 'Ana' }).ok).toBe(true)
  })

  it('o texto plano é determinístico (base do texto_sha256)', () => {
    const a = renderizarModelo(modelo, { codigo: 7, nome: 'Maria', 'cpf-cnpj': '12345678909', 'valor-parcela': 1808.33 })
    const b = renderizarModelo(modelo.replace(/\n/g, '\r\n'), { codigo: 7, nome: 'Maria', 'cpf-cnpj': '12345678909', 'valor-parcela': 1808.33 })
    expect(a.ok && b.ok && textoPlano(a.blocos) === textoPlano(b.blocos)).toBe(true)
  })

  it('os modelos provisórios semeados renderizam com os dados de exemplo', () => {
    const r = renderizarModelo('# MODELO\n\nContrato nº {{codigo}}, emitido em {{data}}.\n\n**Vendedora:** {{vendedora-razao-social}}, CNPJ {{vendedora-cnpj}}.', DADOS_EXEMPLO)
    expect(r.ok).toBe(true)
  })
})

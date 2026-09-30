import { describe, expect, it } from 'vitest'
import {
  camposDoDetalhe, cnpjValido, cpfValido, MENSAGEM_TERMO_DESATUALIZADO, respostaDaSituacao, validarPreCadastro,
} from './dados.ts'

const base = {
  codigo: 'LinkCaUmAa',
  tipo_pessoa: 'fisica',
  nome: '  Maria ',
  sobrenome: ' Silva ',
  documento: '123.456.709-16',
  email: ' MARIA@Exemplo.COM ',
  telefone: '(11) 98888-7777',
  termo_id: 'A0000000-0000-4000-8000-000000000001',
  captcha: 'token',
}

describe('validarPreCadastro', () => {
  it('normaliza um pedido válido de PF', () => {
    const v = validarPreCadastro(base)
    expect(v).toEqual({
      ok: true,
      valor: {
        codigo: 'linkcaumaa',
        termoId: 'a0000000-0000-4000-8000-000000000001',
        dados: { tipo_pessoa: 'fisica', nome: 'Maria', sobrenome: 'Silva', documento: '12345670916', email: 'maria@exemplo.com', telefone: '11988887777' },
      },
    })
  })

  it('PJ: CNPJ com DV e sem sobrenome', () => {
    const v = validarPreCadastro({ ...base, tipo_pessoa: 'juridica', documento: '11.222.333/0001-81', email: null })
    expect(v.ok && v.valor.dados).toEqual({ tipo_pessoa: 'juridica', nome: 'Maria', sobrenome: null, documento: '11222333000181', email: null, telefone: '11988887777' })
  })

  it('código fora do formato vira só "codigo" (a Edge responde 404, como código inexistente)', () => {
    expect(validarPreCadastro({ ...base, codigo: '<script>' })).toEqual({ ok: false, campos: ['codigo'] })
    expect(validarPreCadastro({ ...base, codigo: 'abc1' })).toEqual({ ok: false, campos: ['codigo'] })
    expect(validarPreCadastro({ ...base, codigo: 42 })).toEqual({ ok: false, campos: ['codigo'] })
  })

  it('lista todos os campos inválidos, sem os valores', () => {
    const v = validarPreCadastro({ ...base, tipo_pessoa: 'fisica', nome: 'M', documento: '12345678900', email: 'sem-arroba', telefone: '123', termo_id: 'x' })
    expect(v).toEqual({ ok: false, campos: ['nome', 'cpf', 'email', 'telefone', 'termo_id'] })
  })

  it('tipo de pessoa obrigatório e documento conforme o tipo', () => {
    expect(validarPreCadastro({ ...base, tipo_pessoa: 'outra' })).toEqual({ ok: false, campos: ['tipo_pessoa'] })
    expect(validarPreCadastro({ ...base, tipo_pessoa: 'juridica' })).toEqual({ ok: false, campos: ['cnpj'] })
  })

  it('ignora tipos errados sem quebrar', () => {
    const v = validarPreCadastro({ ...base, nome: { a: 1 }, telefone: ['11988887777'] })
    expect(v).toEqual({ ok: false, campos: ['nome', 'telefone'] })
  })
})

describe('validadores', () => {
  it('CPF e CNPJ com DV', () => {
    expect(cpfValido('12345670916')).toBe(true)
    expect(cpfValido('11111111111')).toBe(false)
    expect(cpfValido('12345670917')).toBe(false)
    expect(cnpjValido('11222333000181')).toBe(true)
    expect(cnpjValido('11222333000182')).toBe(false)
  })
})

describe('respostaDaSituacao', () => {
  it('criado e duplicado respondem igual (200 {ok:true})', () => {
    expect(respostaDaSituacao('criado')).toEqual(respostaDaSituacao('duplicado'))
    expect(respostaDaSituacao('criado')).toEqual({ status: 200, corpo: { ok: true }, sucesso: true })
  })

  it('código inválido 404, termo sem revisão 503, desconhecido nulo', () => {
    expect(respostaDaSituacao('codigo_invalido')).toMatchObject({ status: 404, sucesso: false })
    expect(respostaDaSituacao('termo_invalido')).toMatchObject({ status: 503, sucesso: false })
    expect(respostaDaSituacao('outra')).toBeNull()
    expect(respostaDaSituacao(undefined)).toBeNull()
  })

  it('termo trocado com a página aberta: 409 termo_desatualizado (a página relê o termo), diferente de 503', () => {
    expect(respostaDaSituacao('termo_desatualizado')).toEqual({
      status: 409, mensagem: MENSAGEM_TERMO_DESATUALIZADO, codigo: 'termo_desatualizado', sucesso: false,
    })
    expect(respostaDaSituacao('termo_desatualizado')).not.toEqual(respostaDaSituacao('termo_invalido'))
  })

  it('limite do link (A2): 429, e não conta como sucesso', () => {
    expect(respostaDaSituacao('limite')).toMatchObject({ status: 429, codigo: 'limite_link', sucesso: false })
  })

  it('só criado e duplicado dão 200, e o corpo não carrega nada que diferencie os dois', () => {
    const r = respostaDaSituacao('criado')
    expect(r && r.status === 200 && Object.keys(r.corpo)).toEqual(['ok'])
    for (const s of ['codigo_invalido', 'termo_invalido', 'termo_desatualizado', 'limite']) {
      expect(respostaDaSituacao(s)?.status).not.toBe(200)
    }
  })
})

describe('camposDoDetalhe', () => {
  it('lê só nomes de campo do detail JSON', () => {
    expect(camposDoDetalhe('{"campos":["cpf","telefone"]}')).toEqual(['cpf', 'telefone'])
    expect(camposDoDetalhe('{"campos":["<b>", 3]}')).toEqual([])
    expect(camposDoDetalhe('não é json')).toEqual([])
    expect(camposDoDetalhe(null)).toEqual([])
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  avaliarEdicao, campoDoFormulario, celulaCsv, csvDeLeads, deveRelerTermo, documentoObrigatorio, ErroPreCadastro, esquemaCliente,
  paraClienteDados, paraEdicao, VALORES_VAZIOS, valoresDaFicha,
  type ValoresCliente,
} from './api-clientes'
import type { ClienteFicha, LeadItem } from './tipos'

// o módulo importa o cliente do Supabase (só usado na Edge do pré-cadastro): no Node, um cliente de mentira basta
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn() } }))

const ficha: ClienteFicha = {
  id: 'c1', tipo_pessoa: 'fisica', nome: 'Maria', sobrenome: 'Souza', cpf: null, cnpj: null, rg: null, data_nascimento: '1990-05-01',
  genero: 'feminino', estado_civil: null, nacionalidade: null, email: 'maria@x.test', emails_adicionais: ['m2@x.test'],
  telefone: '11988887777', telefones_adicionais: [], horario_contato: null, cep: '01310100', logradouro: 'Av. Paulista', numero: '1000',
  complemento: null, bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', pais: 'Brasil', interesses: ['Zona sul', 'Casa'],
  etapa: 'novo_contato', etapa_desde: '2026-09-01T00:00:00Z', motivo_perda: null, origem: 'migracao_parceiro_clientes',
  exclusividade_ate: null, portal_liberado: false, tem_login_portal: false, criado_em: '2026-09-01T00:00:00Z', atualizado_em: null,
  inativado_em: null, motivo_inativacao: null, anonimizado_em: null,
}

describe('paraClienteDados', () => {
  it('manda só dígitos e nunca cadeia, etapa, origem ou portal', () => {
    const v: ValoresCliente = {
      ...VALORES_VAZIOS, nome: ' Ana ', documento: '529.982.247-25', telefone: '(11) 98888-7777', cep: '01310-100',
      emails_adicionais: 'A@x.test, b@x.test', telefones_adicionais: '(11) 3333-4444', interesses: ['Casa', 'Casa'], uf: 'SP',
    }
    const d = paraClienteDados(v)
    expect(d).toMatchObject({
      tipo_pessoa: 'fisica', nome: 'Ana', cpf: '52998224725', cnpj: null, telefone: '11988887777', cep: '01310100',
      emails_adicionais: ['a@x.test', 'b@x.test'], telefones_adicionais: ['1133334444'], interesses: ['Casa'], pais: 'Brasil',
    })
    for (const k of ['corretor_id', 'gerente_id', 'imobiliaria_id', 'etapa', 'origem', 'portal_liberado']) expect(d).not.toHaveProperty(k)
  })

  it('PJ: documento vai em cnpj e os campos de pessoa física saem nulos', () => {
    const d = paraClienteDados({ ...VALORES_VAZIOS, tipo_pessoa: 'juridica', nome: 'Empresa', documento: '11.222.333/0001-81', sobrenome: 'X', rg: '1' })
    expect(d).toMatchObject({ cpf: null, cnpj: '11222333000181', sobrenome: null, rg: null, genero: null })
  })
})

describe('paraEdicao', () => {
  it('manda só o que mudou (interesses comparados como conjunto)', () => {
    const v = { ...valoresDaFicha(ficha), email: 'nova@x.test', interesses: ['Casa', 'Zona sul'] }
    expect(paraEdicao(v, ficha, false)).toEqual({ email: 'nova@x.test' })
  })

  it('documento só com permissão e quando mudou', () => {
    const v = { ...valoresDaFicha(ficha), documento: '529.982.247-25' }
    expect(paraEdicao(v, ficha, false)).toEqual({})
    expect(paraEdicao(v, ficha, true)).toEqual({ cpf: '52998224725' })
    const comCpf = { ...ficha, cpf: '52998224725' }
    expect(paraEdicao(valoresDaFicha(comCpf), comCpf, true)).toEqual({})
  })

  it('apagar um campo manda nulo', () => {
    expect(paraEdicao({ ...valoresDaFicha(ficha), bairro: '  ' }, ficha, false)).toEqual({ bairro: null })
  })
})

describe('esquemaCliente', () => {
  const base: ValoresCliente = { ...VALORES_VAZIOS, nome: 'Ana', documento: '52998224725', declaracao: true }
  it('cadastro exige documento válido e a declaração (N12)', () => {
    const e = esquemaCliente({ exigirDeclaracao: true, documentoObrigatorio: true })
    expect(e.safeParse(base).success).toBe(true)
    expect(e.safeParse({ ...base, documento: '12345678900' }).success).toBe(false)
    expect(e.safeParse({ ...base, declaracao: false }).success).toBe(false)
    expect(e.safeParse({ ...base, tipo_pessoa: 'juridica' }).success).toBe(false)
  })
  it('edição sem permissão de documento aceita documento vazio; interesse antigo continua aceito', () => {
    const e = esquemaCliente({ exigirDeclaracao: false, documentoObrigatorio: false, interessesAceitos: ['Legado'] })
    expect(e.safeParse({ ...base, documento: '', interesses: ['Legado', 'Casa'] }).success).toBe(true)
    expect(e.safeParse({ ...base, interesses: ['Iate'] }).success).toBe(false)
  })
})

describe('CSV', () => {
  it('neutraliza fórmulas e escapa aspas e quebras de linha', () => {
    expect(celulaCsv('=SOMA(A1)')).toBe(`"'=SOMA(A1)"`)
    expect(celulaCsv('+55 11')).toBe(`"'+55 11"`)
    expect(celulaCsv('@x')).toBe(`"'@x"`)
    expect(celulaCsv('diz "oi"\nlinha')).toBe('"diz ""oi"" linha"')
    expect(celulaCsv(null)).toBe('""')
  })
  it('leads com cabeçalho e separador ;', () => {
    const lead: LeadItem = {
      id: 'l1', nome: 'Lead', email: null, telefone: '11977776666', mensagem: null, origem: 'site', empreendimento: { id: 'e', nome: 'Res' },
      status: 'novo', cliente_id: null, tratado_por: null, tratado_em: null, motivo_descarte: null, criado_em: '2026-09-27T12:00:00Z',
    }
    const linhas = csvDeLeads([lead]).split('\n')
    expect(linhas[0]).toBe('"Data";"Nome";"Telefone";"E-mail";"Empreendimento";"Mensagem";"Status";"Origem"')
    expect(linhas[1]).toContain('"Lead";"11977776666";"";"Res";"";"Novo";"site"')
  })
})

describe('campoDoFormulario', () => {
  it('traduz os campos do servidor para os do formulário', () => {
    expect(campoDoFormulario('cpf')).toBe('documento')
    expect(campoDoFormulario('cnpj')).toBe('documento')
    expect(campoDoFormulario('email')).toBe('email')
    expect(campoDoFormulario('corretor_id')).toBeNull()
  })
})

describe('documentoObrigatorio (edição de cliente sem documento)', () => {
  it('cadastro sempre exige; edição só quando já há documento e quem edita pode mexer nele', () => {
    expect(documentoObrigatorio('cadastro', false, null)).toBe(true)
    expect(documentoObrigatorio('edicao', true, '')).toBe(false)
    expect(documentoObrigatorio('edicao', true, null)).toBe(false)
    expect(documentoObrigatorio('edicao', true, '529.982.247-25')).toBe(true)
    expect(documentoObrigatorio('edicao', false, '529.982.247-25')).toBe(false)
  })
  it('cliente migrado sem CPF: salva outras alterações sem informar CPF; CPF preenchido continua com DV conferido', () => {
    const inicial = valoresDaFicha(ficha)
    const e = esquemaCliente({ exigirDeclaracao: false, documentoObrigatorio: documentoObrigatorio('edicao', true, inicial.documento), interessesAceitos: inicial.interesses })
    expect(e.safeParse({ ...inicial, telefone: '(11) 97777-6666' }).success).toBe(true)
    expect(e.safeParse({ ...inicial, documento: '123.456.789-00' }).success).toBe(false)
    expect(e.safeParse({ ...inicial, documento: '529.982.247-25' }).success).toBe(true)
  })
})

describe('avaliarEdicao (documento pedido × ficha relida)', () => {
  it('documento gravado: nada recusado', () => {
    expect(avaliarEdicao({ cpf: '52998224725' }, 'fisica', { ...ficha, cpf: '52998224725' })).toEqual({ documentoRecusado: false, outrosCampos: 0 })
  })
  it('documento de outro cliente (A2): recusado, e conta as demais alterações', () => {
    expect(avaliarEdicao({ cpf: '52998224725', telefone: '11977776666' }, 'fisica', ficha)).toEqual({ documentoRecusado: true, outrosCampos: 1 })
  })
  it('sem documento na edição, ou sem ficha relida: nada a avisar', () => {
    expect(avaliarEdicao({ email: 'x@y.test' }, 'fisica', ficha).documentoRecusado).toBe(false)
    expect(avaliarEdicao({ cpf: '52998224725' }, 'fisica', null).documentoRecusado).toBe(false)
  })
})

describe('deveRelerTermo (pré-cadastro)', () => {
  it('409 termo desatualizado e 503 releem o termo; os demais não', () => {
    expect(deveRelerTermo(new ErroPreCadastro(409, 'x', [], 'termo_desatualizado'))).toBe(true)
    expect(deveRelerTermo(new ErroPreCadastro(503, 'x', [], 'indisponivel'))).toBe(true)
    expect(deveRelerTermo(new ErroPreCadastro(429, 'x', [], 'limite_link'))).toBe(false)
    expect(deveRelerTermo(new ErroPreCadastro(422, 'x', ['cpf']))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  CAMPOS_OBRIGATORIOS, MSG_FALTA_FINALIZADO, MSG_FALTA_FINALIZAR, camposFaltando, dadosDoForm, dadosDoImovel, diferencas,
  ehCampoObrigatorio, esquemaImovel, esquemaImovelPara, formDoImovel, formVazio, interpretarBusca, lerDecimal, lerInteiro,
  mensagemFalta, padraoIlike, type FormImovel,
} from './formulario'
import type { Imovel } from './tipos'

const imovel = (extra: Partial<Imovel> = {}): Imovel => ({
  id: 'e5000000-0000-4000-8000-000000000001', codigo: 12, nome: 'Casa da Praia', matricula: '12.345', tipo: 'casa',
  descricao: null, status: 'rascunho', cep: '01310100', pais: 'Brasil', uf: 'SP', cidade: 'São Paulo', bairro: 'Bela Vista',
  logradouro: 'Avenida Paulista', numero: '1000', complemento: null, valor: 850000, area_total: 120.5, area_construida: 98,
  idade_anos: 10, andar: null, quartos: 3, banheiros: 2, suites: 1, vagas: 2, adicionais: ['piscina', 'churrasqueira'],
  observacao_revisao: null, criado_por: 'a0000000-0000-4000-8000-000000000001', criado_por_parceiro_id: null,
  imobiliaria_id: null, gerente_id: null, criado_em: '2026-09-28T10:00:00Z', atualizado_em: null, atualizado_por: null,
  inativado_em: null, inativado_por: null, motivo_inativacao: null, ...extra,
})

const form = (extra: Partial<FormImovel> = {}): FormImovel => ({ ...formVazio(), ...extra })
const erros = (f: FormImovel) => {
  const r = esquemaImovel.safeParse(f)
  return r.success ? [] : r.error.issues.map((i) => String(i.path[0]))
}

describe('esquemaImovel (formato; o rascunho pode ficar incompleto)', () => {
  it('aceita o formulário vazio: IMV-2 é do servidor, na saída do rascunho', () => {
    expect(erros(formVazio())).toEqual([])
  })

  it('confere os mesmos limites dos CHECKs de public.imoveis', () => {
    expect(erros(form({ cep: '0131010' }))).toEqual(['cep'])
    expect(erros(form({ uf: 'XX' }))).toEqual(['uf'])
    expect(erros(form({ pais: ' ' }))).toEqual(['pais'])
    expect(erros(form({ nome: 'x'.repeat(201) }))).toEqual(['nome'])
    expect(erros(form({ numero: '1'.repeat(21) }))).toEqual(['numero'])
    expect(erros(form({ valor: 0 }))).toEqual(['valor'])
    expect(erros(form({ valor: -10 }))).toEqual(['valor'])
    expect(erros(form({ valor: 1e13 }))).toEqual(['valor'])
    expect(erros(form({ area_total: '0' }))).toEqual(['area_total'])
    expect(erros(form({ area_total: '12,345' }))).toEqual(['area_total'])
    expect(erros(form({ area_construida: 'abc' }))).toEqual(['area_construida'])
    expect(erros(form({ idade_anos: '501' }))).toEqual(['idade_anos'])
    expect(erros(form({ quartos: '101' }))).toEqual(['quartos'])
    expect(erros(form({ vagas: '-1' }))).toEqual(['vagas'])
    expect(erros(form({ vagas: '1000', quartos: '0', area_total: '120,50', valor: 1500.5, uf: 'RJ', cep: '20040002' }))).toEqual([])
  })

  it('só aceita os adicionais do banco ("Chip" fica fora, E5)', () => {
    expect(esquemaImovel.safeParse({ ...formVazio(), adicionais: ['chip'] }).success).toBe(false)
    expect(erros(form({ adicionais: ['aceita_pet', 'piscina'] }))).toEqual([])
  })
})

describe('leitura de números digitados', () => {
  it('decimal com vírgula ou ponto, até 2 casas', () => {
    expect(lerDecimal('120')).toBe(120)
    expect(lerDecimal(' 120,5 ')).toBe(120.5)
    expect(lerDecimal('120.50')).toBe(120.5)
    expect(lerDecimal('')).toBeNull()
    expect(lerDecimal('1.200,50')).toBeNull()
    expect(lerDecimal('12,345')).toBeNull()
  })

  it('inteiro sem sinal', () => {
    expect(lerInteiro('3')).toBe(3)
    expect(lerInteiro(' 0 ')).toBe(0)
    expect(lerInteiro('')).toBeNull()
    expect(lerInteiro('2,5')).toBeNull()
    expect(lerInteiro('-1')).toBeNull()
  })
})

describe('dadosDoForm (só colunas com grant)', () => {
  it('apara textos, vazio vira nulo, CEP só dígitos, UF em maiúsculas e valor com 2 casas', () => {
    const d = dadosDoForm(form({
      nome: '  Casa nova  ', matricula: ' ', cep: '01310-100', uf: 'sp', cidade: 'São Paulo', valor: 1234.567,
      area_total: '120,5', quartos: '3', adicionais: ['piscina', 'churrasqueira'],
    }))
    expect(d).toMatchObject({
      nome: 'Casa nova', matricula: null, cep: '01310100', uf: 'SP', cidade: 'São Paulo', valor: 1234.57,
      area_total: 120.5, area_construida: null, quartos: 3, banheiros: null, pais: 'Brasil',
    })
    // adicionais na ordem canônica, independente da ordem de clique
    expect(d.adicionais).toEqual(['churrasqueira', 'piscina'])
  })

  it('nunca leva status, código, criador nem a cadeia', () => {
    const chaves = Object.keys(dadosDoForm(formDoImovel(imovel())))
    for (const proibida of ['id', 'codigo', 'status', 'criado_por', 'criado_por_parceiro_id', 'imobiliaria_id', 'gerente_id',
      'observacao_revisao', 'inativado_em', 'motivo_inativacao']) {
      expect(chaves).not.toContain(proibida)
    }
  })

  it('CEP incompleto não vai para o banco', () => {
    expect(dadosDoForm(form({ cep: '0131' })).cep).toBeNull()
  })
})

describe('edição: só o que mudou', () => {
  it('ida e volta do registro não gera diferença', () => {
    const i = imovel()
    expect(diferencas(dadosDoImovel(i), dadosDoForm(formDoImovel(i)))).toEqual({})
  })

  it('leva só as colunas alteradas (o valor travado em NC nunca é reenviado)', () => {
    const i = imovel({ status: 'no_contrato' })
    const f = formDoImovel(i)
    const d = diferencas(dadosDoImovel(i), dadosDoForm({ ...f, descricao: 'Nova descrição', adicionais: ['piscina'] }))
    expect(d).toEqual({ descricao: 'Nova descrição', adicionais: ['piscina'] })
    expect('valor' in d).toBe(false)
  })

  it('formDoImovel mostra decimais com vírgula', () => {
    expect(formDoImovel(imovel()).area_total).toBe('120,5')
    expect(formDoImovel(imovel({ area_total: null })).area_total).toBe('')
  })
})

describe('IMV-2 no navegador (antecipa a lista do servidor)', () => {
  it('mesma lista e ordem de _imovel_campos_faltando()', () => {
    expect(CAMPOS_OBRIGATORIOS).toEqual(['nome', 'tipo', 'cep', 'logradouro', 'numero', 'cidade', 'uf', 'valor'])
    expect(camposFaltando(dadosDoForm(form({ nome: 'Só o nome' }))))
      .toEqual(['tipo', 'cep', 'logradouro', 'numero', 'cidade', 'uf', 'valor'])
    expect(camposFaltando(dadosDoImovel(imovel()))).toEqual([])
    expect(camposFaltando({ ...dadosDoImovel(imovel()), numero: '  ', valor: 0 })).toEqual(['numero', 'valor'])
  })

  it('reconhece os campos devolvidos pelo servidor', () => {
    expect(ehCampoObrigatorio('cep')).toBe(true)
    expect(ehCampoObrigatorio('bairro')).toBe(false)
  })
})

describe('IMV-2 fora do rascunho (gatilho imoveis_campos_obrigatorios)', () => {
  const problemas = (status: Parameters<typeof esquemaImovelPara>[0], f: FormImovel) => {
    const r = esquemaImovelPara(status).safeParse(f)
    return r.success ? [] : r.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`)
  }

  it('no rascunho o formulário pode ficar incompleto', () => {
    expect(esquemaImovelPara('rascunho')).toBe(esquemaImovel)
    expect(problemas('rascunho', formVazio())).toEqual([])
    expect(problemas('rascunho', { ...formDoImovel(imovel()), valor: null, nome: '' })).toEqual([])
  })

  it.each(['pendente', 'em_revisao', 'aprovado', 'no_contrato'] as const)('em %s nenhum campo do IMV-2 fica vazio', (status) => {
    expect(problemas(status, formDoImovel(imovel({ status })))).toEqual([])
    expect(problemas(status, { ...formDoImovel(imovel({ status })), nome: '  ', cep: '', valor: null })).toEqual([
      `nome: ${MSG_FALTA_FINALIZADO}`, `cep: ${MSG_FALTA_FINALIZADO}`, `valor: ${MSG_FALTA_FINALIZADO}`,
    ])
  })

  it('campos fora do IMV-2 continuam opcionais depois do rascunho', () => {
    expect(problemas('aprovado', { ...formDoImovel(imovel({ status: 'aprovado' })), bairro: '', descricao: '', quartos: '' }))
      .toEqual([])
  })

  it('mensagem do campo conforme o status', () => {
    expect(mensagemFalta('rascunho')).toBe(MSG_FALTA_FINALIZAR)
    expect(mensagemFalta('pendente')).toBe(MSG_FALTA_FINALIZADO)
  })
})

describe('busca da lista', () => {
  it('código com ou sem # e zeros à esquerda', () => {
    expect(interpretarBusca('#0000012')).toEqual({ codigo: 12, nome: '0000012' })
    expect(interpretarBusca('12')).toEqual({ codigo: 12, nome: '12' })
    expect(interpretarBusca('  Casa da Praia ')).toEqual({ codigo: null, nome: 'Casa da Praia' })
    expect(interpretarBusca('   ')).toEqual({ codigo: null, nome: null })
  })

  it('curingas digitados viram literais no ilike', () => {
    expect(padraoIlike('50%_off\\')).toBe('%50\\%\\_off\\\\%')
  })
})

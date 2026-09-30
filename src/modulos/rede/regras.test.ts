import { describe, expect, it } from 'vitest'
import type { Escopo, Permissao } from '@/lib/types'
import { ACOES_REDE_PADRAO, permissoesDeReferencia } from '@/lib/menu'
import {
  acoesDoParceiro, cpfFicouGravado, dadosEdicaoParceiro, dadosImobiliaria, dadosNovoParceiro, destinoDeCarteira, destinoDeInativacao,
  emLotes, inativacaoPedeDestino, problemasParceiro, proximoOffsetCarteira, rotuloTodosCarteira, termoBusca, tiposCadastraveis,
  TRANSFERENCIA_POR_LOTE,
} from './regras'
import type { ParceiroDetalhe } from './tipos'

const IMOB_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const IMOB_B = 'bbbbbbbb-0000-4000-8000-000000000001'
const GA1 = 'c0000000-0000-4000-8000-000000000012'
const CA1A = 'c0000000-0000-4000-8000-000000000014'

type EscopoRede = Pick<Escopo, 'interno' | 'super' | 'tipo' | 'parceiro_id' | 'imobiliaria_id' | 'permissoes'>

function escopo(tipo: 'imobiliaria' | 'gerente' | 'corretor' | 'admin' | 'super', extra: Partial<EscopoRede> = {}): EscopoRede {
  const interno = tipo === 'admin' || tipo === 'super'
  const t = interno ? null : tipo
  const permissoes: Permissao[] = permissoesDeReferencia({
    papel: interno ? tipo : tipo, status_parceiro: 'aprovado', inativado: false, interno, super: tipo === 'super',
    tipo: t, acoes: t ? ACOES_REDE_PADRAO[t] : [],
  })
  return {
    interno, super: tipo === 'super', tipo: t,
    parceiro_id: tipo === 'gerente' ? GA1 : tipo === 'corretor' ? CA1A : t ? 'c0000000-0000-4000-8000-000000000011' : null,
    imobiliaria_id: t ? IMOB_A : null, permissoes, ...extra,
  }
}

function detalhe(extra: Partial<ParceiroDetalhe> = {}): ParceiroDetalhe {
  return {
    id: CA1A, profile_id: 'a0', tipo: 'corretor', nome: 'CA1a Corretor', cpf: '12345670320', creci: 'C-1', email: 'ca1a@x.test',
    telefone: '11999999999', codigo_indicacao: 'abcdefghij', virtual: false, migrado_legado: false, imobiliaria_declarada: null,
    imobiliaria: { id: IMOB_A, nome: 'Imob A', da_casa: false }, gerente: { id: GA1, nome: 'GA1' }, status_parceiro: 'aprovado',
    papel: 'corretor', tem_login: true, ultimo_acesso_em: null, convite_pendente: false, criado_em: '2026-09-01T00:00:00Z',
    inativado_em: null, motivo_inativacao: null, corretores_ativos: 0, clientes_ativos: 2, historico: [], ...extra,
  }
}

describe('tiposCadastraveis (matriz §3.3)', () => {
  it('internos cadastram os três tipos; imobiliária gerente e corretor; gerente só corretor; corretor nada', () => {
    expect(tiposCadastraveis(escopo('admin'))).toEqual(['imobiliaria', 'gerente', 'corretor'])
    expect(tiposCadastraveis(escopo('imobiliaria'))).toEqual(['gerente', 'corretor'])
    expect(tiposCadastraveis(escopo('gerente'))).toEqual(['corretor'])
    expect(tiposCadastraveis(escopo('corretor'))).toEqual([])
    expect(tiposCadastraveis(null)).toEqual([])
  })
  it('permissoes_rede desligada tira o tipo', () => {
    const e = escopo('gerente')
    expect(tiposCadastraveis({ ...e, permissoes: e.permissoes.filter((p) => p !== 'rede.cadastrar_corretor') })).toEqual([])
  })
})

describe('acoesDoParceiro', () => {
  it('gerente gere o próprio corretor, mas não transfere de gerente, nem bloqueia, nem muda de imobiliária', () => {
    const a = acoesDoParceiro(escopo('gerente'), detalhe())
    expect(a).toMatchObject({ editar: true, inativar: true, transferirClientes: true, transferirCorretor: false, bloquear: false, mudarImobiliaria: false, reativar: false })
  })
  it('gerente não gere corretor de outra equipe', () => {
    const a = acoesDoParceiro(escopo('gerente'), detalhe({ gerente: { id: 'outro', nome: 'GA2' } }))
    expect(a.editar || a.inativar || a.transferirClientes || a.convidar).toBe(false)
  })
  it('imobiliária gere gerentes e corretores da própria imobiliária e transfere corretor', () => {
    const a = acoesDoParceiro(escopo('imobiliaria'), detalhe())
    expect(a).toMatchObject({ editar: true, inativar: true, transferirCorretor: true, transferirClientes: true })
    const g = acoesDoParceiro(escopo('imobiliaria'), detalhe({ id: GA1, tipo: 'gerente', gerente: null, corretores_ativos: 2 }))
    expect(g).toMatchObject({ editar: true, inativar: true, transferirCorretor: false })
    const outra = acoesDoParceiro(escopo('imobiliaria'), detalhe({ imobiliaria: { id: IMOB_B, nome: 'B', da_casa: false } }))
    expect(outra.editar || outra.inativar).toBe(false)
  })
  it('usuário de imobiliária só é gerido por internos', () => {
    const p = detalhe({ tipo: 'imobiliaria', gerente: null, clientes_ativos: 0 })
    expect(acoesDoParceiro(escopo('imobiliaria'), p).inativar).toBe(false)
    expect(acoesDoParceiro(escopo('admin'), p)).toMatchObject({ inativar: true, editar: true })
  })
  it('convite só para quem ainda não tem acesso (ou tem convite pendente)', () => {
    expect(acoesDoParceiro(escopo('gerente'), detalhe()).convidar).toBe(false)
    expect(acoesDoParceiro(escopo('gerente'), detalhe({ tem_login: false, profile_id: null })).convidar).toBe(true)
    expect(acoesDoParceiro(escopo('gerente'), detalhe({ convite_pendente: true })).convidar).toBe(true)
    expect(acoesDoParceiro(escopo('gerente'), detalhe({ tem_login: false, inativado_em: '2026-09-02T00:00:00Z' })).convidar).toBe(false)
  })
  it('internos bloqueiam, desbloqueiam e reativam; o Super muda de imobiliária e regulariza legado', () => {
    expect(acoesDoParceiro(escopo('admin'), detalhe())).toMatchObject({ bloquear: true, desbloquear: false, mudarImobiliaria: false })
    expect(acoesDoParceiro(escopo('admin'), detalhe({ status_parceiro: 'bloqueado' }))).toMatchObject({ bloquear: false, desbloquear: true })
    expect(acoesDoParceiro(escopo('admin'), detalhe({ inativado_em: '2026-09-02T00:00:00Z', status_parceiro: 'inativo' })))
      .toMatchObject({ reativar: true, inativar: false, editar: false, bloquear: false })
    const legado = detalhe({ migrado_legado: true, imobiliaria: { id: 'casa', nome: 'Imobiliária Arken', da_casa: true } })
    expect(acoesDoParceiro(escopo('admin'), legado).regularizar).toBe(false)
    expect(acoesDoParceiro(escopo('super'), legado)).toMatchObject({ regularizar: true, mudarImobiliaria: true })
  })
  it('a cadeia virtual da casa não é editada nem inativada', () => {
    const casa = detalhe({ virtual: true, tem_login: false, profile_id: null, imobiliaria: { id: 'casa', nome: 'Imobiliária Arken', da_casa: true } })
    expect(acoesDoParceiro(escopo('super'), casa)).toMatchObject({ editar: false, inativar: false, convidar: false, mudarImobiliaria: false })
  })
  it('sem escopo, nenhuma ação', () => {
    expect(Object.values(acoesDoParceiro(null, detalhe())).some(Boolean)).toBe(false)
  })
})

describe('destinos', () => {
  const alvo = detalhe()
  const o = (id: string, tipo: 'corretor' | 'gerente' | 'imobiliaria', imob = IMOB_A, inativado_em: string | null = null) =>
    ({ id, tipo, imobiliaria_id: imob, gerente_id: null, inativado_em })
  it('corretor: outro corretor ativo da mesma imobiliária ou o gerente dele', () => {
    expect(destinoDeInativacao(alvo, o('x', 'corretor'))).toBe(true)
    expect(destinoDeInativacao(alvo, o(GA1, 'gerente'))).toBe(true)
    expect(destinoDeInativacao(alvo, o('outro-gerente', 'gerente'))).toBe(false)
    expect(destinoDeInativacao(alvo, o(CA1A, 'corretor'))).toBe(false)
    expect(destinoDeInativacao(alvo, o('x', 'corretor', IMOB_B))).toBe(false)
    expect(destinoDeInativacao(alvo, o('x', 'corretor', IMOB_A, '2026-09-01'))).toBe(false)
  })
  it('gerente: outro gerente ativo da mesma imobiliária', () => {
    const g = detalhe({ id: GA1, tipo: 'gerente', gerente: null })
    expect(destinoDeInativacao(g, o('g2', 'gerente'))).toBe(true)
    expect(destinoDeInativacao(g, o('c', 'corretor'))).toBe(false)
  })
  it('carteira: corretor ou gerente ativo, nunca usuário de imobiliária', () => {
    expect(destinoDeCarteira(o('x', 'corretor'), CA1A, IMOB_A)).toBe(true)
    expect(destinoDeCarteira(o('x', 'imobiliaria'), CA1A)).toBe(false)
    expect(destinoDeCarteira(o(CA1A, 'corretor'), CA1A)).toBe(false)
    expect(destinoDeCarteira(o('x', 'corretor', IMOB_B), CA1A, IMOB_A)).toBe(false)
    expect(destinoDeCarteira(o('x', 'corretor', IMOB_B), CA1A, null)).toBe(true)
  })
  it('inativação pede destino quando há carteira ou equipe', () => {
    expect(inativacaoPedeDestino({ clientes_ativos: 0, corretores_ativos: 0 })).toBe(false)
    expect(inativacaoPedeDestino({ clientes_ativos: 1, corretores_ativos: 0 })).toBe(true)
    expect(inativacaoPedeDestino({ clientes_ativos: 0, corretores_ativos: 3 })).toBe(true)
  })
})

describe('formulários → p_dados', () => {
  const v = { nome: '  Maria Souza ', cpf: '123.456.703-20', creci: ' 123-F ', email: ' Maria@Imob.COM ', telefone: '(11) 98888-7777' }
  it('PAR-4: CPF para gerente e corretor; CRECI para corretor', () => {
    expect(problemasParceiro('corretor', { ...v, cpf: '', creci: '' })).toEqual({ cpf: 'Informe o CPF.', creci: 'Informe o CRECI.' })
    expect(problemasParceiro('gerente', { ...v, creci: '' })).toEqual({})
    expect(problemasParceiro('imobiliaria', { ...v, cpf: '' })).toEqual({})
    expect(problemasParceiro('corretor', { ...v, cpf: '111.111.111-11' }).cpf).toBe('CPF inválido.')
    expect(problemasParceiro('corretor', { ...v, email: 'x@', telefone: '123' })).toEqual({ email: 'E-mail inválido.', telefone: 'Informe o DDD e o número.' })
  })
  it('novo parceiro: só dígitos em CPF e telefone, e-mail em minúsculas', () => {
    expect(dadosNovoParceiro(v)).toEqual({ nome: 'Maria Souza', cpf: '12345670320', creci: '123-F', email: 'maria@imob.com', telefone: '11988887777' })
    expect(dadosNovoParceiro({ ...v, email: '', telefone: '', creci: '' })).toMatchObject({ email: null, telefone: null, creci: null })
  })
  it('edição: só o que mudou; CPF só se estava vazio; e-mail só sem login', () => {
    const atual = { nome: 'Maria Souza', cpf: '12345670320', creci: '123-F', email: 'maria@imob.com', telefone: '11988887777', tem_login: true }
    expect(dadosEdicaoParceiro(atual, v)).toEqual({})
    expect(dadosEdicaoParceiro(atual, { ...v, telefone: '11 97777-6666', email: 'outro@x.com', cpf: '98765432100' })).toEqual({ telefone: '11977776666' })
    expect(dadosEdicaoParceiro({ ...atual, cpf: null, tem_login: false }, { ...v, email: 'novo@x.com' })).toEqual({ cpf: '12345670320', email: 'novo@x.com' })
  })
  it('imobiliária: CNPJ, CEP e telefone só com dígitos; UF em maiúsculas', () => {
    expect(dadosImobiliaria({
      nome: ' Imob C ', razao_social: '', cnpj: '11.222.335/0001-70', creci_pj: ' J-3 ', email: '', telefone: '(11) 3333-4444',
      cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000', complemento: '', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'sp',
    })).toEqual({
      nome: 'Imob C', razao_social: null, cnpj: '11222335000170', creci_pj: 'J-3', email: null, telefone: '1133334444',
      cep: '01310100', logradouro: 'Av. Paulista', numero: '1000', complemento: null, bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP',
    })
  })
  it('termo de busca sem caracteres do filtro do PostgREST', () => {
    expect(termoBusca(' Maria, (Silva)*% ')).toBe('Maria Silva')
    expect(termoBusca('a'.repeat(100)).length).toBe(80)
  })
})

describe('transferência de clientes: carteira paginada e lotes (WP1R-06)', () => {
  const pagina = (total: number, n: number) => ({ total, itens: Array.from({ length: n }, (_, i) => i) })
  it('carrega a próxima página até cobrir o total do servidor', () => {
    expect(proximoOffsetCarteira([pagina(2, 2)])).toBeUndefined()
    expect(proximoOffsetCarteira([pagina(350, 200)])).toBe(200)
    expect(proximoOffsetCarteira([pagina(350, 200), pagina(350, 150)])).toBeUndefined()
    // a carteira encolheu entre as páginas (página vazia): para
    expect(proximoOffsetCarteira([pagina(350, 200), pagina(180, 0)])).toBeUndefined()
    expect(proximoOffsetCarteira([])).toBeUndefined()
  })
  it('"Todos" diz quando a lista não tem a carteira inteira', () => {
    expect(rotuloTodosCarteira(2, 2)).toBe('Todos (2)')
    expect(rotuloTodosCarteira(200, 350)).toBe('Todos os 200 carregados (de 350)')
  })
  it('lotes de até 500 ids, na ordem', () => {
    const ids = Array.from({ length: 1201 }, (_, i) => String(i))
    const lotes = emLotes(ids)
    expect(lotes.map((l) => l.length)).toEqual([TRANSFERENCIA_POR_LOTE, TRANSFERENCIA_POR_LOTE, 201])
    expect(lotes.flat()).toEqual(ids)
    expect(emLotes([])).toEqual([])
  })
})

describe('Meu cadastro: CPF que não ficou gravado (WP1R-04)', () => {
  it('confere o CPF enviado no detalhe relido', () => {
    expect(cpfFicouGravado(undefined, null)).toBe(true)
    expect(cpfFicouGravado('123.456.703-20', { cpf: '12345670320' })).toBe(true)
    expect(cpfFicouGravado('12345670320', { cpf: null })).toBe(false)
    expect(cpfFicouGravado('12345670320', null)).toBe(false)
  })
})

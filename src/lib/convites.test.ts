import { describe, expect, it } from 'vitest'
import { lerListaConvites, mensagemConvite } from './convites'

describe('lerListaConvites', () => {
  it('lê "nome; e-mail; telefone; CRECI; imobiliária" e ignora cabeçalho e linhas vazias', () => {
    const texto = 'Nome; E-mail; Telefone; CRECI; Imobiliária\nMaria Souza; MARIA@Imob.com.br; (11) 98888-7777; 123-F; Imob Centro\n\nJoão Lima; joao@gmail.com'
    expect(lerListaConvites(texto)).toEqual([
      { nome: 'Maria Souza', email: 'maria@imob.com.br', telefone: '(11) 98888-7777', creci: '123-F', imobiliaria: 'Imob Centro' },
      { nome: 'João Lima', email: 'joao@gmail.com', telefone: undefined, creci: undefined, imobiliaria: undefined },
    ])
  })
  it('aceita TAB (colado do Excel) e e-mail em outra coluna', () => {
    expect(lerListaConvites('ana@x.com\tAna Paula\t11999998888')).toEqual([
      { nome: 'Ana Paula', email: 'ana@x.com', telefone: '11999998888', creci: undefined, imobiliaria: undefined },
    ])
  })
  it('linha sem e-mail continua na lista (o servidor recusa e o admin vê o erro)', () => {
    expect(lerListaConvites('Fulano; 11999998888')[0].email).toBe('11999998888')
  })
})

describe('mensagemConvite', () => {
  it('usa o primeiro nome e inclui o link', () => {
    const m = mensagemConvite('Maria Souza', 'https://x/y')
    expect(m.startsWith('Olá, Maria!')).toBe(true)
    expect(m).toContain('https://x/y')
  })
  it('sem nome', () => expect(mensagemConvite('', 'L').startsWith('Olá!')).toBe(true))
})

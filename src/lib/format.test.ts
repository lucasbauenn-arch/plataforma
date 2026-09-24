import { describe, expect, it } from 'vitest'
import { brl, cpfValido, mascaraCpf, mascaraTelefone, soDigitos, whatsappBR, youtubeId } from './format'

describe('cpfValido', () => {
  it('aceita CPFs válidos com ou sem máscara', () => {
    expect(cpfValido('529.982.247-25')).toBe(true)
    expect(cpfValido('52998224725')).toBe(true)
    expect(cpfValido('111.444.777-35')).toBe(true)
  })
  it('recusa dígito verificador errado, tamanho errado e dígitos repetidos', () => {
    expect(cpfValido('529.982.247-24')).toBe(false)
    expect(cpfValido('5299822472')).toBe(false)
    expect(cpfValido('222.222.222-22')).toBe(false)
    expect(cpfValido('')).toBe(false)
  })
})

describe('máscaras', () => {
  it('CPF', () => {
    expect(mascaraCpf('52998224725')).toBe('529.982.247-25')
    expect(mascaraCpf('5299')).toBe('529.9')
    expect(mascaraCpf('529.982.247-25999')).toBe('529.982.247-25')
  })
  it('telefone fixo e celular', () => {
    expect(mascaraTelefone('1132004821')).toBe('(11) 3200-4821')
    expect(mascaraTelefone('11932004821')).toBe('(11) 93200-4821')
    expect(mascaraTelefone('(11) 9')).toBe('(11) 9')
  })
  it('soDigitos', () => expect(soDigitos('(11) 9-32')).toBe('11932'))
})

describe('whatsappBR', () => {
  it('adiciona o DDI 55', () => {
    expect(whatsappBR('(11) 97777-6666')).toBe('5511977776666')
    expect(whatsappBR('1132004821')).toBe('551132004821')
  })
  it('mantém número que já tem 55', () => expect(whatsappBR('+55 11 97777-6666')).toBe('5511977776666'))
  it('null para número incompleto ou vazio', () => {
    expect(whatsappBR('97777-6666')).toBeNull()
    expect(whatsappBR(null)).toBeNull()
  })
})

describe('youtubeId', () => {
  it('extrai o id de vários formatos de link', () => {
    expect(youtubeId('https://youtu.be/uHtxssXB8PA')).toBe('uHtxssXB8PA')
    expect(youtubeId('https://www.youtube.com/watch?v=uHtxssXB8PA&t=10')).toBe('uHtxssXB8PA')
    expect(youtubeId('https://www.youtube.com/shorts/uHtxssXB8PA')).toBe('uHtxssXB8PA')
    expect(youtubeId('https://vimeo.com/123')).toBeNull()
  })
})

describe('brl', () => {
  it('formata em reais sem centavos', () => expect(brl(280000).replace(/\s/g, ' ')).toBe('R$ 280.000'))
  it('traço para vazio', () => expect(brl(null)).toBe('—'))
})

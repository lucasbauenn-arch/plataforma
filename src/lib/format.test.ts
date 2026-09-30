import { describe, expect, it } from 'vitest'
import {
  brl, brlCentavos, cnpjValido, codigoExibicao, cpfValido, mascaraCep, mascaraCnpj, mascaraCpf, mascaraDocumento, mascaraMoeda,
  mascaraTelefone, moedaParaNumero, percentual, soDigitos, whatsappBR, youtubeId,
} from './format'

const semEspacoEspecial = (s: string) => s.replace(/\s/g, ' ')

describe('cnpjValido', () => {
  it('aceita CNPJs válidos com ou sem máscara', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido('11222333000181')).toBe(true)
    expect(cnpjValido('45.723.174/0001-10')).toBe(true)
    expect(cnpjValido('00.000.000/0001-91')).toBe(true)
  })
  it('recusa dígito verificador errado, tamanho errado e dígitos repetidos', () => {
    expect(cnpjValido('11.222.333/0001-80')).toBe(false)
    expect(cnpjValido('11.222.333/0001-71')).toBe(false)
    expect(cnpjValido('1122233300018')).toBe(false)
    expect(cnpjValido('112223330001811')).toBe(false)
    expect(cnpjValido('11111111111111')).toBe(false)
    expect(cnpjValido('')).toBe(false)
  })
})

describe('mascaraCnpj e mascaraCep', () => {
  it('CNPJ completo, parcial e com excesso', () => {
    expect(mascaraCnpj('11222333000181')).toBe('11.222.333/0001-81')
    expect(mascaraCnpj('1122233')).toBe('11.222.33')
    expect(mascaraCnpj('112223330')).toBe('11.222.333/0')
    expect(mascaraCnpj('1122233300018')).toBe('11.222.333/0001-8')
    expect(mascaraCnpj('11.222.333/0001-81999')).toBe('11.222.333/0001-81')
    expect(mascaraCnpj('')).toBe('')
  })
  it('CEP completo, parcial e com excesso', () => {
    expect(mascaraCep('03333050')).toBe('03333-050')
    expect(mascaraCep('0333')).toBe('0333')
    expect(mascaraCep('033330')).toBe('03333-0')
    expect(mascaraCep('03333-050-9')).toBe('03333-050')
  })
  it('mascaraDocumento escolhe CPF ou CNPJ pelo tamanho', () => {
    expect(mascaraDocumento('52998224725')).toBe('529.982.247-25')
    expect(mascaraDocumento('11222333000181')).toBe('11.222.333/0001-81')
    expect(mascaraDocumento(null)).toBe('')
  })
})

describe('moedaParaNumero', () => {
  it('lê moeda em pt-BR com ou sem símbolo e separadores', () => {
    expect(moedaParaNumero('R$ 1.234,56')).toBe(1234.56)
    expect(moedaParaNumero('R$ 500.000,00')).toBe(500000)
    expect(moedaParaNumero('1234,5')).toBe(1234.5)
    expect(moedaParaNumero('1.234')).toBe(1234)
    expect(moedaParaNumero('1.234.567')).toBe(1234567)
    expect(moedaParaNumero('1234.56')).toBe(1234.56)
    expect(moedaParaNumero('0,1')).toBe(0.1)
    expect(moedaParaNumero('-10,00')).toBe(-10)
  })
  it('arredonda para centavos sem erro de ponto flutuante (metade para longe do zero)', () => {
    expect(moedaParaNumero('10,005')).toBe(10.01)
    expect(moedaParaNumero('1,005')).toBe(1.01)
    expect(moedaParaNumero('1,004')).toBe(1)
    expect(moedaParaNumero('-1,005')).toBe(-1.01)
  })
  it('null para vazio ou inválido', () => {
    expect(moedaParaNumero('')).toBeNull()
    expect(moedaParaNumero(null)).toBeNull()
    expect(moedaParaNumero('R$ ')).toBeNull()
    expect(moedaParaNumero('abc')).toBeNull()
    expect(moedaParaNumero('1,2,3')).toBeNull()
  })
  it('ida e volta com a máscara de digitação', () => {
    expect(mascaraMoeda('123456')).toBe('1.234,56')
    expect(mascaraMoeda('R$ 0,05')).toBe('0,05')
    expect(mascaraMoeda('')).toBe('')
    expect(moedaParaNumero(mascaraMoeda('50000000'))).toBe(500000)
  })
})

describe('brlCentavos, percentual e codigoExibicao', () => {
  it('mostra os centavos', () => {
    expect(semEspacoEspecial(brlCentavos(1808.33))).toBe('R$ 1.808,33')
    expect(semEspacoEspecial(brlCentavos(108500))).toBe('R$ 108.500,00')
    expect(semEspacoEspecial(brlCentavos(0.2))).toBe('R$ 0,20')
  })
  it('traço para vazio', () => expect(brlCentavos(null)).toBe('—'))
  it('percentual na unidade do banco', () => {
    expect(percentual(8.5)).toBe('8,5%')
    expect(percentual(30)).toBe('30%')
    expect(percentual(null)).toBe('—')
  })
  it('código com 7 dígitos', () => {
    expect(codigoExibicao(7)).toBe('#0000007')
    expect(codigoExibicao(1234567)).toBe('#1234567')
    expect(codigoExibicao(null)).toBe('—')
  })
})

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

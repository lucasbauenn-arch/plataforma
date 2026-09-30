import { describe, expect, it } from 'vitest'
import { aceitarDe, caminhoEnvio, limiteEnvio, MAX_BYTES_DOCUMENTO, rotuloFormatos, tamanhoLegivel, validarArquivo } from './envio'

const C = 'd0000000-0000-4000-8000-000000000001'
const D = 'f0000000-0000-4000-8000-000000000301'
const A = 'a0000000-0000-4000-8000-0000000000aa'

describe('envio de documento pelo portal', () => {
  it('aceita o formato da solicitação', () => {
    expect(validarArquivo({ name: 'rg.PDF', size: 1000, type: 'application/pdf' }, ['jpeg', 'png', 'pdf']))
      .toEqual({ ok: true, extensao: 'pdf', mime: 'application/pdf' })
    expect(validarArquivo({ name: 'foto.jpeg', size: 10, type: 'image/jpeg' }, ['jpeg']))
      .toEqual({ ok: true, extensao: 'jpg', mime: 'image/jpeg' })
    expect(validarArquivo({ name: 'foto.jpg', size: 10, type: '' }, ['jpeg']))
      .toEqual({ ok: true, extensao: 'jpg', mime: 'image/jpeg' })
  })

  it('recusa formato, tipo, vazio e tamanho', () => {
    expect(validarArquivo({ name: 'a.docx', size: 10, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, ['pdf']))
      .toEqual({ ok: false, erro: 'Formato não aceito. Envie PDF.' })
    expect(validarArquivo({ name: 'a.pdf', size: 10, type: 'image/png' }, ['pdf'])).toMatchObject({ ok: false })
    expect(validarArquivo({ name: 'semextensao', size: 10, type: '' }, ['pdf'])).toMatchObject({ ok: false })
    expect(validarArquivo({ name: 'a.pdf', size: 0, type: 'application/pdf' }, ['pdf'])).toEqual({ ok: false, erro: 'O arquivo está vazio.' })
    expect(validarArquivo({ name: 'a.pdf', size: MAX_BYTES_DOCUMENTO + 1, type: 'application/pdf' }, ['pdf']))
      .toEqual({ ok: false, erro: 'O arquivo passa de 5 MB.' })
  })

  it('limite configurado pelo Super (WP6R-02): nunca acima do bucket; ausente ou inválido cai no do bucket', () => {
    expect(limiteEnvio(1_048_576)).toBe(1_048_576)
    expect(limiteEnvio(MAX_BYTES_DOCUMENTO * 2)).toBe(MAX_BYTES_DOCUMENTO)
    expect(limiteEnvio(undefined)).toBe(MAX_BYTES_DOCUMENTO)
    expect(limiteEnvio(null)).toBe(MAX_BYTES_DOCUMENTO)
    expect(limiteEnvio(0)).toBe(MAX_BYTES_DOCUMENTO)
    expect(limiteEnvio(Number.NaN)).toBe(MAX_BYTES_DOCUMENTO)
    expect(limiteEnvio(1500.7)).toBe(1500)
    // o arquivo que passa do limite configurado é recusado antes de subir, com o limite na mensagem
    expect(validarArquivo({ name: 'a.pdf', size: 1_048_577, type: 'application/pdf' }, ['pdf'], limiteEnvio(1_048_576)))
      .toEqual({ ok: false, erro: 'O arquivo passa de 1 MB.' })
    expect(validarArquivo({ name: 'a.pdf', size: 1_048_576, type: 'application/pdf' }, ['pdf'], limiteEnvio(1_048_576)))
      .toMatchObject({ ok: true })
  })

  it('tamanho legível na mensagem', () => {
    expect(tamanhoLegivel(5 * 1024 * 1024)).toBe('5 MB')
    expect(tamanhoLegivel(1.5 * 1024 * 1024)).toBe('1,5 MB')
    expect(tamanhoLegivel(500 * 1024)).toBe('500 KB')
    expect(tamanhoLegivel(10)).toBe('1 KB')
  })

  it('rótulos e accept', () => {
    expect(rotuloFormatos(['jpeg', 'png', 'pdf'])).toBe('JPEG, PNG ou PDF')
    expect(rotuloFormatos(['pdf'])).toBe('PDF')
    expect(aceitarDe(['pdf'])).toBe('.pdf,application/pdf')
  })

  it('caminho sem dado pessoal, no formato do bucket', () => {
    expect(caminhoEnvio(C, D, A, 'pdf')).toBe(`${C}/${D}/${A}.pdf`)
    expect(() => caminhoEnvio('../x', D, A, 'pdf')).toThrow()
    expect(() => caminhoEnvio(C, D, A, 'exe')).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { podeVisualizar } from './arquivos'

describe('podeVisualizar', () => {
  it('mostra imagem e PDF no navegador', () => {
    expect(podeVisualizar('image/jpeg')).toBe(true)
    expect(podeVisualizar('image/png')).toBe(true)
    expect(podeVisualizar('application/pdf')).toBe(true)
  })
  it('DOC/DOCX só baixando', () => {
    expect(podeVisualizar('application/msword')).toBe(false)
    expect(podeVisualizar('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false)
  })
})

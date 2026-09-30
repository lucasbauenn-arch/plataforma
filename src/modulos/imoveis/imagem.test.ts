import { describe, expect, it } from 'vitest'
import {
  caminhosDaFoto, codificarNoLimite, dimensoesReduzidas, formatarBytes, LADO_MAXIMO, LADO_MINIATURA, ORIGINAL_MAX_BYTES,
  RE_CAMINHO_FOTO, validarArquivo,
} from './imagem'

describe('dimensoesReduzidas (WebP ≤ 1920 px e miniatura de 480 px)', () => {
  it('reduz pelo maior lado, mantendo a proporção', () => {
    expect(dimensoesReduzidas(4000, 3000, LADO_MAXIMO)).toEqual({ largura: 1920, altura: 1440 })
    expect(dimensoesReduzidas(3000, 4000, LADO_MAXIMO)).toEqual({ largura: 1440, altura: 1920 })
    expect(dimensoesReduzidas(1920, 1440, LADO_MINIATURA)).toEqual({ largura: 480, altura: 360 })
  })
  it('nunca amplia e nunca zera um lado', () => {
    expect(dimensoesReduzidas(800, 600, LADO_MAXIMO)).toEqual({ largura: 800, altura: 600 })
    expect(dimensoesReduzidas(10000, 2, LADO_MAXIMO)).toEqual({ largura: 1920, altura: 1 })
  })
  it('recusa dimensões inválidas', () => {
    expect(() => dimensoesReduzidas(0, 100, LADO_MAXIMO)).toThrow()
    expect(() => dimensoesReduzidas(Number.NaN, 100, LADO_MAXIMO)).toThrow()
  })
})

describe('validarArquivo (antes da redução)', () => {
  it('aceita JPG, PNG e WEBP', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(validarArquivo({ name: 'a', type, size: 1000 })).toBeNull()
  })
  it('recusa outros tipos, vazio e arquivo grande demais', () => {
    expect(validarArquivo({ name: 'a.gif', type: 'image/gif', size: 10 })).toMatch(/JPG, PNG ou WEBP/)
    expect(validarArquivo({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toMatch(/"a\.pdf"/)
    expect(validarArquivo({ type: 'image/png', size: 0 })).toMatch(/vazio/)
    expect(validarArquivo({ name: 'a.jpg', type: 'image/jpeg', size: ORIGINAL_MAX_BYTES + 1 })).toMatch(/passa de 40 MB/)
  })
})

describe('caminhosDaFoto (§3.10)', () => {
  const imovel = 'e5000000-0000-4000-8000-000000000009'
  it('<imovel_id>/<uuid>.<ext> e <uuid>-min.<ext>, no formato que a política e a RPC exigem', () => {
    const c = caminhosDaFoto(imovel, 'ABCDEF01-2345-4678-89AB-CDEF01234567', 'webp')
    expect(c).toEqual({
      principal: `${imovel}/abcdef01-2345-4678-89ab-cdef01234567.webp`,
      miniatura: `${imovel}/abcdef01-2345-4678-89ab-cdef01234567-min.webp`,
    })
    expect(RE_CAMINHO_FOTO.test(c.principal)).toBe(true)
    expect(RE_CAMINHO_FOTO.test(c.miniatura)).toBe(true)
    expect(RE_CAMINHO_FOTO.test(caminhosDaFoto(imovel, crypto.randomUUID(), 'jpg').principal)).toBe(true)
  })
  it('o formato recusa subpasta, maiúsculas e extensão fora da lista', () => {
    expect(RE_CAMINHO_FOTO.test(`${imovel}/a/b.webp`)).toBe(false)
    expect(RE_CAMINHO_FOTO.test(`${imovel}/Foto.webp`)).toBe(false)
    expect(RE_CAMINHO_FOTO.test(`${imovel}/foto.gif`)).toBe(false)
    expect(RE_CAMINHO_FOTO.test('outra-pasta/foto.webp')).toBe(false)
  })
})

describe('codificarNoLimite', () => {
  const blob = (n: number) => new Blob([new Uint8Array(n)])
  it('usa a primeira qualidade que cabe no limite do servidor', async () => {
    const tentadas: number[] = []
    const b = await codificarNoLimite(async (q) => { tentadas.push(q); return blob(q >= 0.7 ? 2000 : 900) }, [0.8, 0.7, 0.6, 0.5], 1000)
    expect(b.size).toBe(900)
    expect(tentadas).toEqual([0.8, 0.7, 0.6])
  })
  it('desiste com mensagem quando nenhuma qualidade cabe', async () => {
    await expect(codificarNoLimite(async () => blob(5000), [0.8, 0.5], 1024)).rejects.toThrow(/maior que 1 KB/)
  })
  it('blob vazio não conta como sucesso', async () => {
    await expect(codificarNoLimite(async () => blob(0), [0.8], 1024)).rejects.toThrow()
  })
})

describe('formatarBytes', () => {
  it('MB com uma casa e KB inteiros', () => {
    expect(formatarBytes(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatarBytes(1.5 * 1024 * 1024)).toBe('1,5 MB')
    expect(formatarBytes(2048)).toBe('2 KB')
    expect(formatarBytes(10)).toBe('1 KB')
  })
})

import { describe, expect, it } from 'vitest'
import {
  SEGREDO_MINIMO,
  base64Url,
  hex,
  hmacSha256Hex,
  iguaisTempoConstante,
  paraBytes,
  segredoConfere,
  sha256Hex,
  tokenAleatorio,
  tokenConfereComHash,
} from './chaves.ts'

describe('sha256Hex', () => {
  it('vetores conhecidos (FIPS 180-2)', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('texto é UTF-8 e bytes dão o mesmo resultado', async () => {
    expect(await sha256Hex('ação')).toBe(await sha256Hex(new TextEncoder().encode('ação')))
  })
})

describe('hmacSha256Hex', () => {
  it('RFC 4231, caso 2', async () => {
    expect(await hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
  })
  it('segredo vazio é recusado', async () => {
    await expect(hmacSha256Hex('', 'x')).rejects.toThrow('vazio')
  })
})

describe('iguaisTempoConstante', () => {
  it('compara conteúdo e tamanho', () => {
    expect(iguaisTempoConstante('abc', 'abc')).toBe(true)
    expect(iguaisTempoConstante('', '')).toBe(true)
    expect(iguaisTempoConstante('abc', 'abd')).toBe(false)
    expect(iguaisTempoConstante('abc', 'abcd')).toBe(false)
    expect(iguaisTempoConstante('abcd', 'abc')).toBe(false)
    expect(iguaisTempoConstante('', 'a')).toBe(false)
    // prefixo com zeros não engana (bytes ausentes não viram 0 "iguais")
    expect(iguaisTempoConstante(new Uint8Array([1, 0]), new Uint8Array([1]))).toBe(false)
    expect(iguaisTempoConstante('ç', 'c')).toBe(false)
    expect(iguaisTempoConstante(new Uint8Array([9, 8]), 'x')).toBe(false)
  })
})

describe('tokenAleatorio', () => {
  it('32 bytes → 43 caracteres base64url, sem repetição', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => tokenAleatorio()))
    expect(tokens.size).toBe(200)
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(tokenAleatorio(16)).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })
  it('recusa tamanho fraco ou inválido', () => {
    for (const n of [0, 8, 15, 1025, 16.5, Number.NaN]) expect(() => tokenAleatorio(n)).toThrow(RangeError)
  })
  it('base64Url sem +, / nem =', () => {
    expect(base64Url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_')
    expect(base64Url(new Uint8Array([0xff]))).toBe('_w')
  })
})

describe('segredoConfere', () => {
  const segredo = 's'.repeat(SEGREDO_MINIMO)
  it('confere o segredo configurado', () => {
    expect(segredoConfere(segredo, segredo)).toBe(true)
    expect(segredoConfere(`${segredo}x`, segredo)).toBe(false)
    expect(segredoConfere(null, segredo)).toBe(false)
    expect(segredoConfere('', segredo)).toBe(false)
  })
  it('falha fechada quando o segredo configurado falta ou é curto', () => {
    expect(segredoConfere('', '')).toBe(false)
    expect(segredoConfere(null, null)).toBe(false)
    expect(segredoConfere(undefined, undefined)).toBe(false)
    expect(segredoConfere('curto', 'curto')).toBe(false)
    expect(segredoConfere('curto', 'curto', 3)).toBe(true)
  })
})

describe('tokenConfereComHash', () => {
  it('compara o sha256 do token com o hash guardado', async () => {
    const token = tokenAleatorio()
    const hash = await sha256Hex(token)
    expect(await tokenConfereComHash(token, hash)).toBe(true)
    expect(await tokenConfereComHash(token, hash.toUpperCase())).toBe(true)
    expect(await tokenConfereComHash(`${token}x`, hash)).toBe(false)
    expect(await tokenConfereComHash(token, 'abc')).toBe(false)
    expect(await tokenConfereComHash('', hash)).toBe(false)
    expect(await tokenConfereComHash(token, null)).toBe(false)
  })
})

describe('auxiliares', () => {
  it('hex e paraBytes', () => {
    expect(hex(new Uint8Array([0, 15, 255]))).toBe('000fff')
    expect(hex(new Uint8Array([1, 2]).buffer)).toBe('0102')
    const original = new Uint8Array([1, 2, 3])
    const copia = paraBytes(original)
    copia[0] = 9
    expect(original[0]).toBe(1)
  })
})

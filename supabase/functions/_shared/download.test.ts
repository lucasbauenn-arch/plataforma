import { describe, expect, it } from 'vitest'
import { lerPedidoDownload, segundosRestantes, TTL_MAXIMO_SEGUNDOS } from './download.ts'

const CAMINHO = 'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/f0000000-0000-4000-8000-000000000401.pdf'

describe('lerPedidoDownload', () => {
  it('aceita os dois buckets privados com o caminho devolvido pela RPC', () => {
    expect(lerPedidoDownload({ bucket: 'crm-documentos', path: CAMINHO })).toEqual({ ok: true, valor: { bucket: 'crm-documentos', path: CAMINHO } })
    expect(lerPedidoDownload({ bucket: 'contratos', path: 'e0000000-0000-4000-8000-000000000501/assinado-v1.pdf' }).ok).toBe(true)
  })

  it('recusa bucket fora da lista (imoveis e cliente-arquivos têm as próprias regras)', () => {
    for (const bucket of ['imoveis', 'cliente-arquivos', 'empreendimentos', '', null, 1, undefined]) {
      expect(lerPedidoDownload({ bucket, path: CAMINHO }).ok).toBe(false)
    }
  })

  it('recusa caminho vazio, longo, com .., barra inicial, barra dupla, barra invertida ou caractere de controle', () => {
    for (const path of ['', 'ab', 'x'.repeat(501), '/abs/x.pdf', 'a/../b.pdf', 'a/./b.pdf', 'a//b.pdf', 'a/b/', 'a\\b.pdf', 'a/b\u0000.pdf', 'a/b\n.pdf', 'a/b\u007f.pdf', 42, null]) {
      expect(lerPedidoDownload({ bucket: 'crm-documentos', path }).ok, String(path)).toBe(false)
    }
  })
})

describe('segundosRestantes', () => {
  const agora = Date.parse('2026-09-28T12:00:00.000Z')

  it('a URL vale no máximo até o fim da autorização (arredonda para baixo)', () => {
    expect(segundosRestantes('2026-09-28T12:01:00.000Z', agora)).toBe(60)
    expect(segundosRestantes('2026-09-28T12:00:59.999Z', agora)).toBe(59)
    expect(segundosRestantes('2026-09-28T12:00:01.500Z', agora)).toBe(1)
  })

  it('autorização vencida, a vencer em menos de 1 s ou data inválida: 0 (não assina)', () => {
    expect(segundosRestantes('2026-09-28T12:00:00.999Z', agora)).toBe(0)
    expect(segundosRestantes('2026-09-28T11:59:00.000Z', agora)).toBe(0)
    expect(segundosRestantes('ontem', agora)).toBe(0)
    expect(segundosRestantes(null, agora)).toBe(0)
    expect(segundosRestantes(undefined, agora)).toBe(0)
  })

  it('nunca passa do teto de download_ttl_segundos, mesmo com autorização longa', () => {
    expect(segundosRestantes('2036-09-28T12:00:00.000Z', agora)).toBe(TTL_MAXIMO_SEGUNDOS)
    expect(TTL_MAXIMO_SEGUNDOS).toBe(3600)
  })
})

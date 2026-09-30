import { describe, expect, it, vi } from 'vitest'
import { TURNSTILE_URL, statusFalhaTurnstile, validarTurnstile, type OpcoesTurnstile } from './turnstile.ts'

const SEGREDO = '1x0000000000000000000000000000000AA'

function respostaCloudflare(corpo: unknown, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }),
  )
}

const base = (extra: Partial<OpcoesTurnstile> = {}): OpcoesTurnstile => ({
  token: 'token-do-widget',
  segredo: SEGREDO,
  ambiente: 'producao',
  ip: '203.0.113.9',
  ...extra,
})

describe('validarTurnstile', () => {
  it('sucesso: envia segredo, token e remoteip para o siteverify', async () => {
    const f = respostaCloudflare({ success: true, hostname: 'arkenincorporadora.com.br', action: 'pre_cadastro', 'error-codes': [] })
    const r = await validarTurnstile(base({ fetch: f as unknown as typeof fetch, idempotencia: '0f8fad5b-d9cb-469f-a165-70867728950e' }))
    expect(r).toEqual({ ok: true, motivo: 'validado', codigos: [] })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe(TURNSTILE_URL)
    expect(init?.method).toBe('POST')
    const corpo = init?.body as URLSearchParams
    expect(corpo.get('secret')).toBe(SEGREDO)
    expect(corpo.get('response')).toBe('token-do-widget')
    expect(corpo.get('remoteip')).toBe('203.0.113.9')
    expect(corpo.get('idempotency_key')).toBe('0f8fad5b-d9cb-469f-a165-70867728950e')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('não manda remoteip nem idempotency_key inválidos', async () => {
    const f = respostaCloudflare({ success: true })
    await validarTurnstile(base({ ip: 'unknown', idempotencia: 'x', fetch: f as unknown as typeof fetch }))
    const corpo = f.mock.calls[0][1]?.body as URLSearchParams
    expect(corpo.has('remoteip')).toBe(false)
    expect(corpo.has('idempotency_key')).toBe(false)
  })

  it('recusado pela Cloudflare devolve os códigos', async () => {
    const f = respostaCloudflare({ success: false, 'error-codes': ['timeout-or-duplicate', 42] })
    const r = await validarTurnstile(base({ fetch: f as unknown as typeof fetch }))
    expect(r).toEqual({ ok: false, motivo: 'recusado', codigos: ['timeout-or-duplicate'] })
    expect(statusFalhaTurnstile(r)).toBe(403)
  })

  it('success que não é exatamente true é recusa', async () => {
    const f = respostaCloudflare({ success: 'true' })
    expect((await validarTurnstile(base({ fetch: f as unknown as typeof fetch }))).motivo).toBe('recusado')
  })

  it('sem segredo: produção recusa (503); fora de produção dispensa', async () => {
    const f = vi.fn()
    const prod = await validarTurnstile(base({ segredo: '', fetch: f as unknown as typeof fetch }))
    expect(prod).toMatchObject({ ok: false, motivo: 'sem_segredo' })
    expect(statusFalhaTurnstile(prod)).toBe(503)
    for (const ambiente of [null, undefined, 'desenvolvimento', 'homologacao']) {
      const dev = await validarTurnstile(base({ segredo: null, ambiente, token: undefined, fetch: f as unknown as typeof fetch }))
      expect(dev).toMatchObject({ ok: true, motivo: 'dispensado_sem_segredo' })
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('token ausente, vazio, não texto ou grande demais: recusa sem chamar a Cloudflare', async () => {
    const f = vi.fn()
    for (const token of [undefined, null, '', '   ', 123, { a: 1 }]) {
      expect(await validarTurnstile(base({ token, fetch: f as unknown as typeof fetch }))).toMatchObject({ ok: false, motivo: 'sem_token' })
    }
    const grande = await validarTurnstile(base({ token: 'x'.repeat(2049), fetch: f as unknown as typeof fetch }))
    expect(grande).toMatchObject({ ok: false, motivo: 'token_invalido' })
    expect(statusFalhaTurnstile(grande)).toBe(403)
    expect(f).not.toHaveBeenCalled()
  })

  it('tempo esgotado → indisponível (falha fechada)', async () => {
    const pendurado = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_ok, falhar) => {
          init?.signal?.addEventListener('abort', () => falhar(new DOMException('abortado', 'AbortError')))
        }),
    )
    const r = await validarTurnstile(base({ timeoutMs: 20, fetch: pendurado as unknown as typeof fetch }))
    expect(r).toEqual({ ok: false, motivo: 'indisponivel', codigos: ['tempo_esgotado'] })
    expect(statusFalhaTurnstile(r)).toBe(503)
  })

  it('erro de rede, HTTP ≠ 200 ou resposta ilegível → indisponível', async () => {
    const rede = vi.fn(async () => {
      throw new TypeError('falha de rede')
    })
    expect(await validarTurnstile(base({ fetch: rede as unknown as typeof fetch }))).toEqual({
      ok: false,
      motivo: 'indisponivel',
      codigos: ['falha_rede'],
    })
    const http500 = respostaCloudflare({ success: true }, 500)
    expect(await validarTurnstile(base({ fetch: http500 as unknown as typeof fetch }))).toMatchObject({
      ok: false,
      motivo: 'indisponivel',
      codigos: ['http_500'],
    })
    const html = vi.fn(async () => new Response('<html>', { status: 200 }))
    expect((await validarTurnstile(base({ fetch: html as unknown as typeof fetch }))).motivo).toBe('indisponivel')
    const nulo = respostaCloudflare(null)
    expect((await validarTurnstile(base({ fetch: nulo as unknown as typeof fetch }))).motivo).toBe('indisponivel')
  })

  it('confere hostname e action quando pedidos', async () => {
    const f = respostaCloudflare({ success: true, hostname: 'evil.com', action: 'outra' })
    const opcoes = { fetch: f as unknown as typeof fetch }
    expect((await validarTurnstile(base({ ...opcoes, hostnames: ['arkenincorporadora.com.br'] }))).motivo).toBe('hostname_invalido')
    expect((await validarTurnstile(base({ ...opcoes, acao: 'pre_cadastro' }))).motivo).toBe('acao_invalida')
    expect((await validarTurnstile(base({ ...opcoes, hostnames: ['evil.com'], acao: 'outra' }))).ok).toBe(true)
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  CABECALHOS_PERMITIDOS,
  SITE_PADRAO,
  agenteUsuario,
  cabecalhosCors,
  criarRespostas,
  criarRota,
  ehProducao,
  gruposIpv6,
  ipCliente,
  lerBytes,
  lerJson,
  lerTexto,
  mensagemSegura,
  montarCors,
  normalizarIp,
  origemPermitida,
  tokenBearer,
} from './http.ts'

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJh'

function corpoEmPedacos(pedacos: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const p of pedacos) c.enqueue(enc.encode(p))
      c.close()
    },
  })
}

const postJson = (corpo: string, cabecalhos: Record<string, string> = {}) =>
  new Request('https://x.supabase.co/functions/v1/f', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cabecalhos },
    body: corpo,
  })

describe('ehProducao', () => {
  it('reconhece produção com ou sem acento e em inglês', () => {
    for (const v of ['producao', 'Produção', ' PRODUCAO ', 'production', 'prod']) expect(ehProducao(v)).toBe(true)
  })
  it('ausente ou outro valor = desenvolvimento', () => {
    for (const v of [null, undefined, '', 'desenvolvimento', 'homologacao', 'producao2']) expect(ehProducao(v)).toBe(false)
  })
})

describe('CORS', () => {
  it('SITE_URL + variação www; localhost só fora de produção', () => {
    const dev = montarCors({ siteUrl: 'https://arkenincorporadora.com.br/', ambiente: null })
    expect(dev.origens).toEqual(['https://arkenincorporadora.com.br', 'https://www.arkenincorporadora.com.br'])
    expect(dev.localhost).toBe(true)
    const prod = montarCors({ siteUrl: 'https://www.arkenincorporadora.com.br', ambiente: 'producao' })
    expect(prod.origens).toEqual(['https://www.arkenincorporadora.com.br', 'https://arkenincorporadora.com.br'])
    expect(prod.localhost).toBe(false)
  })

  it('SITE_URL ausente, inválido ou http em produção → site oficial', () => {
    for (const siteUrl of [null, '', 'não é url', 'ftp://arken.com.br', 'http://arkenincorporadora.com.br']) {
      expect(montarCors({ siteUrl, ambiente: 'producao' }).origens[0]).toBe(SITE_PADRAO)
    }
  })

  it('http://localhost como SITE_URL só vale fora de produção', () => {
    expect(montarCors({ siteUrl: 'http://localhost:5173', ambiente: null }).origens).toEqual(['http://localhost:5173'])
    expect(montarCors({ siteUrl: 'http://localhost:5173', ambiente: 'producao' }).origens[0]).toBe(SITE_PADRAO)
  })

  it('aceita só origens exatas da lista (e localhost em dev)', () => {
    const dev = montarCors({ siteUrl: SITE_PADRAO, ambiente: null })
    const prod = montarCors({ siteUrl: SITE_PADRAO, ambiente: 'producao' })
    expect(origemPermitida('https://arkenincorporadora.com.br', prod)).toBe(true)
    expect(origemPermitida('https://www.arkenincorporadora.com.br', prod)).toBe(true)
    for (const o of [
      'http://arkenincorporadora.com.br',
      'https://arkenincorporadora.com.br.evil.com',
      'https://evilarkenincorporadora.com.br',
      'https://sub.arkenincorporadora.com.br',
      'https://arkenincorporadora.com.br:8443',
      'null',
      '',
      null,
    ]) {
      expect(origemPermitida(o, prod)).toBe(false)
    }
    expect(origemPermitida('http://localhost:5190', dev)).toBe(true)
    expect(origemPermitida('http://127.0.0.1:5173', dev)).toBe(true)
    expect(origemPermitida('http://[::1]:5173', dev)).toBe(true)
    expect(origemPermitida('http://localhost:5190', prod)).toBe(false)
    expect(origemPermitida('http://localhost.evil.com', dev)).toBe(false)
    expect(origemPermitida('https://localhost:5190', dev)).toBe(false)
  })

  it('devolve a origem só quando permitida, sempre com Vary', () => {
    const prod = montarCors({ siteUrl: SITE_PADRAO, ambiente: 'producao' })
    expect(cabecalhosCors(SITE_PADRAO, prod)).toMatchObject({ 'Access-Control-Allow-Origin': SITE_PADRAO, Vary: 'Origin' })
    const negada = cabecalhosCors('https://evil.com', prod)
    expect(negada).toEqual({ Vary: 'Origin' })
  })
})

describe('respostas', () => {
  it('json com cabeçalhos padrão e base', async () => {
    const r = criarRespostas({ 'X-Base': '1' }).json({ ok: true }, 201)
    expect(r.status).toBe(201)
    expect(r.headers.get('content-type')).toContain('application/json')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-base')).toBe('1')
    expect(await r.json()).toEqual({ ok: true })
  })

  it('erro no formato { erro, codigo, detalhes? }', async () => {
    const r = criarRespostas().erro(429, 'Muitas tentativas', { cabecalhos: { 'Retry-After': '900' } })
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toBe('900')
    expect(await r.json()).toEqual({ erro: 'Muitas tentativas', codigo: 'muitas_tentativas' })
    const d = criarRespostas().erro(422, 'Campos inválidos', { codigo: 'campos', detalhes: { campos: ['cpf'] } })
    expect(await d.json()).toEqual({ erro: 'Campos inválidos', codigo: 'campos', detalhes: { campos: ['cpf'] } })
    expect(await criarRespostas().erro(418, 'x').json()).toEqual({ erro: 'x', codigo: 'requisicao_invalida' })
    expect(await criarRespostas().erro(504, 'x').json()).toEqual({ erro: 'x', codigo: 'erro_interno' })
  })
})

describe('leitura do corpo', () => {
  it('lê JSON válido', async () => {
    expect(await lerJson(postJson('{"a":1,"b":"ç"}'))).toEqual({ ok: true, valor: { a: 1, b: 'ç' } })
  })

  it('recusa pelo Content-Length antes de ler', async () => {
    const r = await lerJson(postJson('{}', { 'content-length': '999999' }), { limiteBytes: 100 })
    expect(r).toMatchObject({ ok: false, status: 413, codigo: 'corpo_grande_demais' })
  })

  it('recusa quando o que chega passa do limite, mesmo sem Content-Length', async () => {
    const req = new Request('https://x/f', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corpoEmPedacos(['{"a":"', 'x'.repeat(60), 'y'.repeat(60), '"}']),
      duplex: 'half',
    } as RequestInit)
    expect(await lerJson(req, { limiteBytes: 100 })).toMatchObject({ ok: false, status: 413 })
  })

  it('aceita exatamente no limite', async () => {
    const corpo = `{"a":"${'x'.repeat(92)}"}`
    expect(new TextEncoder().encode(corpo).length).toBe(100)
    expect(await lerJson(postJson(corpo), { limiteBytes: 100 })).toMatchObject({ ok: true })
  })

  it('Content-Length malformado → 400', async () => {
    expect(await lerJson(postJson('{}', { 'content-length': '12abc' }))).toMatchObject({ ok: false, status: 400 })
  })

  it('exige application/json (força o preflight do navegador)', async () => {
    const texto = new Request('https://x/f', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"a":1}' })
    expect(await lerJson(texto)).toMatchObject({ ok: false, status: 415 })
    const comCharset = postJson('{"a":1}', { 'content-type': 'Application/JSON; charset=utf-8' })
    expect(await lerJson(comCharset)).toMatchObject({ ok: true })
    const livre = new Request('https://x/f', { method: 'POST', body: '{"a":1}' })
    expect(await lerJson(livre, { exigirTipoJson: false })).toMatchObject({ ok: true, valor: { a: 1 } })
  })

  it('JSON inválido, vazio ou que não é objeto → 400', async () => {
    for (const corpo of ['{a:1}', '', '   ', '[1,2]', 'null', '"texto"', '42']) {
      expect(await lerJson(postJson(corpo))).toMatchObject({ ok: false, status: 400 })
    }
  })

  it('UTF-8 inválido → 400', async () => {
    const req = new Request('https://x/f', { method: 'POST', body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) })
    expect(await lerTexto(req, 100)).toMatchObject({ ok: false, status: 400 })
  })

  it('lerBytes devolve o corpo cru (para HMAC) e vazio sem corpo', async () => {
    const r = await lerBytes(new Request('https://x/f', { method: 'POST', body: 'uuid=1&type_post=1' }), 1000)
    expect(r.ok && new TextDecoder().decode(r.valor)).toBe('uuid=1&type_post=1')
    const vazio = await lerBytes(new Request('https://x/f', { method: 'GET' }), 1000)
    expect(vazio.ok && vazio.valor.length).toBe(0)
  })

  it('limite inválido é erro de programação', async () => {
    await expect(lerBytes(postJson('{}'), 0)).rejects.toThrow(RangeError)
  })
})

describe('tokenBearer', () => {
  it('extrai o JWT', () => {
    expect(tokenBearer(new Headers({ authorization: `Bearer ${JWT}` }))).toBe(JWT)
    expect(tokenBearer(new Headers({ authorization: `bearer   ${JWT} ` }))).toBe(JWT)
  })
  it('recusa ausência, outro esquema e chave de API no lugar do JWT', () => {
    for (const v of [undefined, '', 'Basic abc', `Bearer`, 'Bearer sb_publishable_abc123', 'Bearer a.b', `Bearer ${JWT} extra`]) {
      const h = new Headers()
      if (v !== undefined) h.set('authorization', v)
      expect(tokenBearer(h)).toBeNull()
    }
    expect(tokenBearer(new Headers({ authorization: `Bearer ${'a'.repeat(5000)}.${'b'.repeat(5000)}.c` }))).toBeNull()
  })
})

describe('IP do cliente', () => {
  it('normaliza IPv4, IPv6, IPv4 mapeado, colchetes e porta', () => {
    expect(normalizarIp(' 203.0.113.9 ')).toBe('203.0.113.9')
    expect(normalizarIp('203.0.113.9:4431')).toBe('203.0.113.9')
    expect(normalizarIp('2001:DB8:0:0:0:0:0:1')).toBe('2001:db8::1')
    expect(normalizarIp('[2001:db8::1]:443')).toBe('2001:db8::1')
    expect(normalizarIp('::ffff:198.51.100.7')).toBe('198.51.100.7')
    expect(normalizarIp('::1')).toBe('::1')
  })
  it('recusa lixo', () => {
    for (const v of ['', 'unknown', '256.1.1.1', '01.2.3.4', '1.2.3', '1.2.3.4.5', 'fe80::1%eth0', '::g', '1:2:3:4:5:6:7:8:9', "1.2.3.4' or 1=1", null]) {
      expect(normalizarIp(v)).toBeNull()
    }
  })
  it('gruposIpv6 expande a forma comprimida', () => {
    expect(gruposIpv6('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])
    expect(gruposIpv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(gruposIpv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(gruposIpv6('1::2::3')).toBeNull()
    expect(gruposIpv6('1:2:3')).toBeNull()
  })
  it('prioridade: cf-connecting-ip, depois 1º item do x-forwarded-for, depois x-real-ip', () => {
    const h = new Headers({ 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '203.0.113.5, 10.0.0.1', 'x-real-ip': '192.0.2.1' })
    expect(ipCliente(h)).toBe('198.51.100.1')
    h.delete('cf-connecting-ip')
    expect(ipCliente(h)).toBe('203.0.113.5')
    h.set('x-forwarded-for', 'unknown, 10.0.0.1')
    expect(ipCliente(h)).toBe('192.0.2.1')
    expect(ipCliente(new Headers())).toBeNull()
  })
  it('user agent sem controle e truncado', () => {
    expect(agenteUsuario(new Headers({ 'user-agent': 'Mozilla\t/5.0' }))).toBe('Mozilla/5.0')
    expect(agenteUsuario(new Headers({ 'user-agent': 'x'.repeat(500) }))?.length).toBe(300)
    expect(agenteUsuario(new Headers())).toBeNull()
  })
})

describe('mensagemSegura', () => {
  it('tira query string, Bearer, JWT e chaves sb_', () => {
    const erro = new TypeError(
      'error sending request for url (https://secure.d4sign.com.br/api/v1/documents?tokenAPI=live_abc&cryptKey=xyz): Bearer abc.def sb_secret_ZZZ ' + JWT,
    )
    const m = mensagemSegura(erro)
    expect(m).toContain('https://secure.d4sign.com.br/api/v1/documents?[omitido]')
    for (const segredo of ['live_abc', 'xyz', 'abc.def', 'ZZZ', JWT]) expect(m).not.toContain(segredo)
  })
  it('aceita qualquer coisa e trunca', () => {
    expect(mensagemSegura({ a: 1 })).toBe('{"a":1}')
    expect(mensagemSegura('x'.repeat(900)).length).toBe(500)
    const ciclo: Record<string, unknown> = {}
    ciclo.eu = ciclo
    expect(mensagemSegura(ciclo)).toBe('[object Object]')
  })
})

describe('criarRota', () => {
  const cors = montarCors({ siteUrl: SITE_PADRAO, ambiente: 'producao' })
  const ok = criarRota({ nome: 't', cors }, (_req, r) => r.json({ ok: true }))

  it('preflight de origem permitida', async () => {
    const r = await ok(new Request('https://x/f', { method: 'OPTIONS', headers: { origin: SITE_PADRAO } }))
    expect(r.status).toBe(204)
    expect(r.headers.get('access-control-allow-origin')).toBe(SITE_PADRAO)
    expect(r.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    expect(r.headers.get('access-control-allow-headers')).toBe(CABECALHOS_PERMITIDOS)
  })

  it('origem fora da lista é recusada antes do manipulador (preflight e requisição)', async () => {
    const manipulador = vi.fn((_req: Request, r: ReturnType<typeof criarRespostas>) => r.json({ ok: true }))
    const rota = criarRota({ nome: 't', cors }, manipulador)
    const pre = await rota(new Request('https://x/f', { method: 'OPTIONS', headers: { origin: 'https://evil.com' } }))
    expect(pre.status).toBe(403)
    expect(pre.headers.get('access-control-allow-origin')).toBeNull()
    const post = await rota(postJson('{}', { origin: 'https://evil.com' }))
    expect(post.status).toBe(403)
    expect(await post.json()).toMatchObject({ codigo: 'origem_nao_permitida' })
    expect(manipulador).not.toHaveBeenCalled()
  })

  it('requisição do site recebe CORS; sem Origin (servidor) passa sem CORS', async () => {
    const doSite = await ok(postJson('{}', { origin: 'https://www.arkenincorporadora.com.br' }))
    expect(doSite.status).toBe(200)
    expect(doSite.headers.get('access-control-allow-origin')).toBe('https://www.arkenincorporadora.com.br')
    const semOrigem = await ok(postJson('{}'))
    expect(semOrigem.status).toBe(200)
    expect(semOrigem.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('método fora da lista → 405 com Allow', async () => {
    const r = await ok(new Request('https://x/f', { method: 'GET', headers: { origin: SITE_PADRAO } }))
    expect(r.status).toBe(405)
    expect(r.headers.get('allow')).toBe('POST, OPTIONS')
    expect(r.headers.get('access-control-allow-origin')).toBe(SITE_PADRAO)
  })

  it('rota entre servidores (sem cors): OPTIONS → 405, sem cabeçalhos CORS', async () => {
    const servidor = criarRota({ nome: 'cron' }, (_req, r) => r.json({ ok: true }))
    const r = await servidor(new Request('https://x/f', { method: 'OPTIONS', headers: { origin: SITE_PADRAO } }))
    expect(r.status).toBe(405)
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
    expect((await servidor(postJson('{}'))).status).toBe(200)
  })

  it('erro inesperado → 500 genérico, com log sem segredo', async () => {
    const aoFalhar = vi.fn()
    const rota = criarRota({ nome: 'quebra', cors, aoFalhar }, () => {
      throw new Error('falhou em https://api.d4sign/x?tokenAPI=segredo')
    })
    const r = await rota(postJson('{}', { origin: SITE_PADRAO }))
    expect(r.status).toBe(500)
    const corpo = await r.json()
    expect(corpo).toEqual({ erro: 'Erro interno. Tente novamente em instantes.', codigo: 'erro_interno' })
    expect(JSON.stringify(corpo)).not.toContain('segredo')
    expect(r.headers.get('access-control-allow-origin')).toBe(SITE_PADRAO)
    expect(aoFalhar).toHaveBeenCalledWith('quebra', expect.any(Error))
  })

  it('log padrão passa pela mensagemSegura', async () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rota = criarRota({ nome: 'quebra' }, () => Promise.reject(new Error('url https://h/p?tokenAPI=segredo')))
    expect((await rota(postJson('{}'))).status).toBe(500)
    const registrado = espiao.mock.calls.flat().join('\n')
    expect(registrado).toContain('[quebra]')
    expect(registrado).not.toContain('segredo')
    espiao.mockRestore()
  })

  it('log que lança não derruba a resposta', async () => {
    const rota = criarRota({ nome: 'x', aoFalhar: () => { throw new Error('log') } }, () => { throw new Error('a') })
    expect((await rota(postJson('{}'))).status).toBe(500)
  })
})

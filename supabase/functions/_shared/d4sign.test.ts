// D4Sign (§6.4, §6.5): token do webhook em tempo constante, HMAC, chave de idempotência, mapeamento de status,
// cliente HTTP sem vazar URL/token e orquestração do envio e da reconsulta com dublês.
import { describe, expect, it } from 'vitest'
import { hmacSha256Hex, sha256Hex, tokenConfereComHash } from './chaves.ts'
import {
  chaveIdempotencia, configD4sign, criarClienteD4sign, dataIso, enviarParaAssinatura, erroDaRpc, erroLimpo, ErroD4sign,
  hmacWebhookConfere, lerEventoWebhook, nomeDocumento, nomeDoEnvio, type PortasEnvio, prazoAssinatura, reconsultarDocumento, signatariosDoRetorno, statusDoDocumento,
  type ArgsRetorno, type ChamadaD4sign, type ClienteD4sign, type ConfigD4sign, type DocumentoD4sign, type SignatarioD4sign,
  type SignatarioEnviado, URL_PRODUCAO, URL_SANDBOX,
} from './d4sign.ts'

const bytes = (s: string) => new TextEncoder().encode(s)
const CFG: ConfigD4sign = { url: URL_SANDBOX, token: 'live_token_secreto', cryptKey: 'cripto_secreta', cofre: 'cofre-uuid-1' }
const PDF = bytes('%PDF-1.7 conteúdo')

describe('configuração (SEG-5)', () => {
  const env = { url: null, token: 'token-com-tamanho', cryptKey: 'k', cofre: 'cofre-1' }
  it('sandbox fora de produção e produção só em produção', () => {
    expect(configD4sign(env, false)).toMatchObject({ ok: true, config: { url: URL_SANDBOX } })
    expect(configD4sign(env, true)).toMatchObject({ ok: true, config: { url: URL_PRODUCAO } })
    expect(configD4sign({ ...env, url: URL_PRODUCAO }, false).ok).toBe(false)
    expect(configD4sign({ ...env, url: URL_SANDBOX }, true).ok).toBe(false)
  })
  it('recusa URL sem https, com query string ou outro host, e segredos ausentes', () => {
    expect(configD4sign({ ...env, url: 'http://sandbox.d4sign.com.br/api/v1' }, false).ok).toBe(false)
    expect(configD4sign({ ...env, url: `${URL_SANDBOX}?x=1` }, false).ok).toBe(false)
    expect(configD4sign({ ...env, url: 'https://evil.example/api/v1' }, false).ok).toBe(false)
    expect(configD4sign({ ...env, token: null }, false).ok).toBe(false)
    expect(configD4sign({ ...env, cofre: 'a/b' }, false).ok).toBe(false)
  })
  it('simulador local (stack de teste): só fora de produção, só http em host local, nunca com query string', () => {
    const local = 'http://host.docker.internal:54869/api/v1'
    expect(configD4sign({ ...env, url: local }, false)).toMatchObject({ ok: true, config: { url: local, simulado: true } })
    expect(configD4sign({ ...env, url: 'http://127.0.0.1:9999/api/v1/' }, false)).toMatchObject({ ok: true, config: { simulado: true } })
    // produção nunca aceita o simulador (SEG-5)
    expect(configD4sign({ ...env, url: local }, true).ok).toBe(false)
    expect(configD4sign({ ...env, url: 'http://localhost:54869/api/v1' }, true).ok).toBe(false)
    // http em qualquer outro host, https local (não é o sandbox) e credencial/query na URL continuam recusados
    expect(configD4sign({ ...env, url: 'http://evil.example/api/v1' }, false).ok).toBe(false)
    expect(configD4sign({ ...env, url: 'http://10.0.0.5/api/v1' }, false).ok).toBe(false)
    expect(configD4sign({ ...env, url: 'https://localhost/api/v1' }, false).ok).toBe(false)
    expect(configD4sign({ ...env, url: `${local}?x=1` }, false).ok).toBe(false)
    expect(configD4sign({ ...env, url: 'http://u:s@localhost:54869/api/v1' }, false).ok).toBe(false)
    // o sandbox de verdade não é marcado como simulado
    expect(configD4sign(env, false)).not.toMatchObject({ config: { simulado: true } })
  })
})

describe('webhook', () => {
  it('token do contrato: só o sha256 fica no banco e a conferência é em tempo constante', async () => {
    const hash = await sha256Hex('token-do-webhook-de-exemplo-123456')
    expect(await tokenConfereComHash('token-do-webhook-de-exemplo-123456', hash)).toBe(true)
    expect(await tokenConfereComHash('token-do-webhook-de-exemplo-123457', hash)).toBe(false)
    expect(await tokenConfereComHash(null, hash)).toBe(false)
  })

  it('HMAC do uuid (documentação) ou do corpo; formato sha256=<hex>', async () => {
    const corpo = bytes('uuid=doc-1&type_post=4')
    const doUuid = await hmacSha256Hex('segredo-hmac', 'doc-1')
    expect(await hmacWebhookConfere(`sha256=${doUuid}`, 'segredo-hmac', 'doc-1', corpo)).toBe(true)
    expect(await hmacWebhookConfere(doUuid.toUpperCase(), 'segredo-hmac', 'doc-1', corpo)).toBe(true)
    expect(await hmacWebhookConfere(`sha256=${await hmacSha256Hex('segredo-hmac', corpo)}`, 'segredo-hmac', 'doc-1', corpo)).toBe(true)
    expect(await hmacWebhookConfere(`sha256=${doUuid}`, 'outro-segredo', 'doc-1', corpo)).toBe(false)
    expect(await hmacWebhookConfere(`sha256=${doUuid}`, 'segredo-hmac', 'doc-2', corpo)).toBe(false)
    expect(await hmacWebhookConfere(null, 'segredo-hmac', 'doc-1', corpo)).toBe(false)
    expect(await hmacWebhookConfere('sha256=xyz', 'segredo-hmac', 'doc-1', corpo)).toBe(false)
  })

  it('lê form-urlencoded, JSON e multipart; uuid inválido → nulo', async () => {
    expect(await lerEventoWebhook(bytes('uuid=doc-1&type_post=4&email=A%40B.com&message=Signed'), 'application/x-www-form-urlencoded'))
      .toMatchObject({ uuid: 'doc-1', typePost: '4', email: 'a@b.com' })
    expect(await lerEventoWebhook(bytes('{"uuid":"doc-2","type_post":"1"}'), 'application/json')).toMatchObject({ uuid: 'doc-2', typePost: '1', email: null })
    const form = new FormData()
    form.set('uuid', 'doc-3')
    form.set('type_post', '3')
    const req = new Request('http://x', { method: 'POST', body: form })
    const corpo = new Uint8Array(await req.arrayBuffer())
    expect(await lerEventoWebhook(corpo, req.headers.get('content-type'))).toMatchObject({ uuid: 'doc-3', typePost: '3', email: null })
    expect(await lerEventoWebhook(bytes('uuid=../../x'), 'application/x-www-form-urlencoded')).toBeNull()
    expect(await lerEventoWebhook(bytes('{"uuid":'), 'application/json')).toBeNull()
    expect(await lerEventoWebhook(new Uint8Array([0xff, 0xfe]), 'text/plain')).toBeNull()
  })

  it('chave de idempotência = sha256(uuid|type_post|email|sha256(corpo canônico)), estável e sensível ao conteúdo', async () => {
    const evento = (await lerEventoWebhook(bytes('uuid=doc-1&type_post=4&email=a%40b.com'), 'application/x-www-form-urlencoded'))!
    const esperado = await sha256Hex(`doc-1|4|a@b.com|${await sha256Hex(evento.conteudo)}`)
    expect(await chaveIdempotencia(evento)).toBe(esperado)
    expect(await chaveIdempotencia(evento)).toBe(esperado)
    const outro = (await lerEventoWebhook(bytes('uuid=doc-1&type_post=4&email=a%40b.com&message=outro'), 'application/x-www-form-urlencoded'))!
    expect(await chaveIdempotencia(outro)).not.toBe(esperado)
  })

  it('o mesmo evento reenviado em multipart (fronteira nova a cada envio), urlencoded ou JSON dá a MESMA chave', async () => {
    const multipart = async () => {
      const form = new FormData()
      form.set('uuid', 'doc-9')
      form.set('type_post', '1')
      form.set('email', 'cliente@exemplo.com')
      form.set('message', 'Documento finalizado')
      const req = new Request('http://x', { method: 'POST', body: form })
      return lerEventoWebhook(new Uint8Array(await req.arrayBuffer()), req.headers.get('content-type'))
    }
    const a = (await multipart())!
    const b = (await multipart())!
    const u = (await lerEventoWebhook(bytes('message=Documento+finalizado&email=cliente%40exemplo.com&type_post=1&uuid=doc-9'), 'application/x-www-form-urlencoded'))!
    const j = (await lerEventoWebhook(bytes('{"uuid":"doc-9","type_post":"1","email":"cliente@exemplo.com","message":"Documento finalizado"}'), 'application/json'))!
    const chave = await chaveIdempotencia(a)
    expect(await chaveIdempotencia(b)).toBe(chave)
    expect(await chaveIdempotencia(u)).toBe(chave)
    expect(await chaveIdempotencia(j)).toBe(chave)
  })
})

describe('mapeamento de status', () => {
  it('documento', () => {
    expect(statusDoDocumento('3')).toBe('assinatura_pendente')
    expect(statusDoDocumento(4)).toBe('assinado')
    expect(statusDoDocumento('6')).toBe('cancelado')
    for (const s of ['1', '2', '5', '7', '', null, undefined, 'x']) expect(statusDoDocumento(s)).toBeNull()
  })
  it('signatários e datas', () => {
    expect(signatariosDoRetorno([
      { email: ' A@B.com ', chave: 'k1', assinado: true, assinado_em: '2026-09-28 14:03:10' },
      { email: 'c@d.com', chave: null, assinado: false, assinado_em: null },
    ])).toEqual([
      { email: 'a@b.com', status: 'assinado', assinado_em: '2026-09-28T14:03:10-03:00', recusado_em: null, motivo: null },
      { email: 'c@d.com', status: 'pendente', assinado_em: null, recusado_em: null, motivo: null },
    ])
    expect(dataIso('2026-09-28T17:03:10Z')).toBe('2026-09-28T17:03:10.000Z')
    expect(dataIso('ontem')).toBeNull()
  })
  it('prazo (D4)', () => {
    expect(prazoAssinatura(null)).toBeNull()
    expect(prazoAssinatura(0)).toBeNull()
    expect(prazoAssinatura(10, new Date('2026-09-28T12:00:00Z'))).toBe('08-10-2026')
  })
  it('nome do documento sem dado pessoal', () => {
    expect(nomeDocumento(123, 'f4000000-0000-4000-8000-000000000001/minuta-v2-abcdef12.pdf')).toBe('contrato-0000123-minuta-v2-abcdef12')
  })
})

describe('cliente HTTP', () => {
  function fetchFalso(respostas: Record<string, { status?: number; corpo: unknown }>) {
    const pedidos: { url: string; metodo: string; corpo: unknown }[] = []
    const fn = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada)
      pedidos.push({ url, metodo: init?.method ?? 'GET', corpo: init?.body ? JSON.parse(String(init.body)) : null })
      const chave = Object.keys(respostas).find((k) => url.includes(k))
      const r = chave ? respostas[chave] : { status: 404, corpo: { message: 'not found' } }
      if (r.corpo instanceof Uint8Array) return new Response(r.corpo.slice().buffer as ArrayBuffer, { status: r.status ?? 200 })
      return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 })
    }) as typeof fetch
    return { fn, pedidos }
  }

  it('manda token e chave só na query string e registra a chamada sem URL', async () => {
    const chamadas: ChamadaD4sign[] = []
    const { fn, pedidos } = fetchFalso({ '/uploadbinary': { corpo: { uuid: 'doc-9' } } })
    const api = criarClienteD4sign(CFG, { fetch: fn, registrar: (c) => { chamadas.push(c) } })
    expect(await api.enviarPdf('contrato-0000001-minuta-v1-aaaaaaaa', PDF)).toBe('doc-9')
    expect(pedidos[0].url).toBe(`${URL_SANDBOX}/documents/cofre-uuid-1/uploadbinary?tokenAPI=live_token_secreto&cryptKey=cripto_secreta`)
    expect(pedidos[0].corpo).toMatchObject({ mime_type: 'application/pdf', name: 'contrato-0000001-minuta-v1-aaaaaaaa' })
    expect(atob((pedidos[0].corpo as { base64_binary_file: string }).base64_binary_file)).toBe('%PDF-1.7 conteÃºdo')
    expect(chamadas).toEqual([{ operacao: 'enviar_pdf', http_status: 200, duracao_ms: expect.any(Number), erro: null }])
  })

  it('erro do D4Sign: sem URL, token nem e-mail na mensagem e no registro', async () => {
    const chamadas: ChamadaD4sign[] = []
    const { fn } = fetchFalso({ '/createlist': { status: 400, corpo: { message: 'E-mail fulano@exemplo.com inválido' } } })
    const api = criarClienteD4sign(CFG, { fetch: fn, registrar: (c) => { chamadas.push(c) } })
    const erro = await api.cadastrarSignatarios('doc-1', [{ email: 'fulano@exemplo.com', ato: 'assinar' }]).catch((e: Error) => e)
    expect(erro).toBeInstanceOf(Error)
    const msg = (erro as Error).message + JSON.stringify(chamadas)
    expect(msg).not.toContain('live_token_secreto')
    expect(msg).not.toContain('cripto_secreta')
    expect(msg).not.toContain('fulano@exemplo.com')
    expect(chamadas[0]).toMatchObject({ operacao: 'cadastrar_signatarios', http_status: 400 })
  })

  it('falha de rede com a URL na mensagem também é limpa', async () => {
    const fn = (async () => { throw new TypeError(`error sending request for url (${URL_SANDBOX}/documents/x?tokenAPI=live_token_secreto)`) }) as typeof fetch
    const api = criarClienteD4sign(CFG, { fetch: fn })
    const erro = await api.documento('doc-1').catch((e: Error) => e)
    expect((erro as Error).message).not.toContain('live_token_secreto')
    expect(erroLimpo('x?tokenAPI=abc')).toBe('x?tokenAPI=abc')
    expect(erroLimpo('https://a.b/c?tokenAPI=abc')).toBe('https://a.b/c?[omitido]')
  })

  it('lê documento, signatários (lista aninhada), ato de testemunha e baixa o PDF assinado', async () => {
    const { fn, pedidos } = fetchFalso({
      '/documents/doc-1/list': { corpo: [{ uuidDoc: 'doc-1', list: [{ email: 'A@b.com', key_signer: 'k1', signed: '1', sign_info: { date_signed: '2026-09-28 10:00:00' } }, { email: 'c@d.com', key_signer: 'k2', signed: '0' }] }] },
      '/documents/doc-1/createlist': { corpo: { message: [{ email: 't@e.com', key_signer: 'k3' }] } },
      '/documents/doc-1/download': { corpo: { url: 'https://arquivos.d4sign.test/doc-1.pdf', name: 'doc-1.pdf' } },
      'arquivos.d4sign.test': { corpo: PDF },
      '/documents/doc-1?': { corpo: [{ uuidDoc: 'doc-1', nameDoc: 'contrato-0000001-minuta-v1-aaaaaaaa.pdf', statusId: '3', statusName: 'Aguardando Assinaturas' }] },
    })
    const api = criarClienteD4sign(CFG, { fetch: fn })
    expect(await api.documento('doc-1')).toEqual({ uuid: 'doc-1', nome: 'contrato-0000001-minuta-v1-aaaaaaaa.pdf', statusId: '3', statusNome: 'Aguardando Assinaturas' })
    expect(await api.signatarios('doc-1')).toEqual([
      { email: 'a@b.com', chave: 'k1', assinado: true, assinado_em: '2026-09-28 10:00:00' },
      { email: 'c@d.com', chave: 'k2', assinado: false, assinado_em: null },
    ])
    expect(await api.cadastrarSignatarios('doc-1', [{ email: 't@e.com', ato: 'testemunhar' }])).toEqual([{ email: 't@e.com', chave: 'k3' }])
    expect(pedidos.at(-1)?.corpo).toEqual({ signers: [{ email: 't@e.com', act: '5', foreign: '0', certificadoicpbr: '0', assinatura_presencial: '0' }] })
    expect(await api.baixarPdf('doc-1')).toEqual(PDF)
  })

  it('PDF assinado que não é PDF é recusado; uuid malformado nem sai da máquina', async () => {
    const { fn, pedidos } = fetchFalso({
      '/download': { corpo: { url: 'https://arquivos.d4sign.test/x' } },
      'arquivos.d4sign.test': { corpo: bytes('<html>') },
    })
    const api = criarClienteD4sign(CFG, { fetch: fn })
    await expect(api.baixarPdf('doc-1')).rejects.toThrow('não é um PDF')
    const antes = pedidos.length
    await expect(api.documento('../cofre')).rejects.toThrow()
    expect(pedidos.length).toBe(antes)
  })

  it('link http do PDF assinado: recusado no D4Sign de verdade; no simulador local só com a mesma origem', async () => {
    const http = fetchFalso({ '/download': { corpo: { url: 'http://arquivos.d4sign.test/x.pdf' } }, 'arquivos.d4sign.test': { corpo: PDF } })
    await expect(criarClienteD4sign(CFG, { fetch: http.fn }).baixarPdf('doc-1')).rejects.toThrow('link do PDF')
    expect(http.pedidos.some((p) => p.url.includes('arquivos.d4sign.test'))).toBe(false)

    const SIM: ConfigD4sign = { ...CFG, url: 'http://host.docker.internal:54869/api/v1', simulado: true }
    const mesma = fetchFalso({ '/download': { corpo: { url: 'http://host.docker.internal:54869/arquivos/doc-1.pdf' } }, '/arquivos/doc-1.pdf': { corpo: PDF } })
    expect(await criarClienteD4sign(SIM, { fetch: mesma.fn }).baixarPdf('doc-1')).toEqual(PDF)

    const outra = fetchFalso({ '/download': { corpo: { url: 'http://outro.local:54869/arquivos/doc-1.pdf' } }, 'outro.local': { corpo: PDF } })
    await expect(criarClienteD4sign(SIM, { fetch: outra.fn }).baixarPdf('doc-1')).rejects.toThrow('link do PDF')
    expect(outra.pedidos.some((p) => p.url.includes('outro.local'))).toBe(false)
  })
})

// ---------- orquestração com uma API falsa em memória ----------

function apiFalsa(inicial: { docs?: Record<string, DocumentoD4sign>; sigs?: Record<string, SignatarioD4sign[]> } = {}) {
  const docs = { ...(inicial.docs ?? {}) }
  const sigs: Record<string, SignatarioD4sign[]> = { ...(inicial.sigs ?? {}) }
  const log: string[] = []
  let n = 0
  const api: ClienteD4sign = {
    async enviarPdf(nome) { const uuid = `novo-${++n}`; docs[uuid] = { uuid, nome: `${nome}.pdf`, statusId: '2', statusNome: null }; log.push(`upload:${uuid}`); return uuid },
    async cadastrarSignatarios(uuid, lista) {
      log.push(`signatarios:${lista.map((s) => s.email).join(',')}`)
      sigs[uuid] = [...(sigs[uuid] ?? []), ...lista.map((s) => ({ email: s.email, chave: `k-${s.email}`, assinado: false, assinado_em: null }))]
      return lista.map((s) => ({ email: s.email, chave: `k-${s.email}` }))
    },
    async cadastrarWebhook(uuid, url) { log.push(`webhook:${uuid}:${url}`) },
    async enviarParaAssinatura(uuid) { log.push(`enviar:${uuid}`); docs[uuid].statusId = '3' },
    async documento(uuid) { return docs[uuid] },
    async signatarios(uuid) { return sigs[uuid] ?? [] },
    async cancelar(uuid, _c, op = 'cancelar') { log.push(`${op}:${uuid}`); docs[uuid].statusId = '6' },
    async baixarPdf() { log.push('baixar'); return PDF },
  }
  return { api, log, docs, sigs }
}

const SIGNATARIOS = [
  { ordem: 1, papel: 'cliente' as const, nome: 'Cliente Um', email: 'c1@cliente.test', ato: 'assinar' as const },
  { ordem: 2, papel: 'representante_arken' as const, nome: 'Representante', email: 'rep@arken.test', ato: 'assinar' as const },
]

describe('envio para assinatura (retomável)', () => {
  const MINUTA = 'contrato-0000001-minuta-v1-aaaaaaaa'
  const portas = (api: ClienteD4sign, log: string[], opcoes: { confirmar?: () => Promise<void>; registrar?: () => Promise<void> } = {}) => {
    const registros: { uuid?: string; envio?: { sigs: SignatarioEnviado[]; hash: string; uuid: string } } = {}
    const p: PortasEnvio = {
      api,
      async registrarUuid(uuid) { registros.uuid = uuid },
      async confirmarEnvio(uuid) { log.push(`confirmar:${uuid}`); await opcoes.confirmar?.() },
      async registrarEnvio(sigs, hash, uuid) { log.push(`registrar:${uuid}`); await opcoes.registrar?.(); registros.envio = { sigs, hash, uuid } },
      urlWebhook: (t) => `https://x.supabase.co/functions/v1/d4sign-webhook?t=${t}`,
      gerarToken: () => 'token-fixo-de-teste-com-32-bytes-ok',
    }
    return { registros, portas: p }
  }
  const dados = { nome: MINUTA, pdf: PDF, d4signUuid: null, signatarios: SIGNATARIOS, mensagem: 'Contrato nº 0000001', prazo: null }
  const doc = (nome: string, statusId: string): DocumentoD4sign => ({ uuid: 'doc-1', nome: `${nome}.pdf`, statusId, statusNome: null })
  const sig = (email: string, chave = `k-${email}`): SignatarioD4sign => ({ email, chave, assinado: false, assinado_em: null })

  it('nome do envio: minuta + impressão dos signatários (sem e-mail legível); muda com e-mail, ato ou ordem', async () => {
    const nome = await nomeDoEnvio(MINUTA, SIGNATARIOS)
    expect(nome).toMatch(/^contrato-0000001-minuta-v1-aaaaaaaa-s[0-9a-f]{8}$/)
    expect(nome).not.toContain('cliente.test')
    expect(await nomeDoEnvio(MINUTA, [...SIGNATARIOS].reverse())).toBe(nome)
    expect(await nomeDoEnvio(MINUTA, [{ ...SIGNATARIOS[0], email: 'C1@Cliente.test ' }, SIGNATARIOS[1]])).toBe(nome)
    expect(await nomeDoEnvio(MINUTA, [{ ...SIGNATARIOS[0], email: 'c1@cliente.tst' }, SIGNATARIOS[1]])).not.toBe(nome)
    expect(await nomeDoEnvio(MINUTA, [SIGNATARIOS[0], { ...SIGNATARIOS[1], ato: 'testemunhar' }])).not.toBe(nome)
    expect(await nomeDoEnvio(MINUTA, [SIGNATARIOS[0], { ...SIGNATARIOS[1], ordem: 3 }])).not.toBe(nome)
  })

  it('primeiro envio: upload, uuid gravado, signatários, webhook, confirmação no banco ANTES do disparo, disparo e registro', async () => {
    const { api, log } = apiFalsa()
    const { portas: p, registros } = portas(api, log)
    expect(await enviarParaAssinatura(p, dados)).toEqual({ uuid: 'novo-1' })
    expect(log).toEqual([
      'upload:novo-1', 'signatarios:c1@cliente.test,rep@arken.test',
      'webhook:novo-1:https://x.supabase.co/functions/v1/d4sign-webhook?t=token-fixo-de-teste-com-32-bytes-ok',
      'confirmar:novo-1', 'enviar:novo-1', 'registrar:novo-1',
    ])
    expect(registros.uuid).toBe('novo-1')
    expect(registros.envio?.hash).toBe(await sha256Hex('token-fixo-de-teste-com-32-bytes-ok'))
    expect(registros.envio?.sigs.map((s) => s.d4sign_chave)).toEqual(['k-c1@cliente.test', 'k-rep@arken.test'])
  })

  it('reenvio depois de falha: reaproveita o documento (mesma minuta e mesmos signatários) e cadastra só quem falta', async () => {
    const nome = await nomeDoEnvio(MINUTA, SIGNATARIOS)
    const { api, log } = apiFalsa({ docs: { 'doc-1': doc(nome, '2') }, sigs: { 'doc-1': [sig('c1@cliente.test', 'k-antiga')] } })
    const { portas: p, registros } = portas(api, log)
    await enviarParaAssinatura(p, { ...dados, d4signUuid: 'doc-1' })
    expect(log).toEqual([
      'signatarios:rep@arken.test', expect.stringMatching(/^webhook:doc-1:/), 'confirmar:doc-1', 'enviar:doc-1', 'registrar:doc-1',
    ])
    expect(registros.envio?.sigs[0].d4sign_chave).toBe('k-antiga')
  })

  it('WP4R-02: e-mail do cliente corrigido entre tentativas → o documento antigo é cancelado e o e-mail errado não fica no D4Sign', async () => {
    const errado = [{ ...SIGNATARIOS[0], email: 'joao@gmial.com' }, SIGNATARIOS[1]]
    const { api, log, sigs } = apiFalsa({
      docs: { 'doc-1': doc(await nomeDoEnvio(MINUTA, errado), '2') },
      sigs: { 'doc-1': [sig('joao@gmial.com'), sig('rep@arken.test')] },
    })
    const { portas: p, registros } = portas(api, log)
    const certo = [{ ...SIGNATARIOS[0], email: 'joao@gmail.com' }, SIGNATARIOS[1]]
    await enviarParaAssinatura(p, { ...dados, d4signUuid: 'doc-1', signatarios: certo })
    expect(log.slice(0, 3)).toEqual(['cancelar_substituido:doc-1', 'upload:novo-1', 'signatarios:joao@gmail.com,rep@arken.test'])
    expect(log).toContain('enviar:novo-1')
    expect(log).not.toContain('enviar:doc-1')
    expect(sigs['novo-1'].map((s) => s.email)).toEqual(['joao@gmail.com', 'rep@arken.test'])
    expect(registros.envio?.uuid).toBe('novo-1')
    expect(registros.envio?.sigs.map((s) => s.email)).toEqual(['joao@gmail.com', 'rep@arken.test'])
  })

  it('WP4R-02 (cenário da revisão): documento da mesma minuta com o e-mail errado → não é reaproveitado', async () => {
    const { api, log, sigs } = apiFalsa({
      docs: { 'doc-1': doc(MINUTA, '2') },
      sigs: { 'doc-1': [sig('joao@gmial.com'), sig('rep@arken.test')] },
    })
    const { portas: p, registros } = portas(api, log)
    await enviarParaAssinatura(p, { ...dados, d4signUuid: 'doc-1', signatarios: [{ ...SIGNATARIOS[0], email: 'joao@gmail.com' }, SIGNATARIOS[1]] })
    expect(log[0]).toBe('cancelar_substituido:doc-1')
    expect(sigs['doc-1'].map((s) => s.email)).not.toContain('joao@gmail.com')
    expect(Object.values(sigs).flat().filter((s) => s.email === 'joao@gmial.com')).toHaveLength(1)
    expect(log).not.toContain('enviar:doc-1')
    expect(registros.envio?.uuid).toBe('novo-1')
  })

  it('WP4R-02: signatário a mais no D4Sign (mesmo nome) → não reaproveita o documento', async () => {
    const nome = await nomeDoEnvio(MINUTA, SIGNATARIOS)
    const { api, log, sigs } = apiFalsa({
      docs: { 'doc-1': doc(nome, '2') },
      sigs: { 'doc-1': [sig('c1@cliente.test'), sig('rep@arken.test'), sig('intruso@outro.test')] },
    })
    const { portas: p } = portas(api, log)
    await enviarParaAssinatura(p, { ...dados, d4signUuid: 'doc-1' })
    expect(log.slice(0, 2)).toEqual(['cancelar_substituido:doc-1', 'upload:novo-1'])
    expect(sigs['novo-1'].map((s) => s.email)).toEqual(['c1@cliente.test', 'rep@arken.test'])
  })

  it('já enviado no D4Sign com a mesma lista (o registro falhou antes): não dispara de novo, confirma e registra', async () => {
    const nome = await nomeDoEnvio(MINUTA, SIGNATARIOS)
    const { api, log } = apiFalsa({ docs: { 'doc-1': doc(nome, '3') }, sigs: { 'doc-1': SIGNATARIOS.map((s) => sig(s.email, `k${s.ordem}`)) } })
    const { portas: p, registros } = portas(api, log)
    await enviarParaAssinatura(p, { ...dados, d4signUuid: 'doc-1' })
    expect(log).toEqual([expect.stringMatching(/^webhook:doc-1:/), 'confirmar:doc-1', 'registrar:doc-1'])
    expect(registros.envio?.sigs.map((s) => s.d4sign_chave)).toEqual(['k1', 'k2'])
  })

  it('minuta trocada: cancela o documento antigo (operação própria) e sobe o novo', async () => {
    const { api, log } = apiFalsa({ docs: { 'doc-1': doc(await nomeDoEnvio(MINUTA, SIGNATARIOS), '2') } })
    const { portas: p, registros } = portas(api, log)
    await enviarParaAssinatura(p, { ...dados, nome: 'contrato-0000001-minuta-v2-bbbbbbbb', d4signUuid: 'doc-1' })
    expect(log[0]).toBe('cancelar_substituido:doc-1')
    expect(registros.uuid).toBe('novo-1')
  })

  it('documento anterior já finalizado com outra minuta: não cancela, não sobe outro e avisa', async () => {
    const { api, log } = apiFalsa({ docs: { 'doc-1': doc(await nomeDoEnvio(MINUTA, SIGNATARIOS), '4') } })
    const { portas: p, registros } = portas(api, log)
    await expect(enviarParaAssinatura(p, { ...dados, nome: 'contrato-0000001-minuta-v2-bbbbbbbb', d4signUuid: 'doc-1' }))
      .rejects.toThrow(/finalizado no D4Sign/)
    expect(log).toEqual([])
    expect(registros.uuid).toBeUndefined()
  })

  it('WP4R-01: o banco recusa a confirmação → nada é disparado nem registrado', async () => {
    const { api, log } = apiFalsa()
    const { portas: p, registros } = portas(api, log, { confirmar: async () => { throw new Error('VALIDACAO_FALHOU') } })
    await expect(enviarParaAssinatura(p, dados)).rejects.toThrow('VALIDACAO_FALHOU')
    expect(log.filter((l) => /^(enviar|registrar|cancelar)/.test(l))).toEqual([])
    expect(registros.envio).toBeUndefined()
  })

  it('WP4R-01: o registro falha depois do disparo → o documento é cancelado no D4Sign antes do erro', async () => {
    const { api, log, docs } = apiFalsa()
    const { portas: p } = portas(api, log, { registrar: async () => { throw new Error('O contrato não está em envio para assinatura.') } })
    await expect(enviarParaAssinatura(p, dados)).rejects.toThrow(/não está em envio/)
    expect(log.slice(-3)).toEqual(['enviar:novo-1', 'registrar:novo-1', 'cancelar_substituido:novo-1'])
    expect(docs['novo-1'].statusId).toBe('6')
  })

  it('WP4R-01: já disparado antes e a confirmação recusada agora → o documento vivo é cancelado', async () => {
    const nome = await nomeDoEnvio(MINUTA, SIGNATARIOS)
    const { api, log, docs } = apiFalsa({ docs: { 'doc-1': doc(nome, '3') }, sigs: { 'doc-1': SIGNATARIOS.map((s) => sig(s.email)) } })
    const { portas: p } = portas(api, log, { confirmar: async () => { throw new Error('VALIDACAO_FALHOU') } })
    await expect(enviarParaAssinatura(p, { ...dados, d4signUuid: 'doc-1' })).rejects.toThrow('VALIDACAO_FALHOU')
    expect(log.slice(-2)).toEqual(['confirmar:doc-1', 'cancelar_substituido:doc-1'])
    expect(docs['doc-1'].statusId).toBe('6')
  })

  it('WP4R-01: disparo e cancelamento falham → o erro avisa que o documento pode ter ficado ativo', async () => {
    const { api, log } = apiFalsa()
    api.enviarParaAssinatura = async () => { throw new ErroD4sign('enviar_para_assinatura', null, 'tempo esgotado') }
    api.cancelar = async () => { throw new ErroD4sign('cancelar_substituido', 503, 'D4Sign respondeu 503') }
    const { portas: p, registros } = portas(api, log)
    await expect(enviarParaAssinatura(p, dados)).rejects.toThrow(/tempo esgotado; o documento pode ter ficado ativo no D4Sign/)
    expect(registros.envio).toBeUndefined()
  })
})

describe('reconsulta (webhook, reconciliação, atualizar status)', () => {
  const portas = (api: ClienteD4sign) => {
    const retornos: ArgsRetorno[] = []
    const arquivos: string[] = []
    return {
      retornos, arquivos,
      portas: { api, async salvarPdfAssinado(caminho: string) { arquivos.push(caminho) }, async registrarRetorno(a: ArgsRetorno) { retornos.push(a) } },
    }
  }

  it('assinado: baixa, grava <contrato>/assinado-<sha8>.pdf e registra com o sha', async () => {
    const { api } = apiFalsa({
      docs: { 'doc-1': { uuid: 'doc-1', nome: 'x', statusId: '4', statusNome: 'Finalizado' } },
      sigs: { 'doc-1': [{ email: 'c1@cliente.test', chave: 'k', assinado: true, assinado_em: '2026-09-28 10:00:00' }] },
    })
    const { portas: p, retornos, arquivos } = portas(api)
    expect(await reconsultarDocumento(p, 'contrato-1', 'doc-1')).toBe('assinado')
    const sha = await sha256Hex(PDF)
    expect(arquivos).toEqual([`contrato-1/assinado-${sha.slice(0, 8)}.pdf`])
    expect(retornos).toEqual([{
      p_d4sign_uuid: 'doc-1', p_status: 'assinado', p_pdf_assinado_path: `contrato-1/assinado-${sha.slice(0, 8)}.pdf`, p_sha256: sha,
      p_signatarios: [{ email: 'c1@cliente.test', status: 'assinado', assinado_em: '2026-09-28T10:00:00-03:00', recusado_em: null, motivo: null }],
    }])
  })

  it('pendente e cancelado registram sem PDF; processando não registra nada', async () => {
    const { api, docs } = apiFalsa({ docs: { 'doc-1': { uuid: 'doc-1', nome: 'x', statusId: '3', statusNome: null } } })
    const { portas: p, retornos } = portas(api)
    expect(await reconsultarDocumento(p, 'c', 'doc-1')).toBe('assinatura_pendente')
    docs['doc-1'].statusId = '6'
    expect(await reconsultarDocumento(p, 'c', 'doc-1')).toBe('cancelado')
    docs['doc-1'].statusId = '1'
    expect(await reconsultarDocumento(p, 'c', 'doc-1')).toBeNull()
    expect(retornos.map((r) => [r.p_status, r.p_pdf_assinado_path])).toEqual([['assinatura_pendente', null], ['cancelado', null]])
  })
})

describe('erros de RPC nas Edges', () => {
  it('42501 → 403 genérico; códigos de conflito → 409; frase pt-BR passa; nativo não vaza', () => {
    expect(erroDaRpc({ code: '42501', message: 'Sem acesso a este registro' })).toMatchObject({ status: 403, mensagem: 'Você não tem acesso a este registro.' })
    expect(erroDaRpc({ code: 'P0001', message: 'ENVIO_EM_ANDAMENTO' }).status).toBe(409)
    expect(erroDaRpc({ code: 'P0001', message: 'VALIDACAO_FALHOU', details: '{"validacoes":["pdf_gerado"]}' }))
      .toEqual({ status: 422, mensagem: 'Não foi possível concluir a operação.', detalhes: { code: 'P0001', message: 'VALIDACAO_FALHOU', details: '{"validacoes":["pdf_gerado"]}' } })
    expect(erroDaRpc({ code: 'P0001', message: 'O PDF assinado ainda não está disponível.' }).mensagem).toBe('O PDF assinado ainda não está disponível.')
    expect(erroDaRpc({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }))
      .toEqual({ status: 500, mensagem: 'Não foi possível concluir a operação. Tente de novo.', detalhes: { code: '23505', message: null, details: null } })
  })
})

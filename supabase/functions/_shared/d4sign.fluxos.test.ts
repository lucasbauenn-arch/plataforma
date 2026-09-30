// Fluxos das Edge Functions do D4Sign (contrato-assinatura, d4sign-webhook, d4sign-reconciliar) com portas falsas
// (WP4R-09): a permissão vem sempre da RPC com o JWT; a prova do cancelamento só é gravada depois de o D4Sign confirmar;
// o texto e a minuta são conferidos antes do envio; a confirmação no banco vem antes do disparo e um disparo não
// registrado é cancelado; a trava é liberada em cada falha; o webhook confere token → HMAC → idempotência antes de
// reconsultar; a reconciliação faz rodízio.
import { describe, expect, it } from 'vitest'
import { criarRespostas } from './http.ts'
import { hmacSha256Hex, sha256Hex } from './chaves.ts'
import { renderizarModelo } from './modelo-contrato.ts'
import {
  type ClienteD4sign, criarClienteD4sign, diaEmBrasilia, type DocumentoD4sign, type ErroPostgrest, type FabricaD4sign,
  type LinhaChamada, nomeDoEnvio, nomeDocumento, type RegistrarChamada, type ResultadoRpc, type SignatarioD4sign, URL_SANDBOX,
} from './d4sign.ts'
import { OPERACAO_PROVA_CANCELAMENTO, type PortasAssinatura, tratarAssinatura } from '../contrato-assinatura/fluxo.ts'
import { type PortasWebhook, tratarWebhook } from '../d4sign-webhook/fluxo.ts'
import { MAXIMO_POR_EXECUCAO, type PortasReconciliacao, tratarReconciliacao } from '../d4sign-reconciliar/fluxo.ts'

const r = criarRespostas()
const ID = 'e4000000-0000-4000-8000-000000000001'
const PDF = new TextEncoder().encode('%PDF-1.7 minuta')
const PDF_ASSINADO = new TextEncoder().encode('%PDF-1.7 assinado')
const MODELO = '# Contrato {{codigo}}\n\nComprador: **{{nome}}**, em {{data}}.'
const GERADO_EM = '2026-09-28T15:00:00Z'
const SIGNATARIOS = [
  { ordem: 1, papel: 'cliente' as const, nome: 'Maria Compradora', email: 'maria@cliente.test', ato: 'assinar' as const },
  { ordem: 2, papel: 'representante_arken' as const, nome: 'Representante', email: 'rep@arken.test', ato: 'assinar' as const },
]
const ok = (data: unknown = null): ResultadoRpc => ({ data, error: null })
const falhou = (error: ErroPostgrest): ResultadoRpc => ({ data: null, error })

/** D4Sign em memória: cada chamada entra no log compartilhado (ordem entre banco e D4Sign). */
function d4signFalso(log: string[], inicial: { docs?: Record<string, DocumentoD4sign>; sigs?: Record<string, SignatarioD4sign[]> } = {}) {
  const docs: Record<string, DocumentoD4sign> = { ...(inicial.docs ?? {}) }
  const sigs: Record<string, SignatarioD4sign[]> = { ...(inicial.sigs ?? {}) }
  let n = 0
  const api: ClienteD4sign = {
    async enviarPdf(nome) { const uuid = `doc-${++n}`; docs[uuid] = { uuid, nome: `${nome}.pdf`, statusId: '2', statusNome: null }; log.push(`d4sign:upload:${uuid}`); return uuid },
    async cadastrarSignatarios(uuid, lista) {
      log.push(`d4sign:signatarios:${uuid}`)
      sigs[uuid] = [...(sigs[uuid] ?? []), ...lista.map((s) => ({ email: s.email, chave: `k-${s.email}`, assinado: false, assinado_em: null }))]
      return lista.map((s) => ({ email: s.email, chave: `k-${s.email}` }))
    },
    async cadastrarWebhook(uuid) { log.push(`d4sign:webhook:${uuid}`) },
    async enviarParaAssinatura(uuid) { log.push(`d4sign:disparo:${uuid}`); docs[uuid].statusId = '3' },
    async documento(uuid) { log.push(`d4sign:consulta:${uuid}`); return { ...docs[uuid] } },
    async signatarios(uuid) { return (sigs[uuid] ?? []).map((s) => ({ ...s })) },
    async cancelar(uuid, _c, op = 'cancelar') { log.push(`d4sign:${op}:${uuid}`); docs[uuid].statusId = '6' },
    async baixarPdf(uuid) { log.push(`d4sign:baixar:${uuid}`); return PDF_ASSINADO },
  }
  return { api, docs, sigs }
}

// ============ contrato-assinatura ============

async function preparo(extra: Record<string, unknown> = {}) {
  const variaveis = { codigo: 123, nome: 'Maria', data: '2026-09-29' }
  const render = renderizarModelo(MODELO, { ...variaveis, data: diaEmBrasilia(GERADO_EM) })
  if (!render.ok) throw new Error('modelo de teste inválido')
  return {
    dadosModelo: { modelo: { id: 'm1', chave: 'parcelado', versao: 1, titulo: 'Modelo', conteudo: MODELO }, variaveis, codigo: 123, pdf_versao: 1 },
    preparo: {
      contrato_id: ID, codigo: 123, pdf_path: `${ID}/minuta-v1-aaaaaaaa.pdf`, pdf_sha256: await sha256Hex(PDF),
      texto_sha256: await sha256Hex(render.texto), pdf_gerado_em: GERADO_EM, d4sign_uuid: null, signatarios: SIGNATARIOS, ...extra,
    },
  }
}

interface OpcoesAssinatura {
  usuario?: Record<string, (args: Record<string, unknown>) => ResultadoRpc>
  sistema?: Record<string, (args: Record<string, unknown>) => ResultadoRpc>
  d4sign?: FabricaD4sign
  api?: ClienteD4sign
  semSessao?: boolean
  minuta?: Uint8Array
  situacao?: { status: string; d4sign_uuid: string | null }
  /** contrato_registrar_envio grava no banco mas a resposta chega com erro */
  registroPerdido?: boolean
}

function assinatura(o: OpcoesAssinatura = {}) {
  const log: string[] = []
  const logs: string[] = []
  const linhas: LinhaChamada[] = []
  const chamadas: { quem: 'usuario' | 'sistema'; nome: string; args: Record<string, unknown> }[] = []
  const falso = d4signFalso(log)
  const api = o.api ?? falso.api
  let situacao = o.situacao ?? { status: 'em_analise', d4sign_uuid: null as string | null }
  const portas: PortasAssinatura = {
    async autenticar() {
      log.push('auth')
      return o.semSessao ? r.erro(401, 'Sua sessão expirou. Entre de novo.') : {
        rpc: async (nome, args) => {
          log.push(`usuario:${nome}`)
          chamadas.push({ quem: 'usuario', nome, args })
          return o.usuario?.[nome]?.(args) ?? ok()
        },
      }
    },
    sistema: async (nome, args) => {
      log.push(`sistema:${nome}`)
      chamadas.push({ quem: 'sistema', nome, args })
      const res = o.sistema?.[nome]?.(args) ?? ok()
      if (o.registroPerdido && nome === 'contrato_registrar_envio') situacao = { ...situacao, status: 'assinatura_pendente' }
      if (!res.error && nome === 'contrato_registrar_d4sign_uuid') situacao = { ...situacao, d4sign_uuid: String(args.p_uuid) }
      if (!res.error && nome === 'contrato_registrar_envio') situacao = { ...situacao, status: 'assinatura_pendente' }
      return res
    },
    d4sign: o.d4sign ?? { ok: true, criar: (registrar: RegistrarChamada) => { void registrar; return api } },
    async gravarChamada(linha) { log.push(`chamada:${linha.operacao}`); linhas.push(linha) },
    async baixarMinuta() { log.push('storage:minuta'); return o.minuta ?? PDF },
    async salvarPdfAssinado(caminho) { log.push(`storage:assinado:${caminho}`) },
    async prazoAssinaturaDias() { return null },
    async situacao() { return situacao },
    urlWebhook: (t) => `https://x.supabase.co/functions/v1/d4sign-webhook?t=${t}`,
    gerarToken: () => 'token-de-teste',
    log: (m) => { logs.push(m) },
  }
  const pedir = (corpo: Record<string, unknown>) => tratarAssinatura(new Request('https://x.supabase.co/functions/v1/contrato-assinatura', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer jwt' }, body: JSON.stringify(corpo),
  }), r, portas)
  return { log, logs, linhas, chamadas, pedir, falso }
}

const detalhe = (permissoes: Partial<{ cancelar_envio: boolean; atualizar_assinatura: boolean }>) =>
  () => ok({ status: 'assinatura_pendente', permissoes: { cancelar_envio: false, atualizar_assinatura: false, ...permissoes } })

describe('contrato-assinatura: enviar', () => {
  it('sem sessão: 401 e nada é chamado', async () => {
    const c = assinatura({ semSessao: true })
    const res = await c.pedir({ acao: 'enviar', contrato_id: ID })
    expect(res.status).toBe(401)
    expect(c.log).toEqual(['auth'])
  })

  it('ordem: preparar e dados com o JWT → minuta → upload → uuid → signatários → webhook → confirmar no banco → disparo → registro', async () => {
    const { dadosModelo, preparo: p } = await preparo()
    const c = assinatura({ usuario: { contrato_preparar_envio: () => ok(p), contrato_dados_modelo: () => ok(dadosModelo) } })
    const res = await c.pedir({ acao: 'enviar', contrato_id: ID })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'assinatura_pendente' })
    expect(c.log).toEqual([
      'auth', 'usuario:contrato_preparar_envio', 'usuario:contrato_dados_modelo', 'storage:minuta',
      'd4sign:upload:doc-1', 'sistema:contrato_registrar_d4sign_uuid', 'd4sign:signatarios:doc-1', 'd4sign:webhook:doc-1',
      'sistema:contrato_confirmar_envio', 'd4sign:disparo:doc-1', 'sistema:contrato_registrar_envio',
    ])
    expect(c.falso.docs['doc-1'].nome).toBe(`${await nomeDoEnvio(nomeDocumento(123, p.pdf_path), SIGNATARIOS)}.pdf`)
    const registro = c.chamadas.find((x) => x.nome === 'contrato_registrar_envio')
    expect(registro?.args.p_webhook_token_hash).toBe(await sha256Hex('token-de-teste'))
    expect(c.chamadas.find((x) => x.nome === 'contrato_confirmar_envio')?.args).toEqual({ p_id: ID, p_uuid: 'doc-1' })
  })

  it('texto do contrato mudou depois do PDF → 409, a trava é liberada e nada vai ao D4Sign', async () => {
    const { dadosModelo, preparo: p } = await preparo()
    const c = assinatura({
      usuario: {
        contrato_preparar_envio: () => ok(p),
        contrato_dados_modelo: () => ok({ ...dadosModelo, variaveis: { ...dadosModelo.variaveis, nome: 'Maria Outra' } }),
      },
    })
    const res = await c.pedir({ acao: 'enviar', contrato_id: ID })
    expect(res.status).toBe(409)
    expect((await res.json()).codigo).toBe('pdf_desatualizado')
    expect(c.log.filter((l) => l.startsWith('d4sign:'))).toEqual([])
    expect(c.chamadas.filter((x) => x.quem === 'sistema').map((x) => [x.nome, x.args.p_erro])).toEqual([['contrato_falha_envio', 'texto desatualizado']])
  })

  it('minuta no bucket com hash diferente do registrado → 409 e a trava é liberada', async () => {
    const { dadosModelo, preparo: p } = await preparo()
    const c = assinatura({ usuario: { contrato_preparar_envio: () => ok(p), contrato_dados_modelo: () => ok(dadosModelo) }, minuta: new TextEncoder().encode('%PDF-1.7 outro') })
    const res = await c.pedir({ acao: 'enviar', contrato_id: ID })
    expect(res.status).toBe(409)
    expect((await res.json()).codigo).toBe('pdf_divergente')
    expect(c.log.filter((l) => l.startsWith('d4sign:'))).toEqual([])
    expect(c.log.at(-1)).toBe('sistema:contrato_falha_envio')
  })

  it('WP4R-01: o banco recusa a confirmação (valor do produto mudou) → nada é disparado; a trava é liberada; o erro da RPC volta', async () => {
    const { dadosModelo, preparo: p } = await preparo()
    const c = assinatura({
      usuario: { contrato_preparar_envio: () => ok(p), contrato_dados_modelo: () => ok(dadosModelo) },
      sistema: { contrato_confirmar_envio: () => falhou({ code: 'P0001', message: 'VALIDACAO_FALHOU', details: '{"validacoes":["valor_produto_atual"]}' }) },
    })
    const res = await c.pedir({ acao: 'enviar', contrato_id: ID })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ codigo: 'rpc', detalhes: { code: 'P0001', message: 'VALIDACAO_FALHOU', details: '{"validacoes":["valor_produto_atual"]}' } })
    expect(c.log).not.toContain('d4sign:disparo:doc-1')
    expect(c.log.slice(-2)).toEqual(['sistema:contrato_confirmar_envio', 'sistema:contrato_falha_envio'])
  })

  it('WP4R-01: o registro falha depois do disparo → o documento é cancelado no D4Sign ANTES de liberar a trava; 502', async () => {
    const { dadosModelo, preparo: p } = await preparo()
    const c = assinatura({
      usuario: { contrato_preparar_envio: () => ok(p), contrato_dados_modelo: () => ok(dadosModelo) },
      sistema: { contrato_registrar_envio: () => falhou({ code: 'P0001', message: 'O contrato não está em envio para assinatura.' }) },
    })
    const res = await c.pedir({ acao: 'enviar', contrato_id: ID })
    expect(res.status).toBe(502)
    expect((await res.json()).codigo).toBe('falha_envio')
    expect(c.log.slice(-4)).toEqual([
      'd4sign:disparo:doc-1', 'sistema:contrato_registrar_envio', 'd4sign:cancelar_substituido:doc-1', 'sistema:contrato_falha_envio',
    ])
    expect(c.falso.docs['doc-1'].statusId).toBe('6')
  })

  it('a resposta do registro se perdeu mas o banco já registrou o envio deste documento → 200 e nada é cancelado', async () => {
    const { dadosModelo, preparo: p } = await preparo()
    const c = assinatura({
      usuario: { contrato_preparar_envio: () => ok(p), contrato_dados_modelo: () => ok(dadosModelo) },
      sistema: { contrato_registrar_envio: () => falhou({ code: 'PGRST000', message: 'fetch failed' }) },
      registroPerdido: true,
    })
    const res = await c.pedir({ acao: 'enviar', contrato_id: ID })
    expect(res.status).toBe(200)
    expect(c.log.filter((l) => l.includes('cancelar') || l.includes('falha_envio'))).toEqual([])
    expect(c.falso.docs['doc-1'].statusId).toBe('3')
  })

  it('preparar recusado (sem acesso) → 403 e nada mais (não havia trava a liberar)', async () => {
    const c = assinatura({ usuario: { contrato_preparar_envio: () => falhou({ code: '42501', message: 'Sem acesso a este registro' }) } })
    const res = await c.pedir({ acao: 'enviar', contrato_id: ID })
    expect(res.status).toBe(403)
    expect(c.log).toEqual(['auth', 'usuario:contrato_preparar_envio'])
  })

  it('D4Sign não configurado → 503 e a trava é liberada', async () => {
    const { preparo: p } = await preparo()
    const c = assinatura({ usuario: { contrato_preparar_envio: () => ok(p) }, d4sign: { ok: false, erro: 'D4SIGN_TOKEN ausente' } })
    const res = await c.pedir({ acao: 'enviar', contrato_id: ID })
    expect(res.status).toBe(503)
    expect(c.log).toEqual(['auth', 'usuario:contrato_preparar_envio', 'sistema:contrato_falha_envio'])
  })

  it('pedido inválido (ação desconhecida ou id malformado) → 422 sem chamar o banco', async () => {
    const c = assinatura()
    expect((await c.pedir({ acao: 'apagar', contrato_id: ID })).status).toBe(422)
    expect((await c.pedir({ acao: 'enviar', contrato_id: '../x' })).status).toBe(422)
    expect(c.log).toEqual(['auth', 'auth'])
  })
})

describe('contrato-assinatura: cancelar e atualizar', () => {
  const pendente = { status: 'assinatura_pendente', d4sign_uuid: 'doc-9' }
  const comDoc = (log: string[], statusId = '3') => d4signFalso(log, {
    docs: { 'doc-9': { uuid: 'doc-9', nome: 'x.pdf', statusId, statusNome: null } },
    sigs: { 'doc-9': SIGNATARIOS.map((s) => ({ email: s.email, chave: 'k', assinado: statusId === '4', assinado_em: statusId === '4' ? '2026-09-28 10:00:00' : null })) },
  })

  it('motivo curto → 422 sem chamar nada', async () => {
    const c = assinatura({ situacao: pendente })
    const res = await c.pedir({ acao: 'cancelar', contrato_id: ID, motivo: 'x' })
    expect(res.status).toBe(422)
    expect(c.log).toEqual(['auth'])
  })

  it('permissão pela tela do contrato (JWT): sem cancelar_envio → 403 sem falar com o D4Sign; fora do escopo → 403', async () => {
    const c = assinatura({ situacao: pendente, usuario: { contrato_detalhe: detalhe({ atualizar_assinatura: true }) } })
    const res = await c.pedir({ acao: 'cancelar', contrato_id: ID, motivo: 'Cliente desistiu' })
    expect(res.status).toBe(403)
    expect((await res.json()).codigo).toBe('sem_permissao')
    expect(c.log).toEqual(['auth', 'usuario:contrato_detalhe'])
    const fora = assinatura({ situacao: pendente, usuario: { contrato_detalhe: () => ok(null) } })
    expect((await fora.pedir({ acao: 'atualizar', contrato_id: ID })).status).toBe(403)
    expect(fora.log).toEqual(['auth', 'usuario:contrato_detalhe'])
  })

  it('WP4R-03: a prova cancelar_confirmado só é gravada depois de o D4Sign confirmar; depois, mudar status com o JWT', async () => {
    const log: string[] = []
    const { api, docs } = comDoc(log)
    const c = assinatura({ situacao: pendente, api, usuario: { contrato_detalhe: detalhe({ cancelar_envio: true }) } })
    const res = await c.pedir({ acao: 'cancelar', contrato_id: ID, motivo: 'Cliente desistiu' })
    expect(res.status).toBe(200)
    expect(docs['doc-9'].statusId).toBe('6')
    expect([...log, ...c.log.filter((l) => l.startsWith('chamada:') || l.startsWith('usuario:contrato_mudar'))]).toEqual([
      'd4sign:consulta:doc-9', 'd4sign:cancelar:doc-9', 'd4sign:consulta:doc-9', `chamada:${OPERACAO_PROVA_CANCELAMENTO}`,
      'usuario:contrato_mudar_status',
    ])
    expect(c.linhas).toEqual([{ provedor: 'd4sign', operacao: 'cancelar_confirmado', entidade: 'contrato', entidade_id: ID, http_status: 200, duracao_ms: expect.any(Number), erro: null }])
    expect(c.chamadas.at(-1)).toEqual({ quem: 'usuario', nome: 'contrato_mudar_status', args: { p_id: ID, p_para: 'cancelado', p_motivo: 'Cliente desistiu' } })
  })

  it('WP4R-03: D4Sign responde 200 sem JSON ao cancelar → só o registro genérico com erro; sem prova; 502; status não muda', async () => {
    const pedidos: string[] = []
    const fetchFalso = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada)
      pedidos.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
      if (url.includes('/cancel')) return new Response('OK', { status: 200 })
      return new Response(JSON.stringify([{ uuidDoc: 'doc-9', nameDoc: 'x.pdf', statusId: '3', statusName: 'Aguardando' }]), { status: 200 })
    }) as typeof fetch
    const c = assinatura({
      situacao: pendente,
      usuario: { contrato_detalhe: detalhe({ cancelar_envio: true }) },
      d4sign: {
        ok: true,
        criar: (registrar) => criarClienteD4sign({ url: URL_SANDBOX, token: 'token-secreto-123', cryptKey: null, cofre: 'cofre-1' }, { fetch: fetchFalso, registrar }),
      },
    })
    const res = await c.pedir({ acao: 'cancelar', contrato_id: ID, motivo: 'Cliente desistiu' })
    expect(res.status).toBe(502)
    expect((await res.json()).codigo).toBe('falha_cancelamento')
    expect(pedidos).toEqual(['GET /api/v1/documents/doc-9', 'POST /api/v1/documents/doc-9/cancel'])
    expect(c.linhas.map((l) => [l.operacao, l.http_status, l.erro])).toEqual([
      ['consultar_documento', 200, null],
      ['cancelar', 200, 'Resposta do D4Sign não é JSON'],
    ])
    expect(c.linhas.some((l) => l.operacao === OPERACAO_PROVA_CANCELAMENTO)).toBe(false)
    expect(c.chamadas.some((x) => x.nome === 'contrato_mudar_status')).toBe(false)
    expect(JSON.stringify(c.linhas) + c.logs.join()).not.toContain('token-secreto-123')
  })

  it('D4Sign aceita o cancelamento mas o documento não aparece cancelado → sem prova, 502', async () => {
    const log: string[] = []
    const { api } = comDoc(log)
    api.cancelar = async () => { log.push('d4sign:cancelar:doc-9') } // não muda o status
    const c = assinatura({ situacao: pendente, api, usuario: { contrato_detalhe: detalhe({ cancelar_envio: true }) } })
    const res = await c.pedir({ acao: 'cancelar', contrato_id: ID, motivo: 'Cliente desistiu' })
    expect(res.status).toBe(502)
    expect((await res.json()).codigo).toBe('cancelamento_nao_confirmado')
    expect(c.linhas).toEqual([])
    expect(c.chamadas.some((x) => x.nome === 'contrato_mudar_status')).toBe(false)
  })

  it('todos já assinaram → 409, registra o assinado e não cancela', async () => {
    const log: string[] = []
    const { api } = comDoc(log, '4')
    const c = assinatura({ situacao: pendente, api, usuario: { contrato_detalhe: detalhe({ cancelar_envio: true }) } })
    const res = await c.pedir({ acao: 'cancelar', contrato_id: ID, motivo: 'Cliente desistiu' })
    expect(res.status).toBe(409)
    expect(log).not.toContain('d4sign:cancelar:doc-9')
    const retorno = c.chamadas.find((x) => x.nome === 'contrato_registrar_retorno')
    expect(retorno?.quem).toBe('sistema')
    expect(retorno?.args).toMatchObject({ p_d4sign_uuid: 'doc-9', p_status: 'assinado', p_sha256: await sha256Hex(PDF_ASSINADO) })
    expect(c.linhas).toEqual([])
  })

  it('atualizar: permissão pela tela; reconsulta e registra com a service role', async () => {
    const log: string[] = []
    const { api } = comDoc(log)
    const c = assinatura({ situacao: pendente, api, usuario: { contrato_detalhe: detalhe({ atualizar_assinatura: true }) } })
    const res = await c.pedir({ acao: 'atualizar', contrato_id: ID })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'assinatura_pendente' })
    expect(c.chamadas.map((x) => `${x.quem}:${x.nome}`)).toEqual(['usuario:contrato_detalhe', 'sistema:contrato_registrar_retorno'])
  })

  it('sem documento no D4Sign → 409', async () => {
    const c = assinatura({ situacao: { status: 'assinatura_pendente', d4sign_uuid: null }, usuario: { contrato_detalhe: detalhe({ atualizar_assinatura: true }) } })
    expect((await c.pedir({ acao: 'atualizar', contrato_id: ID })).status).toBe(409)
  })
})

// ============ d4sign-webhook ============

const TOKEN = 'token-do-webhook-com-32-bytes-aaaa'
const CORPO = 'uuid=doc-9&type_post=1&email=maria%40cliente.test'

async function webhook(o: { hashGuardado?: string | null; semContrato?: boolean; segredoHmac?: string | null; processado?: boolean; api?: ClienteD4sign; d4sign?: FabricaD4sign; falharRetorno?: boolean } = {}) {
  const log: string[] = []
  const eventos: { chave: string; tipo: string | null; documento: string }[] = []
  const concluidos: [number, string][] = []
  const falhas: [number, string][] = []
  const retornos: Record<string, unknown>[] = []
  const falso = d4signFalso(log, {
    docs: { 'doc-9': { uuid: 'doc-9', nome: 'x.pdf', statusId: '4', statusNome: null } },
    sigs: { 'doc-9': [{ email: 'maria@cliente.test', chave: 'k', assinado: true, assinado_em: '2026-09-28 10:00:00' }] },
  })
  const hash = o.hashGuardado === undefined ? await sha256Hex(TOKEN) : o.hashGuardado
  const portas: PortasWebhook = {
    async contratoDoDocumento(uuid) { log.push(`contrato:${uuid}`); return o.semContrato ? null : { id: ID, webhook_token_hash: hash } },
    segredoHmac: o.segredoHmac ?? null,
    async registrarEvento(e) { log.push('evento'); eventos.push(e); return { id: 7, processado_em: o.processado ? '2026-09-28T10:00:00Z' : null } },
    async concluirEvento(id, resultado) { log.push('concluir'); concluidos.push([id, resultado]) },
    async falharEvento(id, erro) { log.push('falhar'); falhas.push([id, erro]) },
    d4sign: o.d4sign ?? { ok: true, criar: () => o.api ?? falso.api },
    async gravarChamada() {},
    async salvarPdfAssinado(caminho) { log.push(`storage:${caminho}`) },
    sistema: async (nome, args) => {
      log.push(`sistema:${nome}`)
      retornos.push(args)
      return o.falharRetorno ? falhou({ code: 'P0001', message: 'DADOS_INVALIDOS' }) : ok()
    },
    log: () => {},
  }
  const pedir = (cabecalhos: Record<string, string> = {}, t: string | null = TOKEN, corpo = CORPO) =>
    tratarWebhook(new Request(`https://x.supabase.co/functions/v1/d4sign-webhook${t === null ? '' : `?t=${encodeURIComponent(t)}`}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...cabecalhos }, body: corpo,
    }), r, portas)
  return { log, eventos, concluidos, falhas, retornos, pedir }
}

describe('d4sign-webhook', () => {
  it('sem token, token errado, documento desconhecido ou contrato sem hash → 401; nenhum evento gravado; nada no D4Sign', async () => {
    for (const [o, t] of [[{}, null], [{}, 'outro-token'], [{ semContrato: true }, TOKEN], [{ hashGuardado: null }, TOKEN]] as const) {
      const w = await webhook(o)
      const res = await w.pedir({}, t)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ erro: 'Não autorizado', codigo: 'nao_autenticado' })
      expect(w.eventos).toEqual([])
      expect(w.log.filter((l) => !l.startsWith('contrato:'))).toEqual([])
    }
  })

  it('HMAC exigido quando o segredo está configurado: sem cabeçalho ou errado → 401 sem gravar; certo → processa', async () => {
    const segredo = 'segredo-hmac-de-teste-123'
    const sem = await webhook({ segredoHmac: segredo })
    expect((await sem.pedir()).status).toBe(401)
    expect(sem.eventos).toEqual([])
    const errado = await webhook({ segredoHmac: segredo })
    expect((await errado.pedir({ 'content-hmac': `sha256=${await hmacSha256Hex('outro', 'doc-9')}` })).status).toBe(401)
    expect(errado.eventos).toEqual([])
    const certo = await webhook({ segredoHmac: segredo })
    expect((await certo.pedir({ 'content-hmac': `sha256=${await hmacSha256Hex(segredo, 'doc-9')}` })).status).toBe(200)
  })

  it('ordem: token → evento (idempotência) → reconsulta no D4Sign → PDF assinado → registro → evento concluído; sem e-mail no evento', async () => {
    const w = await webhook()
    const res = await w.pedir()
    expect(res.status).toBe(200)
    const sha = await sha256Hex(PDF_ASSINADO)
    expect(w.log).toEqual([
      'contrato:doc-9', 'evento', 'd4sign:consulta:doc-9', 'd4sign:baixar:doc-9', `storage:${ID}/assinado-${sha.slice(0, 8)}.pdf`,
      'sistema:contrato_registrar_retorno', 'concluir',
    ])
    expect(w.eventos).toEqual([{ chave: expect.stringMatching(/^[0-9a-f]{64}$/), tipo: '1', documento: 'doc-9' }])
    expect(JSON.stringify(w.eventos)).not.toContain('maria')
    expect(w.concluidos).toEqual([[7, 'assinado']])
    expect(w.retornos[0]).toMatchObject({ p_d4sign_uuid: 'doc-9', p_status: 'assinado', p_sha256: sha })
  })

  it('evento repetido e já processado → 200 sem reconsultar', async () => {
    const w = await webhook({ processado: true })
    const res = await w.pedir()
    expect(await res.json()).toEqual({ ok: true, repetido: true })
    expect(w.log).toEqual(['contrato:doc-9', 'evento'])
  })

  it('falha no processamento → 500, erro gravado no evento (sem e-mail) e o evento não é concluído', async () => {
    const w = await webhook({ falharRetorno: true })
    const res = await w.pedir()
    expect(res.status).toBe(500)
    expect(w.concluidos).toEqual([])
    expect(w.falhas).toEqual([[7, expect.stringContaining('contrato_registrar_retorno')]])
    const sem = await webhook({ d4sign: { ok: false, erro: 'D4SIGN_TOKEN ausente' } })
    expect((await sem.pedir()).status).toBe(500)
    expect(sem.falhas).toEqual([[7, expect.stringContaining('configuração do D4Sign')]])
  })

  it('corpo sem uuid válido → 401 sem consultar o contrato', async () => {
    const w = await webhook()
    expect((await w.pedir({}, TOKEN, 'uuid=../x&type_post=1')).status).toBe(401)
    expect(w.log).toEqual([])
  })
})

// ============ d4sign-reconciliar ============

describe('d4sign-reconciliar', () => {
  const agora = Date.parse('2026-09-29T12:00:00Z')
  function reconciliar(o: { autorizado?: boolean; d4sign?: FabricaD4sign; pendentes?: { id: string; d4sign_uuid: string }[]; consultas?: { entidade_id: string; criado_em: string }[]; status?: Record<string, string> } = {}) {
    const log: string[] = []
    const processados: string[] = []
    const limites: string[] = []
    const api: ClienteD4sign = {
      ...d4signFalso(log).api,
      async documento(uuid) {
        processados.push(uuid)
        const statusId = o.status?.[uuid] ?? '3'
        if (statusId === 'erro') throw new Error('D4Sign respondeu 500')
        return { uuid, nome: null, statusId, statusNome: null }
      },
      async signatarios() { return [] },
    }
    const portas: PortasReconciliacao = {
      autorizado: () => o.autorizado ?? true,
      d4sign: o.d4sign ?? { ok: true, criar: () => api },
      async pendentes(limite) { limites.push(limite); return o.pendentes ?? [] },
      async ultimasConsultas() { return o.consultas ?? [] },
      async gravarChamada() {},
      async salvarPdfAssinado() {},
      sistema: async () => ok(),
      log: () => {},
      agora: () => agora,
    }
    const pedir = () => tratarReconciliacao(new Request('https://x.supabase.co/functions/v1/d4sign-reconciliar', { method: 'POST' }), r, portas)
    return { pedir, processados, limites }
  }

  it('sem o segredo do cron → 401; D4Sign não configurado → 503; nada consultado', async () => {
    const a = reconciliar({ autorizado: false, pendentes: [{ id: 'k1', d4sign_uuid: 'd1' }] })
    expect((await a.pedir()).status).toBe(401)
    expect(a.limites).toEqual([])
    const b = reconciliar({ d4sign: { ok: false, erro: 'x' }, pendentes: [{ id: 'k1', d4sign_uuid: 'd1' }] })
    expect((await b.pedir()).status).toBe(503)
    expect(b.processados).toEqual([])
  })

  it('rodízio: no máximo 10 por vez, primeiro os nunca consultados e depois os consultados há mais tempo; conta atualizados e falhas', async () => {
    const pendentes = Array.from({ length: 12 }, (_, i) => ({ id: `k${i + 1}`, d4sign_uuid: `d${i + 1}` }))
    const consultas = [
      { entidade_id: 'k1', criado_em: '2026-09-29T11:00:00Z' },
      { entidade_id: 'k2', criado_em: '2026-09-29T10:00:00Z' },
      { entidade_id: 'k2', criado_em: '2026-09-29T11:30:00Z' },
      { entidade_id: 'k3', criado_em: '2026-09-28T10:00:00Z' },
    ]
    const c = reconciliar({ pendentes, consultas, status: { d4: '4', d5: '6', d6: 'erro' } })
    const res = await c.pedir()
    expect(c.limites).toEqual(['2026-09-29T11:00:00.000Z'])
    expect(c.processados).toHaveLength(MAXIMO_POR_EXECUCAO)
    expect(c.processados.slice(0, 9)).toEqual(['d4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11', 'd12'])
    expect(c.processados[9]).toBe('d3')
    expect(await res.json()).toEqual({ ok: true, pendentes: 12, consultados: 10, atualizados: 2, falhas: 1 })
  })
})

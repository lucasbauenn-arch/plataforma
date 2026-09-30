// D4Sign (API v1) para as Edge Functions de contrato (docs/ARQUITETURA_EXPANSAO.md §6.4, §6.5, §6.8;
// docs_new/integracoes.md §2). Módulo PURO: sem Deno.*, sem npm:. O `fetch` e as gravações no banco entram por
// parâmetro (portas), então tudo aqui é testado no Vitest com dublês (d4sign.test.ts).
//
// Regras de segurança:
// - o D4Sign exige token e chave na query string: a URL NUNCA vai para log nem para o banco (integracao_chamadas guarda
//   só a operação, o status HTTP, a duração e um erro já limpo por mensagemSegura, sem e-mails);
// - sandbox fora de produção e produção só com AMBIENTE=producao (SEG-5): `configD4sign` recusa a combinação errada;
// - o webhook nunca é aceito como verdade: valida-se o token do contrato (e o HMAC, se configurado) e a situação é
//   RECONSULTADA na API (`reconsultarDocumento`); o corpo recebido só identifica o documento.
//
// ⚑ Endpoints, campos e códigos conferidos na documentação pública (docapi.d4sign.com.br), a confirmar no sandbox:
//   POST /documents/{cofre}/uploadbinary {base64_binary_file, mime_type, name} → {uuid}
//   POST /documents/{uuid}/createlist {signers:[{email, act, foreign, certificadoicpbr, assinatura_presencial}]}
//   POST /documents/{uuid}/webhooks {url}
//   POST /documents/{uuid}/sendtosigner {message, skip_email, workflow[, sign_limit_date DD-MM-YYYY]}
//   GET  /documents/{uuid} → [{uuidDoc, nameDoc, statusId, statusName}]
//   GET  /documents/{uuid}/list → [{…, list:[{email, key_signer, signed, sign_info:{date_signed}}]}]
//   POST /documents/{uuid}/cancel {comment}
//   POST /documents/{uuid}/download {type:'PDF', language:'pt'} → {url, name}
//   Status do documento: 1 processando, 2 aguardando signatários, 3 aguardando assinaturas, 4 finalizado,
//   5 arquivado, 6 cancelado, 7 editando. Webhook (form-data): uuid, type_post (1 finalizado, 2 e-mail não entregue,
//   3 cancelado, 4 assinado por um signatário), message, email; cabeçalho Content-Hmac: sha256=<hmac do uuid>.

import { hmacSha256Hex, iguaisTempoConstante, sha256Hex, tokenAleatorio } from './chaves.ts'
import { mensagemSegura } from './http.ts'

export const URL_SANDBOX = 'https://sandbox.d4sign.com.br/api/v1'
export const URL_PRODUCAO = 'https://secure.d4sign.com.br/api/v1'

/** Status do documento já mapeado para o nosso vocabulário (StatusRetornoD4sign de src/modulos/contratos/tipos.ts). */
export type StatusRetornoD4sign = 'assinatura_pendente' | 'assinado' | 'recusado' | 'expirado' | 'cancelado'

export interface SignatarioRetorno {
  email: string
  status: 'pendente' | 'assinado' | 'recusado'
  assinado_em: string | null
  recusado_em: string | null
  motivo: string | null
}

export interface SignatarioResolvido {
  ordem: number
  papel: 'cliente' | 'representante_arken' | 'corretor' | 'testemunha'
  nome: string
  email: string
  ato: 'assinar' | 'testemunhar'
}

export interface SignatarioEnviado extends SignatarioResolvido {
  d4sign_chave: string | null
}

// ============ configuração ============

export interface ConfigD4sign {
  url: string
  token: string
  cryptKey: string | null
  cofre: string
  /**
   * `url` é um simulador local do D4Sign (stack local de teste; ver `HOSTS_SIMULADOR`). Só existe fora de produção;
   * com ele, o link do PDF assinado pode ser http desde que tenha a MESMA origem do simulador.
   */
  simulado?: boolean
}

export type LeituraConfig = { ok: true; config: ConfigD4sign } | { ok: false; erro: string }

const UUID_D4SIGN = /^[A-Za-z0-9-]{1,100}$/

/**
 * Hosts de um simulador local do D4Sign (servidor de teste da stack local completa, WP7): http só nestes hosts, só fora
 * de produção. Na nuvem eles não levam a lugar nenhum (loopback do próprio isolate ou nome que não resolve); em
 * produção (AMBIENTE=producao) nunca valem (SEG-5).
 */
export const HOSTS_SIMULADOR: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'])

/**
 * Monta a configuração a partir dos segredos (D4SIGN_URL, D4SIGN_TOKEN, D4SIGN_CRYPT_KEY, D4SIGN_COFRE_UUID).
 * Sem D4SIGN_URL: sandbox fora de produção e produção com AMBIENTE=producao. Com D4SIGN_URL, o host precisa ser o do
 * ambiente (SEG-5): nunca o D4Sign de produção fora de produção, nem o sandbox em produção. Única exceção, e só fora de
 * produção: um simulador local em http (HOSTS_SIMULADOR), para o teste ponta a ponta na stack local.
 */
export function configD4sign(
  env: { url: string | null; token: string | null; cryptKey: string | null; cofre: string | null },
  emProducao: boolean,
): LeituraConfig {
  const esperado = emProducao ? URL_PRODUCAO : URL_SANDBOX
  const url = (env.url ?? esperado).replace(/\/+$/, '')
  let host: string
  let simulado = false
  try {
    const u = new URL(url)
    if (u.search || u.hash || u.username || u.password) return { ok: false, erro: 'D4SIGN_URL inválida' }
    simulado = !emProducao && u.protocol === 'http:' && HOSTS_SIMULADOR.has(u.hostname)
    if (u.protocol !== 'https:' && !simulado) return { ok: false, erro: 'D4SIGN_URL inválida' }
    host = u.hostname
  } catch {
    return { ok: false, erro: 'D4SIGN_URL inválida' }
  }
  if (!simulado && host !== new URL(esperado).hostname) {
    return { ok: false, erro: emProducao ? 'Em produção o D4Sign precisa ser o de produção' : 'Fora de produção só o sandbox do D4Sign' }
  }
  if (!env.token || env.token.length < 10) return { ok: false, erro: 'D4SIGN_TOKEN ausente' }
  if (!env.cofre || !UUID_D4SIGN.test(env.cofre)) return { ok: false, erro: 'D4SIGN_COFRE_UUID ausente ou inválido' }
  return {
    ok: true,
    config: { url, token: env.token, cryptKey: env.cryptKey || null, cofre: env.cofre, ...(simulado ? { simulado: true } : {}) },
  }
}

/** O link do PDF assinado pode ser baixado? https sempre; http só do próprio simulador local (mesma origem). */
function linkPdfPermitido(link: string, cfg: ConfigD4sign): boolean {
  if (link.startsWith('https://')) return true
  if (!cfg.simulado) return false
  try {
    return new URL(link).origin === new URL(cfg.url).origin
  } catch {
    return false
  }
}

// ============ cliente HTTP ============

export class ErroD4sign extends Error {
  readonly operacao: string
  readonly status: number | null
  constructor(operacao: string, status: number | null, mensagem: string) {
    super(mensagem)
    this.name = 'ErroD4sign'
    this.operacao = operacao
    this.status = status
  }
}

/** Uma chamada ao D4Sign, para integracao_chamadas (sem URL, sem token). */
export interface ChamadaD4sign {
  operacao: string
  http_status: number | null
  duracao_ms: number
  erro: string | null
}

export type RegistrarChamada = (c: ChamadaD4sign) => void | Promise<void>

/** Linha de integracao_chamadas para uma chamada ao D4Sign sobre um contrato (nunca a URL). */
export function linhaChamada(c: ChamadaD4sign, contratoId: string | null) {
  return {
    provedor: 'd4sign', operacao: c.operacao, entidade: contratoId ? 'contrato' : null, entidade_id: contratoId,
    http_status: c.http_status, duracao_ms: Math.max(0, Math.round(c.duracao_ms)), erro: c.erro ? c.erro.slice(0, 2000) : null,
  }
}

export interface DocumentoD4sign {
  uuid: string
  nome: string | null
  statusId: string | null
  statusNome: string | null
}

export interface SignatarioD4sign {
  email: string
  chave: string | null
  assinado: boolean
  assinado_em: string | null
}

export interface ClienteD4sign {
  /** Envia a minuta para o cofre e devolve o uuid do documento. */
  enviarPdf(nome: string, pdf: Uint8Array): Promise<string>
  cadastrarSignatarios(uuid: string, signatarios: readonly { email: string; ato: 'assinar' | 'testemunhar' }[]): Promise<{ email: string; chave: string | null }[]>
  cadastrarWebhook(uuid: string, url: string): Promise<void>
  /** `prazo` em DD-MM-YYYY (D4: nulo = sem prazo). */
  enviarParaAssinatura(uuid: string, mensagem: string, prazo: string | null): Promise<void>
  documento(uuid: string): Promise<DocumentoD4sign>
  signatarios(uuid: string): Promise<SignatarioD4sign[]>
  /** `operacao` distingue o cancelamento pedido por um interno ('cancelar') da troca de minuta ('cancelar_substituido'). */
  cancelar(uuid: string, comentario: string, operacao?: 'cancelar' | 'cancelar_substituido'): Promise<void>
  baixarPdf(uuid: string): Promise<Uint8Array>
}

export interface OpcoesCliente {
  fetch?: typeof fetch
  registrar?: RegistrarChamada
  /** Tempo máximo de cada chamada (padrão 20 s). */
  timeoutMs?: number
  /** Tamanho máximo do PDF assinado (padrão 20 MB, o limite do bucket contratos). */
  limitePdf?: number
}

/** Erro sem URL, sem token e sem e-mail, com no máximo `max` caracteres. */
export function erroLimpo(erro: unknown, max = 300): string {
  return mensagemSegura(erro, 2000).replace(/[^\s@"'<>(){}[\],;:]+@[^\s@"'<>(){}[\],;:]+/g, '[e-mail]').slice(0, max)
}

function base64(bytes: Uint8Array): string {
  let binario = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binario)
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)

/** Primeiro objeto de uma resposta que pode vir como objeto, lista ou {message: [...]}. */
function primeiroObjeto(dados: unknown): Record<string, unknown> | null {
  if (Array.isArray(dados)) return (dados.find((x) => x && typeof x === 'object') as Record<string, unknown>) ?? null
  if (dados && typeof dados === 'object') return dados as Record<string, unknown>
  return null
}

/** Objetos com e-mail em qualquer nível da resposta (a lista de signatários vem aninhada em `list` ou `message`). */
function objetosComEmail(dados: unknown, saida: Record<string, unknown>[] = [], profundidade = 0): Record<string, unknown>[] {
  if (profundidade > 4 || !dados || typeof dados !== 'object') return saida
  if (Array.isArray(dados)) {
    for (const x of dados) objetosComEmail(x, saida, profundidade + 1)
    return saida
  }
  const o = dados as Record<string, unknown>
  if (typeof o.email === 'string') saida.push(o)
  else for (const v of Object.values(o)) if (v && typeof v === 'object') objetosComEmail(v, saida, profundidade + 1)
  return saida
}

export function criarClienteD4sign(cfg: ConfigD4sign, opcoes: OpcoesCliente = {}): ClienteD4sign {
  const fetchFn = opcoes.fetch ?? fetch
  const timeoutMs = opcoes.timeoutMs ?? 20_000
  const limitePdf = opcoes.limitePdf ?? 20 * 1024 * 1024

  const registrar = async (c: ChamadaD4sign) => {
    try {
      await opcoes.registrar?.(c)
    } catch {
      /* o registro nunca derruba a operação */
    }
  }

  const url = (caminho: string) => {
    const q = new URLSearchParams({ tokenAPI: cfg.token })
    if (cfg.cryptKey) q.set('cryptKey', cfg.cryptKey)
    return `${cfg.url}${caminho}?${q}`
  }

  async function chamar(operacao: string, metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<unknown> {
    const inicio = Date.now()
    let status: number | null = null
    try {
      const resp = await fetchFn(url(caminho), {
        method: metodo,
        headers: { Accept: 'application/json', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      status = resp.status
      const bruto = await resp.text()
      if (!resp.ok) throw new ErroD4sign(operacao, status, `D4Sign respondeu ${status}: ${bruto.slice(0, 200)}`)
      let dados: unknown = null
      if (bruto.trim()) {
        try {
          dados = JSON.parse(bruto)
        } catch {
          throw new ErroD4sign(operacao, status, 'Resposta do D4Sign não é JSON')
        }
      }
      await registrar({ operacao, http_status: status, duracao_ms: Date.now() - inicio, erro: null })
      return dados
    } catch (e) {
      const erro = e instanceof ErroD4sign ? e : new ErroD4sign(operacao, status, erroLimpo(e))
      await registrar({ operacao, http_status: status, duracao_ms: Date.now() - inicio, erro: erroLimpo(erro.message) })
      throw new ErroD4sign(operacao, erro.status, erroLimpo(erro.message))
    }
  }

  const exigirUuid = (uuid: string) => {
    if (!UUID_D4SIGN.test(uuid)) throw new ErroD4sign('validar', null, 'uuid do documento inválido')
    return encodeURIComponent(uuid)
  }

  return {
    async enviarPdf(nome, pdf) {
      const dados = await chamar('enviar_pdf', 'POST', `/documents/${exigirUuid(cfg.cofre)}/uploadbinary`, {
        base64_binary_file: base64(pdf), mime_type: 'application/pdf', name: nome,
      })
      const uuid = texto(primeiroObjeto(dados)?.uuid)
      if (!uuid || !UUID_D4SIGN.test(uuid)) throw new ErroD4sign('enviar_pdf', 200, 'O D4Sign não devolveu o uuid do documento')
      return uuid
    },

    async cadastrarSignatarios(uuid, signatarios) {
      const dados = await chamar('cadastrar_signatarios', 'POST', `/documents/${exigirUuid(uuid)}/createlist`, {
        signers: signatarios.map((s) => ({
          email: s.email,
          act: s.ato === 'testemunhar' ? '5' : '1',
          foreign: '0',
          certificadoicpbr: '0',
          assinatura_presencial: '0',
        })),
      })
      const devolvidos = objetosComEmail(dados)
      return signatarios.map((s) => {
        const d = devolvidos.find((x) => String(x.email).toLowerCase() === s.email.toLowerCase())
        return { email: s.email, chave: texto(d?.key_signer) }
      })
    },

    async cadastrarWebhook(uuid, urlWebhook) {
      await chamar('cadastrar_webhook', 'POST', `/documents/${exigirUuid(uuid)}/webhooks`, { url: urlWebhook })
    },

    async enviarParaAssinatura(uuid, mensagem, prazo) {
      await chamar('enviar_para_assinatura', 'POST', `/documents/${exigirUuid(uuid)}/sendtosigner`, {
        message: mensagem, skip_email: '0', workflow: '0', ...(prazo ? { sign_limit_date: prazo } : {}),
      })
    },

    async documento(uuid) {
      const o = primeiroObjeto(await chamar('consultar_documento', 'GET', `/documents/${exigirUuid(uuid)}`))
      return { uuid, nome: texto(o?.nameDoc), statusId: texto(o?.statusId), statusNome: texto(o?.statusName) }
    },

    async signatarios(uuid) {
      const dados = await chamar('consultar_signatarios', 'GET', `/documents/${exigirUuid(uuid)}/list`)
      return objetosComEmail(dados).map((o) => {
        const info = (o.sign_info && typeof o.sign_info === 'object' ? o.sign_info : {}) as Record<string, unknown>
        const assinado = String(o.signed ?? '') === '1'
        return { email: String(o.email).trim().toLowerCase(), chave: texto(o.key_signer), assinado, assinado_em: assinado ? texto(info.date_signed) : null }
      })
    },

    async cancelar(uuid, comentario, operacao = 'cancelar') {
      await chamar(operacao, 'POST', `/documents/${exigirUuid(uuid)}/cancel`, { comment: comentario })
    },

    async baixarPdf(uuid) {
      const o = primeiroObjeto(await chamar('baixar_pdf', 'POST', `/documents/${exigirUuid(uuid)}/download`, { type: 'PDF', language: 'pt' }))
      const link = texto(o?.url)
      if (!link || !linkPdfPermitido(link, cfg)) throw new ErroD4sign('baixar_pdf', 200, 'O D4Sign não devolveu o link do PDF')
      const inicio = Date.now()
      let status: number | null = null
      try {
        const resp = await fetchFn(link, { signal: AbortSignal.timeout(timeoutMs) })
        status = resp.status
        if (!resp.ok) throw new ErroD4sign('baixar_pdf_arquivo', status, `Download do PDF respondeu ${status}`)
        const declarado = Number(resp.headers.get('content-length') ?? '0')
        if (declarado > limitePdf) throw new ErroD4sign('baixar_pdf_arquivo', status, 'PDF assinado grande demais')
        const bytes = new Uint8Array(await resp.arrayBuffer())
        if (bytes.byteLength > limitePdf) throw new ErroD4sign('baixar_pdf_arquivo', status, 'PDF assinado grande demais')
        if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
          throw new ErroD4sign('baixar_pdf_arquivo', status, 'O arquivo baixado não é um PDF')
        }
        await registrar({ operacao: 'baixar_pdf_arquivo', http_status: status, duracao_ms: Date.now() - inicio, erro: null })
        return bytes
      } catch (e) {
        const msg = erroLimpo(e instanceof Error ? e.message : e)
        await registrar({ operacao: 'baixar_pdf_arquivo', http_status: status, duracao_ms: Date.now() - inicio, erro: msg })
        throw new ErroD4sign('baixar_pdf_arquivo', status, msg)
      }
    },
  }
}

// ============ mapeamento de status ============

/** Situação do documento no D4Sign → o que o contrato registra. Nulo = nada a registrar (ainda não enviado, arquivado,
 * em edição ou desconhecido: a reconciliação tenta de novo depois). */
export function statusDoDocumento(statusId: string | number | null | undefined): StatusRetornoD4sign | null {
  switch (String(statusId ?? '').trim()) {
    case '3': return 'assinatura_pendente'
    case '4': return 'assinado'
    case '6': return 'cancelado'
    default: return null
  }
}

/** Signatários da API → p_signatarios de contrato_registrar_retorno (e-mail como chave). */
export function signatariosDoRetorno(lista: readonly SignatarioD4sign[]): SignatarioRetorno[] {
  return lista.map((s) => ({
    email: s.email.trim().toLowerCase(),
    status: s.assinado ? 'assinado' : 'pendente',
    assinado_em: s.assinado ? dataIso(s.assinado_em) : null,
    recusado_em: null,
    motivo: null,
  }))
}

/** "2026-09-28 14:03:10" (horário de Brasília, como o D4Sign costuma devolver) ou ISO → ISO; inválida → nulo. */
export function dataIso(valor: string | null | undefined): string | null {
  if (!valor) return null
  const v = valor.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v)
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}-03:00`
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// ============ webhook ============

export interface EventoWebhook {
  uuid: string
  typePost: string | null
  email: string | null
  /**
   * Campos de texto recebidos em forma canônica (pares [chave, valor] ordenados pela chave), independente da
   * codificação: o mesmo evento em multipart (fronteira aleatória a cada envio), x-www-form-urlencoded ou JSON dá o
   * mesmo texto. Só entra no hash da chave de idempotência; nunca é gravado.
   */
  conteudo: string
}

/** Forma canônica dos campos do corpo (ver EventoWebhook.conteudo). */
function conteudoCanonico(campos: Record<string, unknown>): string {
  const pares = Object.keys(campos).sort().map((k) => {
    const v = campos[k]
    return [k, typeof v === 'string' ? v : (JSON.stringify(v) ?? null)]
  })
  return JSON.stringify(pares)
}

/**
 * Lê o corpo do webhook (form-data, x-www-form-urlencoded ou JSON). Só identifica o documento: nada daqui é usado
 * como verdade. Devolve nulo quando não há um uuid válido.
 */
export async function lerEventoWebhook(corpo: Uint8Array, contentType: string | null): Promise<EventoWebhook | null> {
  const tipo = (contentType ?? '').split(';')[0].trim().toLowerCase()
  let campos: Record<string, unknown> = {}
  try {
    if (tipo === 'multipart/form-data') {
      const form = await new Response(corpo.slice().buffer as ArrayBuffer, { headers: { 'content-type': contentType ?? '' } }).formData()
      for (const [k, v] of form.entries()) if (typeof v === 'string') campos[k] = v
    } else {
      const bruto = new TextDecoder('utf-8', { fatal: true }).decode(corpo)
      if (tipo === 'application/json' || bruto.trim().startsWith('{')) {
        const json = JSON.parse(bruto) as unknown
        if (!json || typeof json !== 'object' || Array.isArray(json)) return null
        campos = json as Record<string, unknown>
      } else {
        campos = Object.fromEntries(new URLSearchParams(bruto))
      }
    }
  } catch {
    return null
  }
  const uuid = texto(campos.uuid)
  if (!uuid || !UUID_D4SIGN.test(uuid)) return null
  const email = texto(campos.email)
  return {
    uuid, typePost: texto(campos.type_post)?.slice(0, 20) ?? null, email: email ? email.slice(0, 200).toLowerCase() : null,
    conteudo: conteudoCanonico(campos),
  }
}

/**
 * Cabeçalho Content-Hmac ("sha256=<hex>"): HMAC-SHA256 do uuid do documento com D4SIGN_HMAC_SECRET (documentação do
 * D4Sign). Aceita também o HMAC do corpo cru ⚑ (a confirmar no sandbox). Comparação em tempo constante.
 */
export async function hmacWebhookConfere(cabecalho: string | null, segredo: string, uuid: string, corpo: Uint8Array): Promise<boolean> {
  if (!cabecalho || !segredo) return false
  const recebido = cabecalho.trim().replace(/^sha256=/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(recebido)) return false
  const doUuid = await hmacSha256Hex(segredo, uuid)
  const doCorpo = await hmacSha256Hex(segredo, corpo)
  // as duas comparações sempre rodam (tempo independente de qual bateu)
  const a = iguaisTempoConstante(recebido, doUuid)
  const b = iguaisTempoConstante(recebido, doCorpo)
  return a || b
}

/**
 * Chave de idempotência do evento (§6.5): sha256(uuid|type_post|email|sha256(corpo)), com o corpo na forma canônica
 * (EventoWebhook.conteudo). O hash dos BYTES crus não servia: em multipart/form-data a fronteira muda a cada envio, e
 * a repetição do mesmo evento virava um evento novo, reprocessado (achado do teste na stack real, WP7).
 */
export async function chaveIdempotencia(evento: EventoWebhook): Promise<string> {
  return sha256Hex(`${evento.uuid}|${evento.typePost ?? ''}|${evento.email ?? ''}|${await sha256Hex(evento.conteudo)}`)
}

// ============ orquestração (portas injetadas) ============

export interface ArgsRetorno {
  p_d4sign_uuid: string
  p_status: StatusRetornoD4sign
  p_signatarios: SignatarioRetorno[]
  p_pdf_assinado_path: string | null
  p_sha256: string | null
}

export interface PortasRetorno {
  api: ClienteD4sign
  /** Grava o PDF assinado no bucket contratos (idempotente: mesmo conteúdo, mesmo caminho). */
  salvarPdfAssinado(caminho: string, pdf: Uint8Array): Promise<void>
  /** contrato_registrar_retorno com a service role. */
  registrarRetorno(args: ArgsRetorno): Promise<void>
}

/**
 * Reconsulta o documento na API e registra a situação (webhook, reconciliação e "Atualizar status"). Todos
 * assinaram: baixa o PDF assinado, grava <contrato>/assinado-<sha8>.pdf e registra. Devolve o status registrado, ou
 * nulo se não havia nada a registrar.
 */
export async function reconsultarDocumento(portas: PortasRetorno, contratoId: string, uuid: string): Promise<StatusRetornoD4sign | null> {
  const doc = await portas.api.documento(uuid)
  const status = statusDoDocumento(doc.statusId)
  if (!status) return null
  const signatarios = signatariosDoRetorno(await portas.api.signatarios(uuid))
  if (status === 'assinado') {
    const pdf = await portas.api.baixarPdf(uuid)
    const sha = await sha256Hex(pdf)
    const caminho = `${contratoId}/assinado-${sha.slice(0, 8)}.pdf`
    await portas.salvarPdfAssinado(caminho, pdf)
    await portas.registrarRetorno({ p_d4sign_uuid: uuid, p_status: 'assinado', p_signatarios: signatarios, p_pdf_assinado_path: caminho, p_sha256: sha })
  } else {
    await portas.registrarRetorno({ p_d4sign_uuid: uuid, p_status: status, p_signatarios: signatarios, p_pdf_assinado_path: null, p_sha256: null })
  }
  return status
}

export interface DadosEnvio {
  /** Nome do documento no D4Sign (sem dado pessoal): nomeDocumento(codigo, pdf_path). */
  nome: string
  pdf: Uint8Array
  /** Documento já criado numa tentativa anterior (reenvio). */
  d4signUuid: string | null
  signatarios: readonly SignatarioResolvido[]
  mensagem: string
  prazo: string | null
}

export interface PortasEnvio {
  api: ClienteD4sign
  /** contrato_registrar_d4sign_uuid (service role), logo depois do upload. */
  registrarUuid(uuid: string): Promise<void>
  /**
   * contrato_confirmar_envio (service role), logo ANTES do disparo: o banco reconfere que o envio ainda vale (em análise,
   * trava valendo, este documento, validações em dia). Se lançar, nada é disparado (WP4R-01).
   */
  confirmarEnvio(uuid: string): Promise<void>
  /** contrato_registrar_envio (service role). */
  registrarEnvio(signatarios: SignatarioEnviado[], webhookTokenHash: string, uuid: string): Promise<void>
  /** URL do webhook com o token (…/d4sign-webhook?t=<token>). */
  urlWebhook(token: string): string
  gerarToken?: () => string
}

/** "contrato-0000123-minuta-v2-abcdef12" a partir do código e do caminho da minuta (<id>/minuta-v2-abcdef12.pdf). */
export function nomeDocumento(codigo: number | string, pdfPath: string): string {
  const arquivo = pdfPath.split('/').pop() ?? pdfPath
  return `contrato-${String(codigo).replace(/\D/g, '').padStart(7, '0')}-${arquivo.replace(/\.pdf$/i, '')}`
}

/**
 * Impressão (8 hex) da lista de signatários: ordem, papel, e-mail e ato. Entra no nome do documento no D4Sign, então
 * qualquer mudança na lista (e-mail do cliente corrigido, representante trocado, testemunha que passou a assinar) gera
 * outro nome e o documento antigo não é reaproveitado (WP4R-02). Sem dado pessoal legível.
 */
export async function impressaoSignatarios(signatarios: readonly SignatarioResolvido[]): Promise<string> {
  const linhas = signatarios
    .map((s) => [s.ordem, s.papel, s.email.trim().toLowerCase(), s.ato].join('|'))
    .sort()
  return (await sha256Hex(linhas.join('\n'))).slice(0, 8)
}

/** Nome do documento no D4Sign para este envio: minuta + impressão dos signatários. */
export async function nomeDoEnvio(nomeMinuta: string, signatarios: readonly SignatarioResolvido[]): Promise<string> {
  return `${nomeMinuta}-s${await impressaoSignatarios(signatarios)}`
}

const mesmoNome = (a: string | null, b: string) => (a ?? '').replace(/\.pdf$/i, '').trim().toLowerCase() === b.toLowerCase()

/**
 * Envio para assinatura (§6.4), retomável sem duplicar:
 * - reaproveita o documento de uma tentativa anterior só quando é a mesma minuta COM a mesma lista de signatários (o
 *   nome carrega as duas) e o D4Sign não tem ninguém a mais (WP4R-02: um e-mail que saiu da lista nunca fica lá). Fora
 *   disso cancela o antigo (operação própria 'cancelar_substituido') e sobe de novo;
 * - cadastra só os signatários que faltam; registra o webhook com um token novo (só o sha256 vai para o banco);
 * - reconfere no banco (confirmarEnvio) e só então dispara o envio, se ainda não foi;
 * - registra o envio. Se a confirmação ou o registro falharem com o documento já disparado, cancela o documento no
 *   D4Sign antes de devolver o erro: os signatários não ficam com um contrato vivo que a plataforma não registrou
 *   (WP4R-01). Se até o cancelamento falhar, o erro diz isso (vai para integracao_chamadas pela Edge).
 */
export async function enviarParaAssinatura(portas: PortasEnvio, dados: DadosEnvio): Promise<{ uuid: string }> {
  const nome = await nomeDoEnvio(dados.nome, dados.signatarios)
  const desejados = new Set(dados.signatarios.map((s) => s.email.trim().toLowerCase()))
  let uuid = dados.d4signUuid
  let jaEnviado = false
  let existentes: SignatarioD4sign[] = []
  if (uuid) {
    const doc = await portas.api.documento(uuid)
    let valido = mesmoNome(doc.nome, nome) && doc.statusId !== '6'
    if (valido) {
      existentes = await portas.api.signatarios(uuid)
      jaEnviado = doc.statusId === '3' || doc.statusId === '4'
      const sobrando = existentes.some((s) => !desejados.has(s.email.trim().toLowerCase()))
      const faltando = [...desejados].some((e) => !existentes.some((s) => s.email.trim().toLowerCase() === e))
      valido = !sobrando && !(jaEnviado && faltando)
    }
    if (!valido) {
      if (doc.statusId === '4') {
        // todos já assinaram um documento que a plataforma não registrou: cancelar não é possível nem seguro
        throw new ErroD4sign('validar', null, 'O documento anterior já foi finalizado no D4Sign; confira com a equipe técnica antes de reenviar')
      }
      if (doc.statusId !== '6') await portas.api.cancelar(uuid, 'Substituído por uma nova versão da minuta', 'cancelar_substituido')
      uuid = null
      jaEnviado = false
      existentes = []
    }
  }
  if (!uuid) {
    uuid = await portas.api.enviarPdf(nome, dados.pdf)
    await portas.registrarUuid(uuid)
  }

  const chaves = new Map(existentes.map((s) => [s.email.trim().toLowerCase(), s.chave]))
  const faltando = dados.signatarios.filter((s) => !chaves.has(s.email.trim().toLowerCase()))
  if (faltando.length) {
    for (const s of await portas.api.cadastrarSignatarios(uuid, faltando)) chaves.set(s.email.trim().toLowerCase(), s.chave)
  }

  const token = (portas.gerarToken ?? (() => tokenAleatorio(32)))()
  await portas.api.cadastrarWebhook(uuid, portas.urlWebhook(token))
  let disparado = jaEnviado
  try {
    await portas.confirmarEnvio(uuid)
    if (!jaEnviado) {
      disparado = true // na dúvida (erro ou tempo esgotado no disparo), trata como disparado e cancela
      await portas.api.enviarParaAssinatura(uuid, dados.mensagem, dados.prazo)
    }
    await portas.registrarEnvio(
      dados.signatarios.map((s) => ({ ...s, d4sign_chave: chaves.get(s.email.trim().toLowerCase()) ?? null })),
      await sha256Hex(token),
      uuid,
    )
  } catch (e) {
    if (disparado) {
      try {
        await portas.api.cancelar(uuid, 'Envio não concluído na plataforma Arken', 'cancelar_substituido')
      } catch (c) {
        throw new ErroD4sign('cancelar_substituido', null,
          `${erroLimpo(e, 200)}; o documento pode ter ficado ativo no D4Sign (o cancelamento falhou: ${erroLimpo(c, 200)})`)
      }
    }
    throw e
  }
  return { uuid }
}

// ============ RPCs chamadas pelas Edges ============

/** Resposta de uma RPC (supabase-js `db.rpc`), só com o que as Edges usam. */
export interface ResultadoRpc {
  data: unknown
  error: ErroPostgrest | null
}

/** `(nome, args) => db.rpc(nome, args)`: com o JWT de quem pediu ou com a service role. */
export type ChamarRpc = (nome: string, args: Record<string, unknown>) => PromiseLike<ResultadoRpc>

/** Erro de uma RPC de sistema chamada no meio de um fluxo (guarda o erro do banco para a resposta). */
export class ErroRpcSistema extends Error {
  readonly rpc: string
  readonly erro: ErroPostgrest
  constructor(rpc: string, erro: ErroPostgrest) {
    super(`${rpc}: ${erro.code ?? ''} ${erro.message ?? ''}`.trim())
    this.name = 'ErroRpcSistema'
    this.rpc = rpc
    this.erro = erro
  }
}

/** Chama a RPC e lança ErroRpcSistema se ela falhar. */
export async function exigirRpc(chamar: ChamarRpc, nome: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await chamar(nome, args)
  if (error) throw new ErroRpcSistema(nome, error)
  return data
}

/** Cliente do D4Sign já configurado pela Edge (segredos lidos lá), ou o motivo de não estar. */
export type FabricaD4sign =
  | { ok: true; criar(registrar: RegistrarChamada): ClienteD4sign }
  | { ok: false; erro: string }

/** Linha de integracao_chamadas (formato de linhaChamada). */
export type LinhaChamada = ReturnType<typeof linhaChamada>

/** Dia (YYYY-MM-DD) de um instante no horário de Brasília (UTC−3, sem horário de verão desde 2019), como o
 * `(now() at time zone 'America/Sao_Paulo')::date` de contrato_dados_modelo. Nulo/ inválido → nulo. */
export function diaEmBrasilia(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10)
}

/** sign_limit_date do D4Sign (DD-MM-YYYY) a partir de `prazo_assinatura_dias` (D4: nulo = sem prazo), no fuso de Brasília. */
export function prazoAssinatura(dias: number | null | undefined, agora: Date = new Date()): string | null {
  if (!dias || !Number.isInteger(dias) || dias <= 0) return null
  const brasilia = new Date(agora.getTime() - 3 * 3600_000 + dias * 86_400_000)
  const dd = String(brasilia.getUTCDate()).padStart(2, '0')
  const mm = String(brasilia.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${brasilia.getUTCFullYear()}`
}

// ============ erros de RPC nas Edges de contrato ============

export interface ErroPostgrest {
  code?: string | null
  message?: string | null
  details?: string | null
}

export interface RespostaErroRpc {
  status: number
  mensagem: string
  /** O erro da RPC como veio (código, mensagem e detalhe): o front traduz com traduzirErro (src/lib/erros.ts). */
  detalhes: { code: string | null; message: string | null; details: string | null }
}

const CODIGOS_CONFLITO = new Set(['ENVIO_EM_ANDAMENTO', 'CONFLITO_VERSAO', 'CONTRATO_ATIVO', 'TRANSICAO_INVALIDA'])

/** Erro de uma RPC chamada pela Edge → resposta HTTP. Frases pt-BR do banco passam; mensagens nativas não. */
export function erroDaRpc(e: ErroPostgrest): RespostaErroRpc {
  const code = e.code ?? null
  const message = (e.message ?? '').trim()
  const detalhes = { code, message: message || null, details: e.details ?? null }
  if (code === '42501') return { status: 403, mensagem: 'Você não tem acesso a este registro.', detalhes }
  if (code === 'PGRST301' || code === 'PGRST303') return { status: 401, mensagem: 'Sua sessão expirou. Entre de novo.', detalhes }
  if (code === 'P0001') {
    if (/^[A-Z][A-Z0-9_]{3,}$/.test(message)) {
      return { status: CODIGOS_CONFLITO.has(message) ? 409 : 422, mensagem: 'Não foi possível concluir a operação.', detalhes }
    }
    return { status: 422, mensagem: message || 'Não foi possível concluir a operação.', detalhes }
  }
  return { status: 500, mensagem: 'Não foi possível concluir a operação. Tente de novo.', detalhes: { code, message: null, details: null } }
}

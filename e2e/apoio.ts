import type { Page, Route } from '@playwright/test'
import { ACOES_REDE_PADRAO, internoDeReferencia, permissoesDeReferencia } from '../src/lib/menu'
import type { AcaoRede, Escopo, Papel, StatusParceiro, TipoParceiro } from '../src/lib/types'

// Simulações de rede para os testes ponta a ponta: nada chega ao Supabase real nem à Cloudflare.
export const PROJETO = 'xucwjsycawizrlouqkvh'

/** Turnstile de mentira: entrega um token na hora. */
export async function simularTurnstile(page: Page) {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (r) =>
    r.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = { render: (el, o) => { setTimeout(() => o.callback('token-e2e'), 0); return 'w' }, remove: () => {} }`,
    }),
  )
}

/** JWT com formato válido (o supabase-js só decodifica no navegador; a assinatura não é conferida). */
export function jwtFalso(sub: string, email: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 3600
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp })}.assinatura`
}

export const usuario = (id: string, email: string) => ({
  id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString(),
})

// Perfil servido por responderRest em /rest/v1/profiles, por página: é dele que sai o meu_escopo simulado padrão.
interface PerfilSimulado { papel?: Papel; status_parceiro?: StatusParceiro; nome?: string }
const perfisSimulados = new WeakMap<Page, PerfilSimulado>()

function lembrarPerfil(route: Route, linhas: unknown[]) {
  if (!/\/rest\/v1\/profiles(\?|$)/.test(route.request().url())) return
  const p = linhas[0] as PerfilSimulado | undefined
  if (!p?.papel) return
  try {
    perfisSimulados.set(route.request().frame().page(), p)
  } catch {
    // requisição sem frame (service worker): não há de onde derivar o escopo
  }
}

/** Responde como o PostgREST: objeto quando o cliente pede um registro (single/maybeSingle), senão lista. */
export function responderRest(route: Route, linhas: unknown[], status = 200) {
  lembrarPerfil(route, linhas)
  const umRegistro = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(umRegistro ? (linhas[0] ?? null) : linhas) })
}

/**
 * Lista com `count: 'exact'` como o PostgREST responde: `content-range` com o total (senão o supabase-js devolve
 * `count` nulo). `total` padrão = quantidade de linhas.
 */
export function responderPagina(route: Route, linhas: unknown[], total = linhas.length) {
  const fim = Math.max(linhas.length - 1, 0)
  return route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'content-range': linhas.length ? `0-${fim}/${total}` : `*/${total}`, 'access-control-expose-headers': 'content-range' },
    body: JSON.stringify(linhas),
  })
}

/**
 * Nada sai para o Supabase real:leitura REST que o teste não simulou responde lista vazia, e qualquer outra chamada
 * (RPC, Auth, Storage, Edge Function) responde 404 `PGRST202`. Chame ANTES das simulações específicas (no Playwright,
 * a rota registrada por último tem precedência).
 */
export async function isolarSupabase(page: Page) {
  await page.route(/\.supabase\.co\//, (r) => {
    const req = r.request()
    if (req.method() === 'GET' && /\/rest\/v1\/(?!rpc\/)/.test(req.url())) return responderRest(r, [])
    return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'não simulado', details: null, hint: null }) })
  })
}

// ---------- RPCs ----------

const urlRpc =(nome: string) => new RegExp(`/rest/v1/rpc/${nome}(\\?|$)`)

const ERRO_RPC = Symbol('erro-rpc')
interface ErroRpcSimulado { [ERRO_RPC]: true; code: string; message: string; details: string | null; status: number }
const ehErroRpc = (v: unknown): v is ErroRpcSimulado => !!v && typeof v === 'object' && ERRO_RPC in v

/**
 * Resposta de erro no formato do PostgREST, para usar em `simularRpc`. Ex.: `erroRpc('42501', 'Sem acesso a este registro')`,
 * `erroRpc('P0001', 'CAMPOS_OBRIGATORIOS', { campos: ['nome', 'cep'] })`, `erroRpc('0A000', 'nao_implementado')`.
 */
export function erroRpc(code: string, message: string, details?: unknown, status?: number): ErroRpcSimulado {
  return {
    [ERRO_RPC]: true, code, message,
    details: details === undefined || details === null ? null : typeof details === 'string' ? details : JSON.stringify(details),
    status: status ?? (code === '42501' ? 403 : code === '0A000' ? 501 : 400),
  }
}

/**
 * Simula `POST /rest/v1/rpc/<nome>`. `resposta` pode ser o JSON devolvido, um `erroRpc(...)` ou uma função dos
 * argumentos recebidos (com os nomes `p_…`). Devolve a lista de argumentos de cada chamada, para as asserções
 * (ex.: conferir que o corpo de `contrato_criar` não leva valores calculados).
 * A rota registrada por último vale: chame de novo para trocar a resposta no meio do teste.
 */
export function simularRpc(page: Page, nome: string, resposta: (args: Record<string, unknown>) => unknown): Promise<Record<string, unknown>[]>
export function simularRpc(page: Page, nome: string, resposta: unknown): Promise<Record<string, unknown>[]>
export async function simularRpc(page: Page, nome: string, resposta: unknown): Promise<Record<string, unknown>[]> {
  const chamadas: Record<string, unknown>[] = []
  await page.route(urlRpc(nome), async (r) => {
    const args = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    chamadas.push(args)
    const corpo = typeof resposta === 'function' ? await (resposta as (a: Record<string, unknown>) => unknown)(args) : resposta
    if (ehErroRpc(corpo)) {
      return r.fulfill({
        status: corpo.status, contentType: 'application/json',
        body: JSON.stringify({ code: corpo.code, message: corpo.message, details: corpo.details, hint: null }),
      })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo ?? null) })
  })
  return chamadas
}

/**
 * Simula a Edge `baixar-arquivo` (§4.3): depois de `crm_documento_baixar`/`contrato_baixar`/`portal_contrato_baixar`,
 * `urlDoDownload` pede a URL assinada a ela. Devolve os corpos recebidos (`{ bucket, path }`), para as asserções.
 * `status` diferente de 200 responde `{ erro }` como a função real (ex.: 403 = autorização vencida).
 */
export async function simularDownload(page: Page, url = 'https://arquivos.e2e.test/documento.pdf', status = 200) {
  const pedidos: Record<string, unknown>[] = []
  await page.route('**/functions/v1/baixar-arquivo', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204 })
    pedidos.push((r.request().postDataJSON() ?? {}) as Record<string, unknown>)
    const corpo = status === 200
      ? { url, expira_em: new Date(Date.now() + 60_000).toISOString() }
      : { erro: 'O link de download expirou. Tente baixar de novo.', codigo: 'download_nao_autorizado' }
    return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) })
  })
  return pedidos
}

// ---------- escopo (meu_escopo) ----------

export interface OpcoesEscopo {
  status?: StatusParceiro
  /** Tipo do vínculo em `parceiros`. Padrão: o próprio papel para imobiliária/gerente/corretor; nenhum para os demais. */
  tipo?: TipoParceiro | null
  /** Ações de `permissoes_rede` ligadas. Padrão: a semente da §3.3 para o tipo. */
  acoes?: AcaoRede[]
  nome?: string
  inativado?: boolean
  /** Sobrescreve qualquer campo do escopo montado. */
  extra?: Partial<Escopo>
}

/** Escopo coerente com a regra de referência de `meu_escopo()` (src/lib/menu.ts). */
export function escopoSimulado(papel: Papel, o: OpcoesEscopo = {}): Escopo {
  const status = o.status ?? 'aprovado'
  const tipo = o.tipo !== undefined ? o.tipo : papel === 'imobiliaria' || papel === 'gerente' || papel === 'corretor' ? papel : null
  const aprovado = status === 'aprovado' && !o.inativado
  const vinculo = aprovado && tipo !== null
  // como is_admin(): com 2FA exigida só é interno em aal2 (ex.: extra: { mfa_exigido: true, aal: 'aal2' })
  const mfaExigido = o.extra?.mfa_exigido ?? false
  const aal = o.extra?.aal ?? 'aal1'
  const interno = internoDeReferencia({ papel, status_parceiro: status, inativado: !!o.inativado, mfa_exigido: mfaExigido, aal })
  const acoes = tipo ? o.acoes ?? ACOES_REDE_PADRAO[tipo] : []
  const nome = o.nome ?? 'Usuário E2E'
  const parceiroId = vinculo ? '99999999-0000-4000-8000-000000000001' : null
  const base: Escopo = {
    profile_id: '99999999-0000-4000-8000-0000000000aa',
    papel, status_parceiro: status, inativado: !!o.inativado, interno, super: interno && papel === 'super',
    mfa_exigido: mfaExigido, aal,
    parceiro_id: parceiroId, tipo: vinculo ? tipo : null,
    imobiliaria_id: vinculo ? '99999999-0000-4000-8000-0000000000b1' : null,
    gerente_id: vinculo && tipo === 'corretor' ? '99999999-0000-4000-8000-0000000000c1' : vinculo && tipo === 'gerente' ? parceiroId : null,
    parceiro: vinculo && tipo
      ? { id: parceiroId!, tipo, nome, codigo_indicacao: tipo === 'imobiliaria' ? null : 'abcdefghij', creci: tipo === 'corretor' ? '123456-F' : null, virtual: false, migrado_legado: false }
      : null,
    imobiliaria: vinculo ? { id: '99999999-0000-4000-8000-0000000000b1', nome: 'Imobiliária E2E', da_casa: false } : null,
    permissoes: permissoesDeReferencia({ papel, status_parceiro: status, inativado: !!o.inativado, interno, super: interno && papel === 'super', tipo: vinculo ? tipo : null, acoes }),
    pendencias: [],
    sessao_inatividade_horas: 8,
  }
  return { ...base, ...o.extra }
}

/** Simula `meu_escopo()` por papel (ou com o escopo pronto). */
export function simularEscopo(page: Page, papelOuEscopo: Papel | Escopo, opcoes: OpcoesEscopo = {}) {
  const escopo = typeof papelOuEscopo === 'string' ? escopoSimulado(papelOuEscopo, opcoes) : papelOuEscopo
  return simularRpc(page, 'meu_escopo', escopo)
}

/**
 * Sessão já logada no localStorage antes de o app carregar (mesma chave que o supabase-js usa).
 * - com `papel`: simula também o perfil (`/rest/v1/profiles`) e o `meu_escopo()` desse papel;
 * - sem `papel` (compatível com os testes antigos): o `meu_escopo()` sai do perfil que o teste servir por `responderRest`.
 * Rotas registradas depois pelo teste têm precedência sobre estas.
 */
export async function entrarComo(page: Page, id: string, email: string, papel?: Papel, opcoes: OpcoesEscopo = {}) {
  const token = jwtFalso(id, email)
  const sessao = {
    access_token: token, refresh_token: 'refresh-e2e', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: usuario(id, email),
  }
  await page.addInitScript(([chave, valor]) => localStorage.setItem(chave, valor), [`sb-${PROJETO}-auth-token`, JSON.stringify(sessao)])
  await page.route('**/auth/v1/user', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(usuario(id, email)) }))

  if (papel) {
    const nome = opcoes.nome ?? 'Usuário E2E'
    await page.route('**/rest/v1/profiles**', (r) =>
      responderRest(r, [{ id, papel, nome, email, telefone: null, cpf: null, creci: null, imobiliaria: null, status_parceiro: opcoes.status ?? 'aprovado', created_at: '2026-09-01T00:00:00Z' }]),
    )
    await simularEscopo(page, papel, { ...opcoes, extra: { profile_id: id, ...opcoes.extra } })
  } else {
    await page.route(urlRpc('meu_escopo'), (r) => {
      const p = perfisSimulados.get(page)
      if (!p?.papel) {
        return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'meu_escopo não simulado neste teste', details: null, hint: null }) })
      }
      const escopo = escopoSimulado(p.papel, { status: p.status_parceiro ?? 'aprovado', nome: p.nome, extra: { profile_id: id } })
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(escopo) })
    })
  }
  return token
}

export const empreendimentoTeste = {
  id: '11111111-1111-1111-1111-111111111111', slug: 'residencial-e2e', nome: 'Residencial E2E', estagio: 'lancamento',
  publicado: true, destaque_home: true, ordem: 0, capa_url: null, videos: [], aceita_fgts: false, mostrar_no_portfolio: false,
}

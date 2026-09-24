import type { Page, Route } from '@playwright/test'

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

/** Responde como o PostgREST: objeto quando o cliente pede um registro (single/maybeSingle), senão lista. */
export function responderRest(route: Route, linhas: unknown[], status = 200) {
  const umRegistro = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(umRegistro ? (linhas[0] ?? null) : linhas) })
}

/** Sessão já logada no localStorage antes de o app carregar (mesma chave que o supabase-js usa). */
export async function entrarComo(page: Page, id: string, email: string) {
  const token = jwtFalso(id, email)
  const sessao = {
    access_token: token, refresh_token: 'refresh-e2e', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: usuario(id, email),
  }
  await page.addInitScript(([chave, valor]) => localStorage.setItem(chave, valor), [`sb-${PROJETO}-auth-token`, JSON.stringify(sessao)])
  await page.route('**/auth/v1/user', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(usuario(id, email)) }))
  return token
}

export const empreendimentoTeste = {
  id: '11111111-1111-1111-1111-111111111111', slug: 'residencial-e2e', nome: 'Residencial E2E', estagio: 'lancamento',
  publicado: true, destaque_home: true, ordem: 0, capa_url: null, videos: [], aceita_fgts: false, mostrar_no_portfolio: false,
}

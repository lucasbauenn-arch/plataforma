import { expect, type Browser, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

// Apoio dos fluxos REAIS (e2e-real/): o front roda em `vite --mode stack` apontando para a stack Supabase LOCAL
// completa (GoTrue, PostgREST, Storage, Edge Functions), subida pelo verificar.sh da pasta de rascunho. Nada aqui
// simula a rede do Supabase. Fora da suíte normal: `npx playwright test -c e2e-real/playwright.config.ts`.
//
// Variáveis (o verificar.sh preenche):
//   STACK_ESTADO  estado.json da stack (contas internas criadas pela semente LOCAL)
//   STACK_SENHA   senha das contas de teste da stack local
//   STACK_API     URL da API local (padrão http://127.0.0.1:54861)

const API = (process.env.STACK_API ?? 'http://127.0.0.1:54861').replace(/\/+$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(API)) throw new Error(`STACK_API precisa ser a stack LOCAL (veio ${API})`)

function lerEstado() {
  const arq = process.env.STACK_ESTADO
  if (!arq || !existsSync(arq)) throw new Error('STACK_ESTADO não aponta para o estado.json da stack local (rode pelo verificar.sh e2e)')
  return JSON.parse(readFileSync(arq, 'utf8')) as { admin: { email: string }; super: { email: string } }
}

export const ESTADO = lerEstado()
export const SENHA = process.env.STACK_SENHA ?? ''
if (SENHA.length < 8) throw new Error('STACK_SENHA ausente')
export const SUFIXO = Date.now().toString(36)
export const ESPERA = { timeout: 30_000 }

/**
 * Guarda de isolamento: nenhuma requisição pode ir para um projeto Supabase na nuvem (o .env.stack.local troca a URL;
 * se faltar, a página cairia no projeto real). A chamada é abortada e o teste falha no `conferirIsolamento`.
 * Registra também que a API local foi de fato usada.
 */
export async function isolar(page: Page) {
  const bloqueadas: string[] = []
  const locais: string[] = []
  await page.context().route(/\.supabase\.(co|in)\//, (r) => {
    bloqueadas.push(r.request().url().replace(/\?.*$/, ''))
    return r.abort('blockedbyclient')
  })
  page.on('request', (req) => {
    if (req.url().startsWith(API)) locais.push(req.url())
  })
  return {
    conferir() {
      expect(bloqueadas, 'nenhuma chamada ao Supabase na nuvem').toEqual([])
      expect(locais.length, 'o front falou com a stack local').toBeGreaterThan(0)
    },
  }
}

/**
 * Abre a rota e espera `pronto`. Com o Vite frio, a primeira carga pode reotimizar dependências e deixar o import
 * lazy da tela pendurado: recarrega.
 */
export async function irPara(page: Page, url: string, pronto: () => Locator) {
  await expect(async () => {
    await page.goto(url)
    await expect(pronto()).toBeVisible({ timeout: 25_000 })
  }).toPass({ timeout: 120_000 })
}

/** Login real da área do parceiro/admin (senha + Turnstile com a chave de TESTE da Cloudflare). */
export async function entrar(page: Page, email: string, senha = SENHA, destino: RegExp = /\/(admin|parceiros\/painel)/) {
  await irPara(page, '/parceiros', () => page.getByRole('button', { name: 'Entrar' }))
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  const botao = page.getByRole('button', { name: 'Entrar' })
  await expect(botao).toBeEnabled(ESPERA) // o Turnstile de teste entrega o token
  await botao.click()
  await page.waitForURL(destino, ESPERA)
}

/** Nova página num contexto limpo (outra pessoa), já com a guarda de isolamento. */
export async function novaPessoa(browser: Browser, baseURL: string | undefined) {
  const contexto = await browser.newContext({ baseURL, locale: 'pt-BR' })
  const page = await contexto.newPage()
  const guarda = await isolar(page)
  return { page, guarda, fechar: () => contexto.close() }
}

/** Escolhe no <select> a opção cujo texto contém `texto` (os rótulos podem trazer a imobiliária junto). */
export async function escolherOpcao(select: Locator, texto: string) {
  const opcao = select.locator('option', { hasText: texto })
  await expect(opcao).toHaveCount(1, ESPERA)
  await select.selectOption((await opcao.getAttribute('value')) ?? '')
}

/** CPF válido a partir de uma semente (dígitos verificadores calculados). */
export function cpf(semente: number): string {
  const base = String(100000000 + (semente % 800000000)).slice(0, 9)
  const dv = (s: string, n: number) => {
    let soma = 0
    for (let i = 0; i < n; i++) soma += Number(s[i]) * (n + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  const d1 = dv(base, 9)
  return `${base}${d1}${dv(`${base}${d1}`, 10)}`
}

/** CNPJ válido a partir de uma semente. */
export function cnpj(semente: number): string {
  const base = `${String(10000000 + (semente % 80000000)).padStart(8, '0')}0001`
  const dv = (b: string) => {
    const pesos = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const r = [...b].reduce((a, d, i) => a + Number(d) * pesos[i], 0) % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = dv(base)
  return `${base}${d1}${dv(`${base}${d1}`)}`
}

/** PDF mínimo válido (uma página), para os uploads. */
export function pdfMinimo(texto: string): Buffer {
  const conteudo = `BT /F1 12 Tf 72 720 Td (${texto.replace(/[()\\]/g, '')}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let s = '%PDF-1.4\n'
  const pos: number[] = []
  objs.forEach((o, i) => {
    pos.push(s.length)
    s += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = s.length
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(s, 'latin1')
}

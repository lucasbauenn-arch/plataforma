// Conferência do build de produção ANTES de enviar dist/ para a Hostinger (FR1-02; scripts/migracao/DEPLOY.md, passo 5).
// Uso: npm run build && npm run conferir:dist   (ou: node scripts/conferir-dist.mjs [pasta])
// O que confere (sai com código 1 se algo falhar):
//   1. a chave pública do Turnstile embutida no build (VITE_TURNSTILE_SITE_KEY) NÃO é a chave de TESTE da Cloudflare
//      (1x00000000000000000000AA etc.: sempre aprova) e existe uma chave real (começa com 0x4). Com a chave de teste no
//      front e a secret real no servidor, nenhum token é aceito (login, cadastro e formulários falham para todos); com a
//      secret de teste no servidor o captcha vira formalidade. O npm run build local usa a chave de teste do .env de propósito
//      (desenvolvimento): por isso esta conferência é um passo do deploy, não do build;
//   2. nenhum segredo no bundle: chave secreta do Supabase (sb_secret_…), JWT com role service_role, secret de teste do Turnstile.
// Só lê arquivos de texto (js, css, html, json, xml, txt); nunca imprime o valor achado, só o tipo e o arquivo.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const EXTENSOES = new Set(['.js', '.mjs', '.css', '.html', '.json', '.xml', '.txt', '.webmanifest'])
const TESTE_TURNSTILE = /\b[123]x0{20,}[A-Z]{2}\b/
const CHAVE_REAL_TURNSTILE = /\b0x4[A-Za-z0-9_-]{18,}\b/
const CHAVE_SECRETA = /\bsb_secret_[A-Za-z0-9_-]{8,}/
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g

/** Problemas de um arquivo de texto: [{ tipo, arquivo }] (sem o valor achado). */
export function problemasDoTexto(arquivo, texto) {
  const achados = []
  if (TESTE_TURNSTILE.test(texto)) achados.push({ tipo: 'chave_de_teste_do_turnstile', arquivo })
  if (CHAVE_SECRETA.test(texto)) achados.push({ tipo: 'chave_secreta_do_supabase', arquivo })
  for (const m of texto.matchAll(JWT)) {
    try {
      const corpo = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
      if (corpo?.role === 'service_role') {
        achados.push({ tipo: 'jwt_service_role', arquivo })
        break
      }
    } catch {
      // não era um JWT
    }
  }
  return achados
}

/** Arquivos de texto do build, recursivamente. */
export function arquivosDoBuild(pasta) {
  const lista = []
  for (const e of fs.readdirSync(pasta, { withFileTypes: true })) {
    const caminho = path.join(pasta, e.name)
    if (e.isDirectory()) lista.push(...arquivosDoBuild(caminho))
    else if (EXTENSOES.has(path.extname(e.name).toLowerCase())) lista.push(caminho)
  }
  return lista
}

/** Confere a pasta inteira. `problemas` vazio = tudo certo. */
export function conferirBuild(pasta) {
  if (!fs.existsSync(pasta)) throw new Error(`Pasta ${pasta} não existe: rode npm run build antes.`)
  const problemas = []
  let temChaveReal = false
  for (const arquivo of arquivosDoBuild(pasta)) {
    const texto = fs.readFileSync(arquivo, 'utf8')
    problemas.push(...problemasDoTexto(path.relative(pasta, arquivo).replaceAll('\\', '/'), texto))
    if (!temChaveReal && CHAVE_REAL_TURNSTILE.test(texto)) temChaveReal = true
  }
  if (!temChaveReal) problemas.push({ tipo: 'sem_chave_real_do_turnstile', arquivo: '(nenhum arquivo)' })
  return problemas
}

const MENSAGENS = {
  chave_de_teste_do_turnstile:
    'a chave de TESTE do Turnstile está no build: troque VITE_TURNSTILE_SITE_KEY (.env) pela chave de site real, o par da TURNSTILE_SECRET de produção, e rode npm run build de novo.',
  sem_chave_real_do_turnstile:
    'nenhuma chave real do Turnstile (0x4…) no build: defina VITE_TURNSTILE_SITE_KEY no .env antes do npm run build, senão o widget não aparece e o servidor recusa todos os formulários.',
  chave_secreta_do_supabase: 'uma chave secreta do Supabase (sb_secret_…) está no build: nunca vai para o front; remova de qualquer VITE_*.',
  jwt_service_role: 'um JWT com role service_role está no build: nunca vai para o front; remova de qualquer VITE_*.',
}

const executadoDiretamente = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (executadoDiretamente) {
  const pasta = process.argv[2] ?? 'dist'
  const problemas = conferirBuild(pasta)
  for (const p of problemas) console.error(`[conferir-dist] ${p.arquivo}: ${MENSAGENS[p.tipo]}`)
  if (problemas.length) {
    console.error(`[conferir-dist] ${problemas.length} problema(s): NÃO envie ${pasta}/ para produção.`)
    process.exit(1)
  }
  console.log(`[conferir-dist] ${pasta}/ ok: chave real do Turnstile, sem chave de teste e sem segredos.`)
}

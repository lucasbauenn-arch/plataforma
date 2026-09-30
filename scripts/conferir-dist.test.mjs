import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { conferirBuild, problemasDoTexto } from './conferir-dist.mjs'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.assinaturaassinatura`
const REAL = '0x4AAAAAAAxxxxxxxxxxxxxxxx'
const TESTE = '1x00000000000000000000AA'

describe('problemasDoTexto', () => {
  it('acha as chaves de TESTE do Turnstile (as 3 da Cloudflare, de site e secret) e não confunde com a real', () => {
    for (const chave of [TESTE, '2x00000000000000000000AB', '3x00000000000000000000FF', '1x0000000000000000000000000000000AA']) {
      expect(problemasDoTexto('a.js', `const k="${chave}"`), chave).toEqual([{ tipo: 'chave_de_teste_do_turnstile', arquivo: 'a.js' }])
    }
    expect(problemasDoTexto('a.js', `const k="${REAL}"`)).toEqual([])
  })

  it('acha chave secreta do Supabase e JWT service_role, mas não o JWT da chave publicável (anon)', () => {
    expect(problemasDoTexto('b.js', 'x="sb_secret_abcdef123456"')).toEqual([{ tipo: 'chave_secreta_do_supabase', arquivo: 'b.js' }])
    expect(problemasDoTexto('b.js', `x="${jwt('service_role')}"`)).toEqual([{ tipo: 'jwt_service_role', arquivo: 'b.js' }])
    expect(problemasDoTexto('b.js', `x="${jwt('anon')}"`)).toEqual([])
    expect(problemasDoTexto('b.js', 'x="eyJnaoeumjwt.eyJlixolixolixo.assinaturaassinatura"')).toEqual([])
    expect(problemasDoTexto('b.js', 'x="sb_publishable_abcdef123456"')).toEqual([])
  })

  it('nunca devolve o valor achado', () => {
    expect(JSON.stringify(problemasDoTexto('c.js', `${TESTE} sb_secret_abcdef123456`))).not.toMatch(/1x0000|sb_secret_abc/)
  })
})

describe('conferirBuild', () => {
  const pastas = []
  const criar = (arquivos) => {
    const p = fs.mkdtempSync(path.join(os.tmpdir(), 'conferir-dist-'))
    pastas.push(p)
    for (const [nome, texto] of Object.entries(arquivos)) {
      fs.mkdirSync(path.dirname(path.join(p, nome)), { recursive: true })
      fs.writeFileSync(path.join(p, nome), texto)
    }
    return p
  }
  afterEach(() => {
    for (const p of pastas.splice(0)) fs.rmSync(p, { recursive: true, force: true })
  })

  it('build com a chave real e sem segredos passa', () => {
    expect(conferirBuild(criar({ 'index.html': '<html></html>', 'assets/app-1.js': `render({sitekey:"${REAL}"})` }))).toEqual([])
  })

  it('chave de teste no build reprova (e, sem chave real, também acusa a falta dela)', () => {
    const problemas = conferirBuild(criar({ 'assets/app-1.js': `render({sitekey:"${TESTE}"})` }))
    expect(problemas.map((p) => p.tipo).sort()).toEqual(['chave_de_teste_do_turnstile', 'sem_chave_real_do_turnstile'])
    expect(problemas.find((p) => p.tipo === 'chave_de_teste_do_turnstile').arquivo).toBe('assets/app-1.js')
  })

  it('build sem nenhuma chave do Turnstile reprova (o servidor recusaria todos os formulários)', () => {
    expect(conferirBuild(criar({ 'assets/app-1.js': 'console.log(1)' })).map((p) => p.tipo)).toEqual(['sem_chave_real_do_turnstile'])
  })

  it('ignora imagens e olha as subpastas', () => {
    const p = criar({ 'assets/a.js': `k="${REAL}"`, 'og/x.jpg': 'sb_secret_abcdef123456', 'assets/deep/b.css': 'a{}' })
    expect(conferirBuild(p)).toEqual([])
    fs.writeFileSync(path.join(p, 'assets/deep/c.js'), 'x="sb_secret_abcdef123456"')
    expect(conferirBuild(p)).toEqual([{ tipo: 'chave_secreta_do_supabase', arquivo: 'assets/deep/c.js' }])
  })

  it('pasta inexistente é erro (não "tudo certo")', () => {
    expect(() => conferirBuild(path.join(os.tmpdir(), 'nao-existe-conferir-dist'))).toThrow(/npm run build/)
  })
})

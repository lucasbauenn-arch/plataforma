// Envia para o Supabase Storage (bucket "empreendimentos", pasta wp/) as imagens do WordPress que o seed referencia,
// convertidas para WebP (máx. 1920 px no maior lado, qualidade 80). Uso (na raiz do projeto, Node 22+):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-midias.mjs uploads.zip
// A service role / secret key NUNCA vai para o front-end nem para o git — use só localmente.
import 'dotenv/config'
import fs from 'node:fs'
import AdmZip from 'adm-zip'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'

const [zipPath = 'uploads.zip'] = process.argv.slice(2)
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const seed = fs.readFileSync('supabase/seed/seed_wordpress.sql', 'utf8')
const caminhos = [...new Set([...seed.matchAll(/'wp\/([^']+)'/g)].map((m) => m[1]))]
console.log(`${caminhos.length} arquivos referenciados no seed`)

// o seed aponta para .webp; no zip a origem pode ser png/jpg/jpeg/avif/webp (ordem = preferência)
const ORIGENS = ['png', 'jpg', 'jpeg', 'avif', 'webp']
const semExt = (c) => c.replace(/\.[^./]+$/, '')
const zip = new AdmZip(zipPath)
const exatas = new Map()
const porBase = new Map()
for (const e of zip.getEntries()) {
  const nome = e.entryName.replace(/^(wp-content\/)?uploads\//, '')
  exatas.set(nome, e)
  const ext = nome.split('.').pop().toLowerCase()
  if (!ORIGENS.includes(ext)) continue
  const atual = porBase.get(semExt(nome))
  if (!atual || ORIGENS.indexOf(ext) < ORIGENS.indexOf(atual.ext)) porBase.set(semExt(nome), { e, ext })
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const tipos = { webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }

let ok = 0, antes = 0, depois = 0
const faltando = []
for (const c of caminhos) {
  const ext = c.split('.').pop().toLowerCase()
  const e = ext === 'webp' ? porBase.get(semExt(c))?.e : exatas.get(c)
  if (!e) { faltando.push(c); continue }
  const original = e.getData()
  const dados = ext === 'webp'
    ? await sharp(original).rotate()
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 5 })
        .toBuffer()
    : original
  const { error } = await supabase.storage.from('empreendimentos').upload(`wp/${c}`, dados, {
    contentType: tipos[ext] ?? 'application/octet-stream', upsert: true, cacheControl: '31536000',
  })
  if (error) { console.error('✗', c, error.message); continue }
  ok++; antes += original.length; depois += dados.length
  process.stdout.write(`\r✓ ${ok}/${caminhos.length}`)
}
const mb = (b) => (b / 1024 / 1024).toFixed(1)
console.log(`\nConcluído: ${ok} enviados (${mb(antes)} MB → ${mb(depois)} MB), ${faltando.length} não encontrados no zip`)
if (faltando.length) fs.writeFileSync('scripts/midias-faltando.txt', faltando.join('\n'))

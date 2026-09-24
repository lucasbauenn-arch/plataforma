// Pós-build (roda em `npm run build`): WhatsApp, Facebook e LinkedIn não executam JavaScript, então cada página
// pública precisa sair com as próprias tags no HTML. Gera em dist/:
//   - <rota>.html (servido em /<rota> pelo public/.htaccess na Hostinger e pelo vite preview) com title, description, canonical, Open Graph e JSON-LD (RealEstateListing / Organization)
//   - og/<slug>.jpg e og/padrao.jpg — imagem de compartilhamento 1200×630
//   - sitemap.xml
//   - spa.html — fallback do SPA (rotas privadas e 404) com noindex; ver public/.htaccess
// Novo empreendimento ou mudança de texto no admin só aparece aqui no próximo build/deploy.
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const DIST = 'dist'
const seo = JSON.parse(fs.readFileSync('src/content/seo.json', 'utf8'))
const template = fs.readFileSync(`${DIST}/index.html`, 'utf8')
const MARCA = /<!-- seo:inicio[\s\S]*?<!-- seo:fim -->/
if (!MARCA.test(template)) throw new Error('index.html sem os marcadores <!-- seo:inicio --> / <!-- seo:fim -->')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const chave = process.env.VITE_SUPABASE_ANON_KEY

// manter igual a src/lib/constants.ts (ESTAGIOS) e src/lib/seo.ts
const ESTAGIOS = {
  futuro_lancamento: 'Breve lançamento', lancamento: 'Lançamento', obras_iniciadas: 'Obras iniciadas',
  obras_aceleradas: 'Obras aceleradas', em_construcao: 'Em construção', pronto_para_morar: 'Pronto para morar', portfolio: 'Portfólio',
}
const limpa = (s) => (s ? String(s).replace(/\s+/g, ' ').trim() : null)
const local = (e) => limpa(e.bairro) ?? limpa(e.cidade) ?? 'São Paulo'
const tituloEmp = (e) => `${e.nome} — ${ESTAGIOS[e.estagio]} em ${local(e)} | ${seo.nome}`
function descricaoEmp(e) {
  const detalhes = [e.dormitorios, e.metragem].filter(Boolean).join(' · ')
  const texto = [`${e.nome}: ${ESTAGIOS[e.estagio].toLowerCase()} em ${local(e)}.`, detalhes && `${detalhes}.`, limpa(e.tagline) ?? limpa(e.descricao)]
    .filter(Boolean).join(' ')
  return texto.length > 158 ? texto.slice(0, 155).replace(/\s+\S*$/, '') + '…' : texto
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`

function html({ caminho, titulo, descricao, imagem, dados, privada = false }) {
  const url = seo.site + caminho
  const tags = [
    `<title>${esc(titulo)}</title>`,
    `<meta name="description" content="${esc(descricao)}" />`,
    `<meta name="robots" content="${privada ? 'noindex, nofollow' : 'index, follow'}" />`,
    ...(privada ? [] : [
      `<link rel="canonical" href="${url}" />`,
      `<meta property="og:title" content="${esc(titulo)}" />`,
      `<meta property="og:description" content="${esc(descricao)}" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta property="og:image" content="${imagem}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta name="twitter:title" content="${esc(titulo)}" />`,
      `<meta name="twitter:description" content="${esc(descricao)}" />`,
      `<meta name="twitter:image" content="${imagem}" />`,
    ]),
    ...(dados ? [jsonLd(dados)] : []),
  ]
  return template.replace(MARCA, `<!-- seo:inicio -->\n    ${tags.join('\n    ')}\n    <!-- seo:fim -->`)
}

function gravar(caminho, conteudo) {
  const destino = caminho === '/' ? `${DIST}/index.html` : path.join(DIST, `${caminho}.html`)
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.writeFileSync(destino, conteudo)
}

async function imagemOg(capa, destino) {
  const r = await fetch(`${supabaseUrl}/storage/v1/object/public/empreendimentos/${capa}`)
  if (!r.ok) throw new Error(`${r.status} ${capa}`)
  const jpg = await sharp(Buffer.from(await r.arrayBuffer()))
    .resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer()
  fs.writeFileSync(destino, jpg)
}

// ---------- empreendimentos publicados ----------
let emps = []
if (supabaseUrl && chave) {
  const campos = 'slug,nome,estagio,tagline,descricao,capa_url,endereco,bairro,cidade,uf,cep,latitude,longitude,dormitorios,metragem,destaque_home,ordem,updated_at'
  const r = await fetch(`${supabaseUrl}/rest/v1/empreendimentos?select=${campos}&publicado=eq.true&order=ordem,nome`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  })
  if (r.ok) emps = await r.json()
  else console.warn(`⚠ SEO: não consegui listar empreendimentos (${r.status}) — só páginas estáticas`)
} else {
  console.warn('⚠ SEO: VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY ausentes — só páginas estáticas')
}

// ---------- imagens de compartilhamento ----------
fs.mkdirSync(`${DIST}/og`, { recursive: true })
const comCapa = emps.filter((e) => e.capa_url)
const falhas = []
await Promise.all(comCapa.map((e) => imagemOg(e.capa_url, `${DIST}/og/${e.slug}.jpg`).catch((err) => falhas.push(`${e.slug}: ${err.message}`))))
const capaPadrao = (comCapa.find((e) => e.destaque_home) ?? comCapa[0])?.capa_url
if (capaPadrao) await imagemOg(capaPadrao, `${DIST}/og/padrao.jpg`).catch((err) => falhas.push(`padrao: ${err.message}`))
if (falhas.length) console.warn('⚠ SEO: imagens OG com erro:\n  ' + falhas.join('\n  '))
const og = (slug) => (fs.existsSync(`${DIST}/og/${slug}.jpg`) ? `${seo.site}/og/${slug}.jpg` : `${seo.site}/og/padrao.jpg`)

// ---------- páginas ----------
const org = seo.organizacao
const organizacao = {
  '@context': 'https://schema.org', '@type': 'Organization', name: seo.nome, url: seo.site,
  telephone: org.telefone, email: org.email,
  address: { '@type': 'PostalAddress', streetAddress: org.endereco, addressLocality: org.cidade, addressRegion: org.uf, postalCode: org.cep, addressCountry: 'BR' },
}
for (const [caminho, p] of Object.entries(seo.paginas)) {
  gravar(caminho, html({ caminho, ...p, imagem: og('padrao'), dados: caminho === '/' ? organizacao : undefined }))
}

for (const e of emps) {
  const caminho = `/empreendimentos/${e.slug}`
  const endereco = { '@type': 'PostalAddress', streetAddress: limpa(e.endereco) ?? undefined, addressLocality: e.cidade ?? 'São Paulo', addressRegion: e.uf ?? 'SP', postalCode: e.cep ?? undefined, addressCountry: 'BR' }
  gravar(caminho, html({
    caminho, titulo: tituloEmp(e), descricao: descricaoEmp(e), imagem: og(e.slug),
    dados: {
      '@context': 'https://schema.org', '@type': 'RealEstateListing',
      name: e.nome, description: descricaoEmp(e), url: seo.site + caminho, image: og(e.slug), dateModified: e.updated_at,
      about: {
        '@type': 'ApartmentComplex', name: e.nome, address: endereco,
        ...(e.latitude && e.longitude ? { geo: { '@type': 'GeoCoordinates', latitude: Number(e.latitude), longitude: Number(e.longitude) } } : {}),
      },
      provider: { '@type': 'Organization', name: seo.nome, url: seo.site },
    },
  }))
}

// fallback do SPA: rotas privadas e 404 não devem ser indexadas
fs.writeFileSync(`${DIST}/spa.html`, html({ caminho: '/', titulo: seo.nome, descricao: seo.paginas['/'].descricao, privada: true }))

// ---------- sitemap ----------
const hoje = new Date().toISOString().slice(0, 10)
const urls = [
  ...Object.keys(seo.paginas).map((c) => ({ loc: seo.site + c, lastmod: hoje, prioridade: c === '/' ? '1.0' : c.startsWith('/politica') || c.startsWith('/termos') ? '0.2' : '0.7' })),
  ...emps.map((e) => ({ loc: `${seo.site}/empreendimentos/${e.slug}`, lastmod: (e.updated_at ?? hoje).slice(0, 10), prioridade: '0.9' })),
]
fs.writeFileSync(`${DIST}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.prioridade}</priority></url>`).join('\n')}
</urlset>
`)

console.log(`✓ SEO: ${Object.keys(seo.paginas).length} páginas estáticas, ${emps.length} empreendimentos, ${fs.readdirSync(`${DIST}/og`).length} imagens OG, sitemap com ${urls.length} URLs`)

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import seo from '@/content/seo.json'

// Atualiza <head> na navegação do SPA. O HTML inicial de cada página pública já sai do build com essas
// tags (scripts/gerar-seo.mjs) — é ele que Google, WhatsApp e redes sociais leem.

type Dados = { titulo: string; descricao: string; imagem?: string; privada?: boolean }

function meta(attr: 'name' | 'property', chave: string, valor: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${chave}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, chave)
    document.head.appendChild(el)
  }
  el.content = valor
}

function aplicar(caminho: string, { titulo, descricao, imagem, privada }: Dados) {
  const url = seo.site + caminho
  document.title = titulo
  meta('name', 'description', descricao)
  meta('name', 'robots', privada ? 'noindex, nofollow' : 'index, follow')
  meta('property', 'og:title', titulo)
  meta('property', 'og:description', descricao)
  meta('property', 'og:url', url)
  meta('property', 'og:image', imagem ?? `${seo.site}/og/padrao.jpg`)
  meta('name', 'twitter:title', titulo)
  meta('name', 'twitter:description', descricao)
  meta('name', 'twitter:image', imagem ?? `${seo.site}/og/padrao.jpg`)
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!canonical) {
    canonical = document.createElement('link')
    canonical.rel = 'canonical'
    document.head.appendChild(canonical)
  }
  canonical.href = url
}

/** Padrão por rota — fica em App, antes das páginas, para que <Seo> de uma página sobrescreva depois. */
export function SeoRotas() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (/^\/empreendimentos\/[^/]+/.test(pathname)) return // a página do empreendimento define o seu
    const pagina = seo.paginas[pathname as keyof typeof seo.paginas]
    if (pagina) return aplicar(pathname, pagina)
    const privada = Object.entries(seo.privadas).find(([p]) => pathname === p || pathname.startsWith(p + '/'))
    aplicar(pathname, {
      titulo: privada?.[1] ?? `Página não encontrada — ${seo.nome}`,
      descricao: seo.paginas['/'].descricao,
      privada: true,
    })
  }, [pathname])
  return null
}

export function Seo(props: Dados) {
  const { pathname } = useLocation()
  const { titulo, descricao, imagem, privada } = props
  useEffect(() => aplicar(pathname, { titulo, descricao, imagem, privada }), [pathname, titulo, descricao, imagem, privada])
  return null
}

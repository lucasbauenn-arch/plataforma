import textos from '@/content/legal.json'

// TODO: confirmar a razão social da Arken e revisar os textos com o jurídico antes de publicar.
const RAZAO_SOCIAL = 'ARKEN INCORPORADORA LTDA'

const TITULOS = { termos: 'Termos de uso', privacidade: 'Política de privacidade', cookies: 'Política de cookies' } as const

export default function Legal({ tipo }: { tipo: keyof typeof TITULOS }) {
  const paragrafos = (textos as Record<string, string[]>)[tipo] ?? []
  return (
    <article className="container-x max-w-3xl py-16">
      <h1 className="display text-5xl">{TITULOS[tipo]}</h1>
      <div className="mt-10 space-y-4 leading-relaxed text-stone/80">
        {paragrafos.map((p, i) => {
          const t = p.replaceAll('{{RAZAO_SOCIAL}}', RAZAO_SOCIAL)
          return /^\d+(\.\d+)*\.?\s/.test(t) && t.length < 90
            ? <h2 key={i} className="pt-4 text-lg font-semibold text-stone">{t}</h2>
            : <p key={i}>{t}</p>
        })}
      </div>
    </article>
  )
}

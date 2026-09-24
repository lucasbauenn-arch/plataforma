import { Link } from 'react-router-dom'
import useEmblaCarousel from 'embla-carousel-react'
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Building, HardHat, Ruler, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEmpreendimentos } from '@/hooks/queries'
import { EmpreendimentoCard } from '@/components/EmpreendimentoCard'
import { CarrosselEmpreendimentos } from '@/components/CarrosselEmpreendimentos'
import { Imagem } from '@/components/Imagem'
import { FormLead } from '@/components/FormLead'
import { Carregando } from '@/components/Estados'
import { ESTAGIOS } from '@/lib/constants'
import type { Empreendimento } from '@/lib/types'

function Hero({ itens }: { itens: Empreendimento[] }) {
  const [ref, api] = useEmblaCarousel({ loop: true })
  const [atual, setAtual] = useState(0)
  useEffect(() => {
    if (!api) return
    const on = () => setAtual(api.selectedScrollSnap())
    api.on('select', on)
    const t = setInterval(() => api.scrollNext(), 6500)
    return () => { clearInterval(t); api.off('select', on) }
  }, [api])
  const ir = useCallback((d: 1 | -1) => (d > 0 ? api?.scrollNext() : api?.scrollPrev()), [api])

  if (!itens.length) {
    return (
      <section className="relative flex min-h-[80svh] items-end bg-ink pb-20 pt-40 text-stone">
        <div className="container-x">
          <p className="eyebrow">Arken Incorporadora</p>
          <h1 className="display mt-4 max-w-3xl text-5xl sm:text-7xl">Endereços pensados para viver bem em São Paulo.</h1>
        </div>
      </section>
    )
  }

  return (
    <section className="relative h-[92svh] min-h-[560px] overflow-hidden bg-ink text-stone">
      <div className="h-full" ref={ref}>
        <div className="flex h-full">
          {itens.map((e) => (
            <div key={e.id} className="relative h-full min-w-0 flex-[0_0_100%]">
              <Imagem src={e.capa_url} alt={e.nome} className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink/20" />
              <div className="container-x relative flex h-full flex-col justify-end pb-24">
                <p className="eyebrow !text-stone/80">{ESTAGIOS[e.estagio]}</p>
                <h1 className="display mt-3 text-6xl sm:text-8xl">{e.nome}</h1>
                {e.chamada && <p className="mt-3 text-lg opacity-85 sm:text-xl">{e.chamada}</p>}
                {e.endereco && <p className="mt-1 text-sm opacity-65">{e.endereco}</p>}
                <Link to={`/empreendimentos/${e.slug}`} className="btn mt-8 self-start bg-stone text-ink hover:bg-white">
                  Conhecer o empreendimento <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
      {itens.length > 1 && (
        <div className="container-x absolute inset-x-0 bottom-8 flex items-center justify-between">
          <div className="flex gap-2">
            {itens.map((_, i) => (
              <button key={i} onClick={() => api?.scrollTo(i)} aria-label={`Slide ${i + 1}`}
                className={`h-1 transition-all ${i === atual ? 'w-10 bg-bronze' : 'w-5 bg-stone/40'}`} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => ir(-1)} aria-label="Anterior" className="grid h-11 w-11 place-items-center border border-stone/30 hover:bg-stone/10"><ChevronLeft size={18} /></button>
            <button onClick={() => ir(1)} aria-label="Próximo" className="grid h-11 w-11 place-items-center border border-stone/30 hover:bg-stone/10"><ChevronRight size={18} /></button>
          </div>
        </div>
      )}
    </section>
  )
}

function Secao({ eyebrow, titulo, itens, link }: { eyebrow: string; titulo: string; itens: Empreendimento[]; link?: string }) {
  if (!itens.length) return null
  return (
    <section className="container-x py-20">
      <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="display mt-3 text-4xl sm:text-5xl">{titulo}</h2>
        </div>
        {link && <Link to={link} className="btn-ghost self-start sm:self-auto">Ver todos <ArrowRight size={16} /></Link>}
      </div>
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {itens.map((e) => <EmpreendimentoCard key={e.id} e={e} />)}
      </div>
    </section>
  )
}

const SERVICOS = [
  { I: Ruler, t: 'Projetos estruturais', d: 'Projetos estruturais, elétricos e hidráulicos em conformidade com as normas da construção civil.' },
  { I: HardHat, t: 'Execução de obras', d: 'Execução completa da obra, com gestão de cronograma, qualidade e segurança.' },
  { I: Building, t: 'Incorporação', d: 'Desenvolvemos e lançamos empreendimentos residenciais em regiões estratégicas de São Paulo.' },
]

export default function Home() {
  const { data = [], isLoading } = useEmpreendimentos()
  const ativos = data.filter((e) => e.estagio !== 'portfolio')
  const destaques = ativos.filter((e) => e.destaque_home).length ? ativos.filter((e) => e.destaque_home) : ativos.slice(0, 5)
  const lancamentos = ativos.filter((e) => e.estagio === 'lancamento')
  const obras = ativos.filter((e) => ['obras_iniciadas', 'obras_aceleradas', 'em_construcao'].includes(e.estagio))
  const futuros = ativos.filter((e) => e.estagio === 'futuro_lancamento')
  const prontos = ativos.filter((e) => e.estagio === 'pronto_para_morar')

  return (
    <>
      <Hero itens={destaques} />
      {isLoading && <Carregando />}

      <Secao eyebrow="Lançamentos" titulo="Nossos imóveis em lançamento" itens={lancamentos} link="/empreendimentos" />

      <section className="bg-ink-soft py-24 text-stone">
        <div className="container-x grid gap-14 lg:grid-cols-2">
          <div>
            <p className="eyebrow">Sobre a Arken</p>
            <h2 className="display mt-4 text-4xl sm:text-6xl">Da concepção do projeto à entrega das chaves.</h2>
            <p className="mt-6 max-w-lg leading-relaxed text-stone/75">
              Atuamos como construtora e incorporadora: desenvolvemos projetos complementares, executamos obras sob medida e
              colocamos no mercado empreendimentos pensados para quem quer morar perto de tudo.
            </p>
            <Link to="/quem-somos" className="btn mt-8 border border-stone/25 hover:bg-stone/10">Conheça a empresa <ArrowRight size={16} /></Link>
          </div>
          <div className="grid gap-4">
            {SERVICOS.map(({ I, t, d }) => (
              <div key={t} className="flex gap-5 border border-white/10 p-6">
                <span className="grid h-12 w-12 shrink-0 place-items-center bg-bronze/15 text-bronze"><I size={22} /></span>
                <div><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-stone/65">{d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Secao eyebrow="Em obras" titulo="Obras em andamento" itens={obras} />
      <Secao eyebrow="Pronto para morar" titulo="Mude-se agora" itens={prontos} />

      {futuros.length > 0 && (
        <section className="border-y border-line bg-sand/50 py-20">
          <div className="container-x">
            <p className="eyebrow">Breve lançamento</p>
            <h2 className="display mt-3 text-4xl sm:text-5xl">Próximos endereços Arken</h2>
            <div className="mt-10"><CarrosselEmpreendimentos itens={futuros} /></div>
          </div>
        </section>
      )}

      <section className="container-x grid gap-12 py-24 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="eyebrow">Fale com a gente</p>
          <h2 className="display mt-3 text-4xl sm:text-5xl">Encontre o imóvel certo para você.</h2>
          <p className="mt-5 max-w-md text-muted">Deixe seus dados e um consultor apresenta as condições, simulações e uso do FGTS.</p>
          <div className="mt-8 border border-line bg-ink-soft p-6 text-stone">
            <p className="font-semibold">É corretor ou imobiliária?</p>
            <p className="mt-1 text-sm text-stone/70">Acesse tabelas, materiais e envie propostas pela área do parceiro.</p>
            <Link to="/parceiros" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-bronze">Área do parceiro <ArrowRight size={15} /></Link>
          </div>
        </div>
        <div className="card p-6 sm:p-8"><FormLead /></div>
      </section>
    </>
  )
}

import { useParams, Link } from 'react-router-dom'
import { BedDouble, Car, MapPin, Navigation, Footprints, CarFront, Bus, Bike, Check, Building2, Ruler, CalendarClock } from 'lucide-react'
import { useEmpreendimento } from '@/hooks/queries'
import { Galeria } from '@/components/Galeria'
import { Imagem } from '@/components/Imagem'
import { FormLead } from '@/components/FormLead'
import { Carregando } from '@/components/Estados'
import { ESTAGIOS, EMPRESA } from '@/lib/constants'
import { youtubeId, waLink } from '@/lib/format'
import { midiaUrl } from '@/lib/midia'
import { Seo } from '@/components/Seo'
import { descricaoEmpreendimento, ogEmpreendimento, tituloEmpreendimento } from '@/lib/seo'

export default function Empreendimento() {
  const { slug } = useParams()
  const { data: e, isLoading } = useEmpreendimento(slug)

  if (isLoading) return <div className="pt-32"><Carregando /></div>
  if (!e) {
    return (
      <div className="container-x py-40 text-center">
        <Seo titulo="Empreendimento não encontrado — Arken Incorporadora" descricao="Este empreendimento não está disponível." privada />
        <h1 className="display text-5xl">Empreendimento não encontrado</h1>
        <Link to="/empreendimentos" className="btn-primary mt-8">Ver todos os imóveis</Link>
      </div>
    )
  }

  const endereco = [e.endereco, e.bairro, e.cidade && `${e.cidade} - ${e.uf ?? ''}`].filter(Boolean).join(', ')
  const mapaQuery = e.latitude && e.longitude ? `${e.latitude},${e.longitude}` : endereco
  const videos = e.videos.map(youtubeId).filter(Boolean) as string[]

  return (
    <>
      <Seo titulo={tituloEmpreendimento(e)} descricao={descricaoEmpreendimento(e)} imagem={ogEmpreendimento(e)} />
      {/* HERO */}
      <section className="relative min-h-[88svh] overflow-hidden bg-ink text-stone">
        <Imagem src={e.capa_url} alt={e.nome} className="absolute inset-0 h-full w-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-ink/30" />
        <div className="container-x relative flex min-h-[88svh] flex-col justify-end pb-16 pt-32">
          <div className="flex flex-wrap gap-2">
            <span className="bg-stone/90 px-3 py-1 text-xs font-semibold text-ink">{ESTAGIOS[e.estagio]}</span>
            {e.aceita_fgts && <span className="bg-bronze px-3 py-1 text-xs font-semibold text-ink">Use seu FGTS</span>}
          </div>
          <h1 className="display mt-4 max-w-4xl text-6xl sm:text-8xl">{e.nome}</h1>
          {(e.chamada || e.titulo_hero) && <p className="mt-4 max-w-2xl text-lg text-stone/85">{e.chamada ?? e.titulo_hero}</p>}
          <div className="mt-8 flex flex-wrap items-center gap-6 text-sm">
            {e.dormitorios && <span className="flex items-center gap-2"><BedDouble size={18} className="text-bronze" />{e.dormitorios}</span>}
            {e.vagas && <span className="flex items-center gap-2"><Car size={18} className="text-bronze" />{e.vagas}</span>}
            {e.metragem && <span className="flex items-center gap-2"><Ruler size={18} className="text-bronze" />{e.metragem}</span>}
            {e.total_unidades && <span className="flex items-center gap-2"><Building2 size={18} className="text-bronze" />{e.total_unidades} unidades</span>}
            {e.previsao_entrega && <span className="flex items-center gap-2"><CalendarClock size={18} className="text-bronze" />Entrega {new Date(e.previsao_entrega).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</span>}
            {endereco && <span className="flex items-center gap-2"><MapPin size={18} className="text-bronze" />{endereco}</span>}
          </div>
        </div>
      </section>

      {/* DESCRIÇÃO */}
      {(e.descricao || e.titulo_hero) && (
        <section className="container-x grid gap-10 py-20 lg:grid-cols-[1fr_1.4fr]">
          <div>
            {e.tagline && <p className="eyebrow">{e.tagline}</p>}
            <h2 className="display mt-3 text-4xl sm:text-5xl">{e.titulo_hero ?? `Conheça o ${e.nome}`}</h2>
          </div>
          <p className="whitespace-pre-line text-lg leading-relaxed text-stone/80">{e.descricao}</p>
        </section>
      )}

      {/* FICHA TÉCNICA */}
      {e.empreendimento_ficha.length > 0 && (
        <section className="container-x pb-20">
          <p className="eyebrow">Ficha técnica</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {e.empreendimento_ficha.map((f) => (
              <div key={f.id} className="card p-6">
                {f.icone_url && <img src={midiaUrl(f.icone_url)!} alt="" className="h-10 w-10 object-contain" loading="lazy" />}
                <p className="mt-4 font-semibold">{f.titulo}</p>
                {f.descricao && <p className="mt-1 text-sm text-muted">{f.descricao}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* LAZER */}
      {e.empreendimento_lazer.length > 0 && (
        <section className="bg-ink-soft py-20">
          <div className="container-x">
            <p className="eyebrow">Lazer</p>
            <h2 className="display mt-3 max-w-2xl text-4xl sm:text-5xl">{e.titulo_lazer ?? 'Lazer completo para viver grandes momentos todos os dias'}</h2>
            {e.descricao_lazer && <p className="mt-5 max-w-3xl text-muted">{e.descricao_lazer}</p>}
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {e.empreendimento_lazer.map((l) => (
                <div key={l.id} className="overflow-hidden border border-line bg-ink">
                  {l.imagem_url && <img src={midiaUrl(l.imagem_url)!} alt={l.titulo} loading="lazy" className="aspect-[16/10] w-full object-cover" />}
                  <div className="p-6">
                    <p className="flex items-center gap-3 font-semibold">
                      {l.icone ? <img src={midiaUrl(l.icone)!} alt="" className="h-8 w-8 object-contain" loading="lazy" /> : <Check size={16} className="text-bronze" />}
                      {l.titulo}
                    </p>
                    {l.descricao && <p className="mt-2 text-sm text-muted">{l.descricao}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* GALERIA */}
      {e.empreendimento_midias.length > 0 && (
        <section className="container-x py-20">
          <p className="eyebrow">Galeria</p>
          <h2 className="display mb-8 mt-3 text-4xl sm:text-5xl">Cada detalhe do {e.nome}</h2>
          <Galeria midias={e.empreendimento_midias} />
        </section>
      )}

      {/* TOUR VIRTUAL */}
      {e.tour_virtual_url && (
        <section className="container-x pb-20">
          <p className="eyebrow">Tour virtual 360°</p>
          <div className="mt-6 aspect-video overflow-hidden bg-ink">
            <iframe src={e.tour_virtual_url} title={`Tour virtual ${e.nome}`} className="h-full w-full" allowFullScreen loading="lazy" />
          </div>
        </section>
      )}

      {/* VÍDEOS */}
      {videos.length > 0 && (
        <section className="bg-ink-soft py-20 text-stone">
          <div className="container-x">
            <p className="eyebrow">Vídeos</p>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {videos.map((id) => (
                <div key={id} className="aspect-video overflow-hidden">
                  <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${id}`} title={e.nome} allowFullScreen loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* LOCALIZAÇÃO */}
      {endereco && (
        <section className="container-x grid gap-10 py-20 lg:grid-cols-2">
          <div>
            <p className="eyebrow">Localização</p>
            <h2 className="display mt-3 text-4xl sm:text-5xl">{e.titulo_localizacao ?? e.bairro ?? 'Localização privilegiada'}</h2>
            <p className="mt-2 flex items-center gap-2 text-sm text-muted"><MapPin size={15} />{endereco}</p>
            {e.texto_localizacao && <p className="mt-6 leading-relaxed text-stone/80">{e.texto_localizacao}</p>}
            <a className="btn-ghost mt-6" target="_blank" rel="noreferrer" href={e.waze_url ?? `https://waze.com/ul?q=${encodeURIComponent(mapaQuery)}&navigate=yes`}>
              <Navigation size={16} /> Abrir no Waze
            </a>
            {e.empreendimento_proximidades.length > 0 && (
              <div className="mt-10 overflow-hidden border border-line bg-ink-soft">
                <table className="w-full text-sm">
                  <thead className="bg-sand/60 text-left text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-4 py-3">Próximo a</th><th className="px-2 py-3">Dist.</th>
                      <th className="px-2 py-3"><Footprints size={15} aria-label="A pé" /></th>
                      <th className="px-2 py-3"><CarFront size={15} aria-label="Carro" /></th>
                      <th className="px-2 py-3"><Bus size={15} aria-label="Transporte" /></th>
                      <th className="px-2 py-3"><Bike size={15} aria-label="Bicicleta" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.empreendimento_proximidades.map((p) => (
                      <tr key={p.id} className="border-t border-line">
                        <td className="px-4 py-3 font-medium">{p.nome}</td><td className="px-2 py-3">{p.distancia}</td>
                        <td className="px-2 py-3">{p.tempo_pe}</td><td className="px-2 py-3">{p.tempo_carro}</td><td className="px-2 py-3">{p.tempo_transporte}</td><td className="px-2 py-3">{p.tempo_bike}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="min-h-[380px] overflow-hidden bg-sand">
            <iframe title="Mapa" className="h-full min-h-[380px] w-full" loading="lazy"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(mapaQuery)}&z=15&output=embed`} />
          </div>
        </section>
      )}

      {/* CONTATO */}
      <section className="bg-ink-soft py-20 text-stone">
        <div className="container-x grid gap-12 lg:grid-cols-2">
          <div>
            <p className="eyebrow">Interessou?</p>
            <h2 className="display mt-3 text-4xl sm:text-5xl">Receba a tabela e as condições do {e.nome}.</h2>
            <a className="btn mt-8 bg-[#25D366] text-white" target="_blank" rel="noreferrer"
              href={waLink(EMPRESA.whatsapp, `Olá! Tenho interesse no ${e.nome}.`)}>Falar no WhatsApp</a>
          </div>
          <FormLead empreendimentoId={e.id} escuro />
        </div>
      </section>
    </>
  )
}

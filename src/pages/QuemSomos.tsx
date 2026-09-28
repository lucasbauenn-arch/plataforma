import { Link } from 'react-router-dom'
import { ShieldCheck, Sparkles, Users } from 'lucide-react'

const VALORES = [
  { I: ShieldCheck, t: 'Qualidade e segurança', d: 'Processos construtivos rigorosos e conformidade com as normas técnicas em todas as etapas.' },
  { I: Sparkles, t: 'Inovação', d: 'Plantas inteligentes, áreas comuns completas e soluções que tornam o dia a dia mais leve.' },
  { I: Users, t: 'Atendimento personalizado', d: 'Cada cliente e cada obra recebem atenção sob medida, do projeto à entrega.' },
]

export default function QuemSomos() {
  return (
    <>
      <section className="container-x grid gap-12 py-20 lg:grid-cols-2">
        <div>
          <p className="eyebrow">Quem somos</p>
          <h1 className="display mt-3 text-5xl sm:text-7xl">Transformamos ideias em endereços.</h1>
        </div>
        <div className="space-y-5 text-lg leading-relaxed text-stone/80">
          <p>A Arken Incorporadora nasce com o propósito de transformar oportunidades em empreendimentos que geram valor e contribuem para o desenvolvimento das cidades.</p>
          <p>Atuamos em todas as etapas do desenvolvimento imobiliário, desde a identificação e aquisição de terrenos, estudos de viabilidade e concepção dos projetos até a incorporação, construção, comercialização e entrega dos empreendimentos.</p>
          <p>Desenvolvemos projetos residenciais em regiões estratégicas de São Paulo, combinando planejamento, qualidade construtiva, eficiência e soluções pensadas para as necessidades de cada público.</p>
          <p>Na Arken, cada empreendimento é desenvolvido com uma visão completa: do terreno à entrega das chaves, transformando projetos em novos espaços para viver, investir e construir histórias.</p>
        </div>
      </section>
      <section className="bg-ink-soft py-20">
        <div className="container-x grid gap-6 md:grid-cols-3">
          {VALORES.map(({ I, t, d }) => (
            <div key={t} className="border border-line p-8">
              <I className="text-bronze" size={28} />
              <p className="mt-5 text-lg font-semibold">{t}</p>
              <p className="mt-2 text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="container-x py-20 text-center">
        <h2 className="display text-4xl sm:text-5xl">Conheça nossos empreendimentos</h2>
        <Link to="/empreendimentos" className="btn-primary mt-8">Ver imóveis</Link>
      </section>
    </>
  )
}

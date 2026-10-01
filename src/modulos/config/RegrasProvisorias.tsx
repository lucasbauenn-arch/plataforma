import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Flag, Lock } from 'lucide-react'
import { REGRAS_DECIDIDAS, REGRAS_PROVISORIAS } from '@/lib/provisorias'
import { CampoBusca } from '@/components/app/Filtros'

/**
 * Painel "Regras provisórias" (docs/ARQUITETURA_EXPANSAO.md §1.1 e §1.2): cada decisão adotada sem confirmação do
 * negócio, onde se configura e o que fica bloqueado até decidir. Gerado de src/lib/provisorias.ts.
 */
export default function RegrasProvisorias() {
  const [busca, setBusca] = useState('')
  const regras = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return REGRAS_PROVISORIAS
    return REGRAS_PROVISORIAS.filter((r) =>
      [r.codigo, r.titulo, r.regra, r.ondeConfigura ?? '', r.sinalizacao].some((v) => v.toLowerCase().includes(t)))
  }, [busca])
  const bloqueios = REGRAS_PROVISORIAS.filter((r) => r.bloqueia).length

  return (
    <section aria-labelledby="regras-titulo">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="regras-titulo" className="flex items-center gap-2 text-lg font-semibold"><Flag size={18} className="text-bronze" aria-hidden /> Regras provisórias</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {REGRAS_PROVISORIAS.length} decisões adotadas enquanto o negócio não confirma. {bloqueios} delas bloqueiam uma função até a decisão.
          </p>
        </div>
        <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar por código ou assunto…" rotulo="Buscar regra" atraso={150} />
      </div>

      {regras.length === 0 ? <p className="text-sm text-muted">Nenhuma regra encontrada.</p> : (
        <ul className="grid gap-3">
          {regras.map((r) => (
            <li key={r.codigo} className="card grid gap-3 p-5 md:grid-cols-[7rem_1fr_auto] md:items-start">
              <span className="inline-flex w-fit items-center border border-bronze/40 px-2 py-0.5 text-xs font-semibold text-bronze">{r.codigo}</span>
              <div className="min-w-0">
                <p className="font-semibold">{r.titulo}</p>
                <p className="mt-1 text-sm text-stone/85">{r.regra}</p>
                <p className="mt-2 text-xs text-muted">
                  {r.sinalizacao}{r.ondeConfigura ? ` · configura em ${r.ondeConfigura}` : ' · não configurável'}
                </p>
                {r.bloqueia && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-bronze"><Lock size={12} aria-hidden /> Bloqueia: {r.bloqueia}</p>
                )}
              </div>
              {r.rota && (
                <Link to={r.rota} className="inline-flex items-center gap-1 text-sm font-semibold text-bronze" aria-label={`Configurar ${r.titulo}`}>
                  Configurar <ArrowRight size={14} aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {REGRAS_DECIDIDAS.length > 0 && (
        <section aria-labelledby="regras-decididas" className="mt-10">
          <h3 id="regras-decididas" className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 size={18} className="text-sage" aria-hidden /> Decididas pelo dono</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">Deixaram de ser provisórias. Os valores continuam configuráveis onde indicado.</p>
          <ul className="mt-4 grid gap-3">
            {REGRAS_DECIDIDAS.map((r) => (
              <li key={r.codigo} className="card grid gap-3 p-5 md:grid-cols-[7rem_1fr_auto] md:items-start">
                <span className="inline-flex w-fit items-center border border-sage/40 px-2 py-0.5 text-xs font-semibold text-sage">{r.codigo}</span>
                <div className="min-w-0">
                  <p className="font-semibold">{r.titulo}</p>
                  <p className="mt-1 text-sm text-stone/85">{r.regra}</p>
                  <p className="mt-2 text-xs text-muted">{r.sinalizacao}{r.ondeConfigura ? ` · configura em ${r.ondeConfigura}` : ''}</p>
                </div>
                {r.rota && (
                  <Link to={r.rota} className="inline-flex items-center gap-1 text-sm font-semibold text-bronze" aria-label={`Configurar ${r.titulo}`}>
                    Configurar <ArrowRight size={14} aria-hidden />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}

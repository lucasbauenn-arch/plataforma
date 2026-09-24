import { useState } from 'react'
import { X, Download, MapPin } from 'lucide-react'
import { useEmpreendimentos, useUnidades, useMaterial } from '@/hooks/queries'
import { Imagem } from '@/components/Imagem'
import { Carregando, Vazio } from '@/components/Estados'
import { ESTAGIOS, STATUS_UNIDADE } from '@/lib/constants'
import { brl } from '@/lib/format'
import type { Empreendimento } from '@/lib/types'

function Modal({ e, fechar }: { e: Empreendimento; fechar: () => void }) {
  const { data: unidades = [], isLoading } = useUnidades(e.id)
  const { data: material } = useMaterial(e.id)
  const [status, setStatus] = useState<'todas' | 'disponivel'>('disponivel')
  const lista = status === 'todas' ? unidades : unidades.filter((u) => u.status === 'disponivel')

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/60 p-0 sm:items-center sm:p-6" onClick={fechar}>
      <div className="flex max-h-[92svh] w-full max-w-3xl flex-col overflow-hidden bg-ink" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-line p-6">
          <div>
            <p className="eyebrow">{ESTAGIOS[e.estagio]}</p>
            <h2 className="display mt-1 text-3xl">{e.nome}</h2>
            {e.endereco && <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><MapPin size={14} />{e.endereco}</p>}
          </div>
          <button onClick={fechar} aria-label="Fechar"><X /></button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
          <div className="flex gap-1 bg-ink-soft p-1 text-sm">
            {(['disponivel', 'todas'] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={`px-4 py-1.5 font-semibold ${status === s ? 'bg-stone text-ink' : ''}`}>
                {s === 'todas' ? 'Todas' : 'Disponíveis'}
              </button>
            ))}
          </div>
          {material?.drive_url && (
            <a href={material.drive_url} target="_blank" rel="noreferrer" className="btn-accent !py-2"><Download size={16} /> Baixar materiais</a>
          )}
        </div>
        <div className="overflow-y-auto p-6">
          {isLoading ? <Carregando /> : lista.length === 0 ? <Vazio titulo="Nenhuma unidade cadastrada" texto="A tabela deste empreendimento ainda não foi publicada." /> : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink text-left text-xs uppercase tracking-wider text-muted">
                <tr><th className="py-2">Unidade</th><th>Metragem</th><th>Valor</th><th>Status</th></tr>
              </thead>
              <tbody>
                {lista.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="py-2.5 font-medium">{u.identificador}</td>
                    <td>{u.metragem ? `${u.metragem.toLocaleString('pt-BR')} m²` : '—'}</td>
                    <td className="font-semibold">{brl(u.valor)}</td>
                    <td>
                      <span className={`px-2.5 py-0.5 text-xs font-semibold ${
                        u.status === 'disponivel' ? 'bg-sage/15 text-sage' : u.status === 'reservada' ? 'bg-bronze/15 text-bronze' : 'bg-white/5 text-muted'}`}>
                        {STATUS_UNIDADE[u.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

export default function EmpreendimentosParceiro() {
  const { data = [], isLoading } = useEmpreendimentos()
  const [aberto, setAberto] = useState<Empreendimento | null>(null)
  const ativos = data.filter((e) => !['portfolio', 'futuro_lancamento'].includes(e.estagio))
  if (isLoading) return <Carregando />
  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {ativos.map((e) => (
          <button key={e.id} onClick={() => setAberto(e)} className="card overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-lg">
            <Imagem src={e.capa_url} alt={e.nome} className="aspect-[16/10] w-full object-cover" />
            <div className="p-5">
              <p className="display text-2xl">{e.nome}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">Endereço</dt><dd className="truncate">{e.endereco ?? '—'}</dd>
                <dt className="text-muted">Estágio</dt><dd>{ESTAGIOS[e.estagio]}</dd>
                <dt className="text-muted">Categoria</dt><dd>{e.categoria ?? '—'}</dd>
                <dt className="text-muted">Unidades</dt><dd>{e.total_unidades ?? '—'}</dd>
              </dl>
              <p className="mt-4 text-sm font-semibold text-bronze">Ver tabela e materiais →</p>
            </div>
          </button>
        ))}
      </div>
      {aberto && <Modal e={aberto} fechar={() => setAberto(null)} />}
    </>
  )
}

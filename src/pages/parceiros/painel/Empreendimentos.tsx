import { useState } from 'react'
import { Download, MapPin } from 'lucide-react'
import { useEmpreendimentos, useUnidades, useMaterial } from '@/hooks/queries'
import { Imagem } from '@/components/Imagem'
import { Carregando, Vazio } from '@/components/Estados'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ErroConsulta } from '@/components/app/Consulta'
import { Modal } from '@/components/app/Modal'
import { ESTAGIOS, STATUS_UNIDADE } from '@/lib/constants'
import { brl } from '@/lib/format'
import type { Empreendimento } from '@/lib/types'

/** Conteúdo da janela: tabela de unidades e materiais. Cada consulta mostra o próprio erro (nunca "nenhuma unidade" por falha). */
function DetalheEmpreendimento({ e }: { e: Empreendimento }) {
  const unidades = useUnidades(e.id)
  const material = useMaterial(e.id)
  const [status, setStatus] = useState<'todas' | 'disponivel'>('disponivel')
  const lista = status === 'todas' ? unidades.data ?? [] : (unidades.data ?? []).filter((u) => u.status === 'disponivel')

  return (
    <div className="grid gap-5">
      <div>
        <p className="eyebrow">{ESTAGIOS[e.estagio]}</p>
        {e.endereco && <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><MapPin size={14} aria-hidden />{e.endereco}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-ink-soft p-1 text-sm" role="group" aria-label="Filtrar unidades">
          {(['disponivel', 'todas'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={`px-4 py-1.5 font-semibold ${status === s ? 'bg-stone text-ink' : ''}`}>
              {s === 'todas' ? 'Todas' : 'Disponíveis'}
            </button>
          ))}
        </div>
        {material.data?.drive_url && (
          <a href={material.data.drive_url} target="_blank" rel="noreferrer" className="btn-accent !py-2"><Download size={16} aria-hidden /> Baixar materiais</a>
        )}
      </div>
      {material.error && <ErroConsulta erro={material.error} tentarDeNovo={material.refetch} />}
      {unidades.isPending ? <Carregando /> : unidades.error ? <ErroConsulta erro={unidades.error} tentarDeNovo={unidades.refetch} /> : lista.length === 0 ? (
        <Vazio titulo="Nenhuma unidade cadastrada" texto="A tabela deste empreendimento ainda não foi publicada." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted">
              <tr><th scope="col" className="py-2">Unidade</th><th scope="col">Metragem</th><th scope="col">Valor</th><th scope="col">Status</th></tr>
            </thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="py-2.5 font-medium">{u.identificador}</td>
                  <td>{u.metragem ? `${u.metragem.toLocaleString('pt-BR')} m²` : '—'}</td>
                  <td className="font-semibold">{brl(u.valor)}</td>
                  <td>
                    <span className={`px-2.5 py-0.5 text-xs font-semibold ${
                      u.status === 'disponivel' ? 'bg-sage/15 text-sage' : u.status === 'reservada' ? 'bg-bronze/15 text-bronze' : 'bg-sand text-muted'}`}>
                      {STATUS_UNIDADE[u.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function EmpreendimentosParceiro() {
  const q = useEmpreendimentos()
  const [aberto, setAberto] = useState<Empreendimento | null>(null)
  const ativos = (q.data ?? []).filter((e) => !['portfolio', 'futuro_lancamento'].includes(e.estagio))
  return (
    <>
      <CabecalhoPagina titulo="Empreendimentos" subtitulo="Escolha um empreendimento para ver a tabela de unidades e baixar os materiais." />
      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : ativos.length === 0 ? (
        <Vazio titulo="Nenhum empreendimento disponível no momento" texto="Assim que houver um empreendimento em vendas, ele aparece aqui com a tabela e os materiais." />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ativos.map((e) => (
            <button key={e.id} type="button" onClick={() => setAberto(e)} className="card overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-lg">
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
      )}
      {/* <dialog> do kit: role, Esc, foco preso e título ligado ao diálogo */}
      <Modal aberto={!!aberto} titulo={aberto?.nome ?? ''} aoFechar={() => setAberto(null)} largura="lg">
        {aberto && <DetalheEmpreendimento e={aberto} />}
      </Modal>
    </>
  )
}

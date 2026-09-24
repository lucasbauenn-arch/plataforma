import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileText, LogOut, HardHat, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Imagem } from '@/components/Imagem'
import { Carregando, Vazio } from '@/components/Estados'
import { midiaUrl } from '@/lib/midia'
import { brl, data } from '@/lib/format'
import type { Cliente, ClienteArquivo, ClienteNegocio, ObraAtualizacao } from '@/lib/types'

function Andamento({ empreendimentoId }: { empreendimentoId: string }) {
  const { data: obras = [] } = useQuery({
    queryKey: ['obra', empreendimentoId],
    queryFn: async () => (await supabase.from('obra_atualizacoes').select('*').eq('empreendimento_id', empreendimentoId).order('data', { ascending: false })).data as ObraAtualizacao[],
  })
  if (!obras.length) return <p className="text-sm text-muted">As atualizações da obra aparecerão aqui.</p>
  const pct = obras.find((o) => o.percentual != null)?.percentual ?? null
  return (
    <div className="grid gap-5">
      {pct != null && (
        <div>
          <div className="flex justify-between text-sm"><span className="font-semibold">Andamento geral</span><span>{pct}%</span></div>
          <div className="mt-2 h-2.5 overflow-hidden bg-sand"><div className="h-full bg-bronze" style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      <ol className="grid gap-4 border-l border-line pl-5">
        {obras.map((o) => (
          <li key={o.id} className="relative">
            <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 bg-bronze" />
            <p className="text-xs text-muted">{data(o.data)}</p>
            <p className="font-semibold">{o.titulo}</p>
            {o.descricao && <p className="text-sm text-stone/80">{o.descricao}</p>}
            {o.fotos.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {o.fotos.map((f) => (
                  <a key={f} href={midiaUrl(f)!} target="_blank" rel="noreferrer"><img src={midiaUrl(f)!} alt="" loading="lazy" className="aspect-square w-full object-cover" /></a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function PortalCliente() {
  const { sair } = useAuth()
  const { data: d, isLoading } = useQuery({
    queryKey: ['portal'],
    queryFn: async () => {
      const cliente = (await supabase.from('clientes').select('*').maybeSingle()).data as Cliente | null
      if (!cliente) return null
      const [neg, arq] = await Promise.all([
        supabase.from('cliente_negocios').select('*, empreendimentos(nome, slug, capa_url), unidades(identificador, metragem)').eq('cliente_id', cliente.id).order('created_at'),
        supabase.from('cliente_arquivos').select('*').eq('cliente_id', cliente.id).order('created_at', { ascending: false }),
      ])
      return { cliente, negocios: (neg.data ?? []) as ClienteNegocio[], arquivos: (arq.data ?? []) as ClienteArquivo[] }
    },
  })

  async function baixar(a: ClienteArquivo) {
    const { data: s } = await supabase.storage.from('cliente-arquivos').createSignedUrl(a.storage_path, 60)
    if (s?.signedUrl) window.open(s.signedUrl, '_blank')
  }

  if (isLoading) return <div className="pt-10"><Carregando /></div>
  if (!d) return <div className="container-x py-20"><Vazio titulo="Cadastro não encontrado" texto="Fale com nosso atendimento para vincular seus imóveis." /></div>

  return (
    <section className="container-x py-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Portal do cliente</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Bem-vindo(a), {d.cliente.nome.split(' ')[0]}</h1>
        </div>
        <button onClick={sair} className="btn-ghost self-start"><LogOut size={16} /> Sair</button>
      </div>

      <div className="mt-10 grid gap-8">
        {d.negocios.length === 0 && <Vazio titulo="Nenhum imóvel vinculado ainda" />}
        {d.negocios.map((n) => (
          <article key={n.id} className="card overflow-hidden lg:grid lg:grid-cols-[360px_1fr]">
            <Imagem src={n.empreendimentos?.capa_url} alt={n.empreendimentos?.nome ?? ''} className="aspect-[16/10] h-full w-full object-cover" />
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="display text-3xl">{n.empreendimentos?.nome ?? n.descricao}</h2>
                  <p className="text-sm text-muted">
                    {[n.unidades?.identificador, n.unidades?.metragem && `${n.unidades.metragem} m²`, n.valor && brl(n.valor)].filter(Boolean).join(' · ') || n.descricao}
                  </p>
                </div>
                {n.empreendimentos?.slug && <Link to={`/empreendimentos/${n.empreendimentos.slug}`} className="text-sm font-semibold text-bronze">Ver empreendimento →</Link>}
              </div>
              <h3 className="mt-6 mb-4 flex items-center gap-2 font-semibold"><HardHat size={18} className="text-bronze" /> Andamento da obra</h3>
              {n.empreendimento_id ? <Andamento empreendimentoId={n.empreendimento_id} /> : <p className="text-sm text-muted">—</p>}
            </div>
          </article>
        ))}

        <div className="card p-6 sm:p-8">
          <h2 className="flex items-center gap-2 font-semibold"><FileText size={18} className="text-bronze" /> Meus documentos</h2>
          {d.arquivos.length === 0 ? <p className="mt-3 text-sm text-muted">Nenhum documento disponível.</p> : (
            <ul className="mt-4 divide-y divide-line">
              {d.arquivos.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3 text-sm">
                  <span>{a.nome}<span className="ml-2 text-xs text-muted">{data(a.created_at)}</span></span>
                  <button onClick={() => baixar(a)} className="flex items-center gap-1.5 font-semibold text-bronze"><Download size={15} /> Baixar</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

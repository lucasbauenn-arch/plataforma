import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Titulo } from './ui'

async function contar(tabela: string, filtros: Record<string, string> = {}) {
  let q = supabase.from(tabela).select('*', { count: 'exact', head: true })
  for (const [coluna, valor] of Object.entries(filtros)) q = q.eq(coluna, valor)
  return (await q).count ?? 0
}

export default function Dashboard() {
  const { data } = useQuery({
    queryKey: ['admin-dash'],
    queryFn: async () => ({
      emp: await contar('empreendimentos'),
      // todo profile nasce 'pendente' (inclusive clientes do portal) — filtrar pelo papel
      parcPend: await contar('profiles', { papel: 'parceiro', status_parceiro: 'pendente' }),
      propNovas: await contar('propostas', { status: 'enviada' }),
      leads: await contar('leads'),
      clientes: await contar('clientes'),
      pcs: await contar('parceiro_clientes'),
    }),
  })
  const cards = [
    { l: 'Empreendimentos', v: data?.emp, to: '/admin/empreendimentos' },
    { l: 'Parceiros aguardando aprovação', v: data?.parcPend, to: '/admin/parceiros', destaque: !!data?.parcPend },
    { l: 'Propostas novas', v: data?.propNovas, to: '/admin/propostas', destaque: !!data?.propNovas },
    { l: 'Leads do site', v: data?.leads, to: '/admin/leads' },
    { l: 'Clientes no portal', v: data?.clientes, to: '/admin/clientes' },
    { l: 'Clientes cadastrados por parceiros', v: data?.pcs, to: '/admin/parceiros' },
  ]
  return (
    <>
      <Titulo>Visão geral</Titulo>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.l} to={c.to} className={`card p-6 transition hover:shadow-md ${c.destaque ? 'border-bronze' : ''}`}>
            <p className="text-sm text-muted">{c.l}</p>
            <p className="display mt-2 text-5xl">{c.v ?? '—'}</p>
          </Link>
        ))}
      </div>
    </>
  )
}

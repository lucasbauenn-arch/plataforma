import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { List, Plus } from 'lucide-react'
import { useEscopo } from '@/lib/escopo'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { useBase } from '@/components/app/useBase'
import { FiltrosKanban, type MudancaFiltros } from '../kanban/FiltrosKanban'
import { Kanban } from '../kanban/Kanban'
import type { KanbanFiltros } from '../tipos'

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/
const uuidOuNulo = (v: string | null) => (v && RE_UUID.test(v) ? v : null)
const dataOuNula = (v: string | null) => (v && RE_DATA.test(v) ? v : null)

/** Filtros na URL (voltar da ficha mantém o kanban como estava). Valor inválido é ignorado, nunca enviado. */
function filtrosDaUrl(p: URLSearchParams): KanbanFiltros {
  const f: KanbanFiltros = {}
  const busca = (p.get('busca') ?? '').trim().slice(0, 100)
  if (busca) f.busca = busca
  const corretor = uuidOuNulo(p.get('corretor_id'))
  if (corretor) f.corretor_id = corretor
  const gerente = uuidOuNulo(p.get('gerente_id'))
  if (gerente) f.gerente_id = gerente
  const imob = uuidOuNulo(p.get('imobiliaria_id'))
  if (imob) f.imobiliaria_id = imob
  if (p.get('so_meus') === '1') f.so_meus = true
  const de = dataOuNula(p.get('periodo_de'))
  const ate = dataOuNula(p.get('periodo_ate'))
  if (de) f.periodo_de = de
  if (ate && (!de || ate >= de)) f.periodo_ate = ate
  return f
}

/**
 * [WP3] Funil do CRM (§7.3): kanban com filtros, contadores e arraste validado por `status_transicoes`. Mesma tela em
 * /parceiros/painel/crm e /admin/crm; o escopo é sempre do servidor (`crm_kanban`, auditada).
 */
export default function Funil() {
  const base = useBase()
  const { tem } = useEscopo()
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => filtrosDaUrl(params), [params])

  function mudar(m: MudancaFiltros) {
    setParams((atual) => {
      const p = new URLSearchParams(atual)
      for (const [k, v] of Object.entries(m)) {
        if (v === null || v === '' || v === false || v === undefined) p.delete(k)
        else p.set(k, v === true ? '1' : String(v))
      }
      // gerente e responsável dependem da imobiliária escolhida
      if ('imobiliaria_id' in m) { p.delete('gerente_id'); p.delete('corretor_id') }
      if ('gerente_id' in m) p.delete('corretor_id')
      return p
    }, { replace: true })
  }

  return (
    <section>
      <CabecalhoPagina
        titulo="Funil"
        subtitulo="Arraste o cartão para mudar a etapa, ou use “Mover para…”. Finalizado acontece sozinho quando o contrato é assinado."
        acoes={
          <>
            <SeloProvisorio codigo="F1" />
            <SeloProvisorio codigo="F2" />
            <Link to={`${base}/crm/lista`} className="btn-ghost"><List size={16} aria-hidden /> Lista</Link>
            {tem('crm.cadastrar') && <Link to={`${base}/crm/novo`} className="btn-primary"><Plus size={16} aria-hidden /> Novo cliente</Link>}
          </>
        }
      />
      <FiltrosKanban filtros={filtros} aoMudar={mudar} />
      <Kanban filtros={filtros} />
    </section>
  )
}

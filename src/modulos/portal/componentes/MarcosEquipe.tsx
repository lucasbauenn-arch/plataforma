import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarCheck } from 'lucide-react'
import { crmPortalMarcoSalvar, crmPortalMarcos } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { dataHora } from '@/lib/format'
import { hojeIso } from '@/lib/datas'
import { CampoData } from '@/components/app/CampoData'
import { Consulta } from '@/components/app/Consulta'
import { chavesPortal, dataCalendario, ROTULOS_MARCO } from '../rotulos'
import type { MarcoEquipe, PortalNegocioLinha } from '../tipos'


/**
 * Marcos da compra (equipe, crm_portal_marcos / crm_portal_marco_salvar): para cada negócio exibido no portal, as datas
 * previstas e realizadas de Contrato assinado, Obra, Vistoria e Entrega das chaves, e uma observação que o cliente vê.
 * Tudo vazio apaga o marco. "Contrato assinado" sem data realizada usa a assinatura do contrato do negócio.
 */
export function MarcosEquipe({ clienteId }: { clienteId: string }) {
  const q = useQuery({ queryKey: chavesPortal.marcosEquipe(clienteId), queryFn: () => crmPortalMarcos({ p_cliente_id: clienteId }) })
  return (
    <section className="card p-6" aria-labelledby="marcos-equipe">
      <h3 id="marcos-equipe" className="mb-1 flex items-center gap-2 text-lg font-semibold"><CalendarCheck size={18} className="text-bronze" aria-hidden /> Linha do tempo da compra</h3>
      <p className="mb-4 text-sm text-muted">Datas que o cliente vê no portal, por negócio. A data realizada não pode estar no futuro.</p>
      <Consulta consulta={q} tituloVazio="Nenhum negócio" textoVazio="Adicione um negócio abaixo para registrar os marcos.">
        {(linhas) => linhas && (
          <div className="grid gap-6">
            {linhas.map((l) => <NegocioMarcos key={l.negocio_id} clienteId={clienteId} linha={l} />)}
          </div>
        )}
      </Consulta>
    </section>
  )
}

function NegocioMarcos({ clienteId, linha }: { clienteId: string; linha: PortalNegocioLinha<MarcoEquipe> }) {
  return (
    <div>
      <p className="mb-2 font-semibold">{linha.titulo}{linha.obra_percentual != null && <span className="ml-2 text-xs font-normal text-muted">obra em {linha.obra_percentual}%</span>}</p>
      <ul className="grid gap-2">
        {linha.marcos.map((m) => <LinhaMarco key={`${m.tipo}-${m.atualizado_em ?? ''}`} clienteId={clienteId} negocioId={linha.negocio_id} m={m} />)}
      </ul>
    </div>
  )
}

function LinhaMarco({ clienteId, negocioId, m }: { clienteId: string; negocioId: string; m: MarcoEquipe }) {
  const qc = useQueryClient()
  const [prevista, setPrevista] = useState(m.data_prevista ?? '')
  const [realizada, setRealizada] = useState(m.data_realizada_registrada ?? '')
  const [obs, setObs] = useState(m.observacao ?? '')
  const [salvando, setSalvando] = useState(false)
  const mudou = prevista !== (m.data_prevista ?? '') || realizada !== (m.data_realizada_registrada ?? '') || obs.trim() !== (m.observacao ?? '')
  const rotulo = ROTULOS_MARCO[m.tipo]

  async function salvar() {
    setSalvando(true)
    try {
      await crmPortalMarcoSalvar({
        p_negocio_id: negocioId, p_tipo: m.tipo, p_data_prevista: prevista || null, p_data_realizada: realizada || null,
        p_observacao: obs.trim() || null,
      })
      toast.success(`${rotulo}: datas salvas.`)
      await qc.invalidateQueries({ queryKey: chavesPortal.marcosEquipe(clienteId) })
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <li className="grid gap-3 bg-sand/40 p-3 md:grid-cols-[10rem_11rem_11rem_1fr_auto] md:items-end">
      <div>
        <p className="text-sm font-semibold">{rotulo}</p>
        {m.origem === 'contrato' && !realizada && (
          <p className="text-xs text-muted">Assinado em {dataCalendario(m.data_realizada)} (do contrato)</p>
        )}
        {m.atualizado_por && <p className="text-xs text-muted">{m.atualizado_por.nome} · {m.atualizado_em ? dataHora(m.atualizado_em) : ''}</p>}
      </div>
      <div className="block text-xs">
        <span className="label" aria-hidden>Prevista</span>
        <CampoData valor={prevista} aoMudar={setPrevista} rotulo={`${rotulo}: data prevista`} />
      </div>
      <div className="block text-xs">
        <span className="label" aria-hidden>Realizada</span>
        <CampoData valor={realizada} aoMudar={setRealizada} max={hojeIso()} rotulo={`${rotulo}: data realizada`} />
      </div>
      <label className="block text-xs">
        <span className="label">Observação para o cliente</span>
        <input className="input" value={obs} maxLength={500} onChange={(e) => setObs(e.target.value)} aria-label={`${rotulo}: observação`} />
      </label>
      <button type="button" className="btn-primary py-2" disabled={!mudou || salvando} onClick={() => void salvar()}>
        {salvando ? 'Salvando…' : 'Salvar'}
      </button>
    </li>
  )
}

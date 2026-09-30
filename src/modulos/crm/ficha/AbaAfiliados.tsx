import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRightLeft } from 'lucide-react'
import { redeTransferirClientes } from '@/lib/rpc'
import { useEscopo } from '@/lib/escopo'
import { dataHora } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { Modal } from '@/components/app/Modal'
import { SeletorParceiro } from '@/components/app/SeletorParceiro'
import { Etiqueta } from '@/components/app/Etiqueta'
import { mensagemErro } from '@/lib/erros'
import { chavesCrm } from '../api-clientes'
import type { CadeiaCliente, PropsAbaFicha } from '../tipos'

/**
 * Aba Afiliados [WP2]: cadeia do cliente só nos níveis iguais ou abaixo de quem consulta (PAR-3: o servidor manda
 * nulo para os níveis acima), histórico de vínculos com vigência e o botão Transferir (rede_transferir_clientes, com
 * motivo; cliente com contrato em assinatura fica congelado; entre imobiliárias, só o Super).
 */
export default function AbaAfiliados({ clienteId, ficha, recarregarFicha }: PropsAbaFicha) {
  const [transferir, setTransferir] = useState(false)
  return (
    <div className="grid gap-6">
      <section className="card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Cadeia atual</h3>
          {ficha.permissoes.transferir && (
            <button type="button" className="btn-primary" onClick={() => setTransferir(true)}>
              <ArrowRightLeft size={16} aria-hidden /> Transferir cliente
            </button>
          )}
        </div>
        <Cadeia cadeia={ficha.cadeia} />
      </section>
      <section className="card p-6">
        <h3 className="mb-4 text-lg font-semibold">Histórico de vínculos</h3>
        {ficha.historico_vinculos.length === 0 ? <p className="text-sm text-muted">Sem histórico.</p> : (
          <ol className="grid gap-4">
            {ficha.historico_vinculos.map((h, i) => (
              <li key={`${h.vigente_de}-${i}`} className="border-l-2 border-line pl-4">
                <p className="text-xs text-muted">
                  {dataHora(h.vigente_de)} — {h.vigente_ate ? dataHora(h.vigente_ate) : 'atual'}
                  {!h.vigente_ate && <span className="ml-2"><Etiqueta tom="ok">Vigente</Etiqueta></span>}
                </p>
                <div className="mt-2"><Cadeia cadeia={h} compacta /></div>
                {h.motivo && <p className="mt-2 text-sm text-stone/80">Motivo: {h.motivo}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
      {transferir && (
        <Transferir clienteId={clienteId} corretorAtual={ficha.cadeia.corretor?.id ?? null}
          aoFechar={() => setTransferir(false)} aoTransferir={recarregarFicha} />
      )}
    </div>
  )
}

function Cadeia({ cadeia, compacta }: { cadeia: CadeiaCliente; compacta?: boolean }) {
  const niveis = [
    { rotulo: 'Imobiliária', valor: cadeia.imobiliaria ? `${cadeia.imobiliaria.nome}${cadeia.imobiliaria.da_casa ? ' (Arken)' : ''}` : null },
    { rotulo: 'Gerente', valor: cadeia.gerente?.nome ?? null },
    { rotulo: 'Corretor responsável', valor: cadeia.corretor?.nome ?? null },
  ].filter((n) => n.valor)
  if (niveis.length === 0) return <p className="text-sm text-muted">Sem dados visíveis para o seu nível.</p>
  return (
    <dl className={compacta ? 'flex flex-wrap gap-x-6 gap-y-1 text-sm' : 'grid gap-4 sm:grid-cols-3'}>
      {niveis.map((n) => (
        <div key={n.rotulo}>
          <dt className="text-xs tracking-wide text-muted uppercase">{n.rotulo}</dt>
          <dd className={compacta ? '' : 'mt-0.5 font-semibold'}>{n.valor}</dd>
        </div>
      ))}
    </dl>
  )
}

function Transferir({ clienteId, corretorAtual, aoFechar, aoTransferir }: {
  clienteId: string
  corretorAtual: string | null
  aoFechar: () => void
  aoTransferir: () => void
}) {
  const { escopo } = useEscopo()
  const qc = useQueryClient()
  const [destino, setDestino] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const interno = !!escopo?.interno
  const valido = !!destino && motivo.trim().length >= 5

  async function confirmar() {
    if (!valido || !destino) return
    setEnviando(true)
    try {
      await redeTransferirClientes({ p_cliente_ids: [clienteId], p_novo_corretor_id: destino, p_motivo: motivo.trim() })
      toast.success('Cliente transferido.')
      void qc.invalidateQueries({ queryKey: chavesCrm.listas })
      aoTransferir()
      aoFechar()
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal
      aberto titulo="Transferir cliente" aoFechar={aoFechar} bloquearFechar={enviando}
      rodape={
        <>
          <button type="button" className="btn-ghost" onClick={aoFechar} disabled={enviando}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={confirmar} disabled={!valido || enviando}>{enviando ? 'Aguarde…' : 'Transferir'}</button>
        </>
      }
    >
      <div className="grid gap-4">
        <Campo label="Novo corretor responsável" obrigatorio>
          <SeletorParceiro
            valor={destino} aoMudar={setDestino} tipos={['corretor', 'gerente']} excluir={corretorAtual ? [corretorAtual] : []}
            imobiliariaId={interno ? null : escopo?.imobiliaria_id} vazio="Selecione o destino"
          />
        </Campo>
        <label className="block">
          <span className="label">Motivo<span className="text-bronze"> *</span></span>
          <textarea className="input" rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <span className="mt-1 block text-xs text-muted">Mínimo de 5 caracteres. Fica no histórico de vínculos.</span>
        </label>
        <p className="text-xs text-muted">
          Clientes com contrato em assinatura não são transferidos. Entre imobiliárias, só o Super transfere.
        </p>
      </div>
    </Modal>
  )
}

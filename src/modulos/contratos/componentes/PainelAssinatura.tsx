import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, RefreshCw, XCircle } from 'lucide-react'
import { PAPEIS_SIGNATARIO } from '@/lib/constants'
import { dataHora } from '@/lib/format'
import { mensagemErro } from '@/lib/erros'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { SeloStatus } from '@/components/app/Etiqueta'
import { abrirPdf, atualizarAssinatura, cancelarEnvio, chavesContratos } from '../api'
import type { ContratoDetalhe } from '../tipos'

/** Assinaturas no D4Sign (§7.3 item 6): status por signatário, "Atualizar status" e "Cancelar envio" (internos). */
export function PainelAssinatura({ k }: { k: ContratoDetalhe }) {
  const qc = useQueryClient()
  const [atualizando, setAtualizando] = useState(false)
  const [cancelar, setCancelar] = useState(false)
  const recarregar = () => qc.invalidateQueries({ queryKey: chavesContratos.todos })

  async function atualizar() {
    setAtualizando(true)
    try {
      await atualizarAssinatura(k.id)
      toast.success('Status atualizado com o D4Sign.')
      await recarregar()
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setAtualizando(false)
    }
  }

  async function baixarAssinado() {
    try {
      await abrirPdf(k.id, 'assinado')
    } catch (e) {
      toast.error(mensagemErro(e))
    }
  }

  return (
    <div className="grid gap-4">
      {k.signatarios.length === 0 ? <p className="text-sm text-muted">Os signatários aparecem aqui depois do envio para assinatura.</p> : (
        <ul className="divide-y divide-line border border-line" aria-label="Signatários">
          {k.signatarios.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{s.nome} <span className="text-xs text-muted">· {PAPEIS_SIGNATARIO[s.papel]}{s.ato === 'testemunhar' ? ' (testemunha)' : ''}</span></p>
                <p className="text-xs text-muted">{s.email || 'e-mail visível só para a equipe Arken'}</p>
                {s.assinado_em && <p className="text-xs text-muted">Assinou em {dataHora(s.assinado_em)}</p>}
                {s.status === 'recusado' && s.motivo && <p className="text-xs text-perigo">Motivo: {s.motivo}</p>}
              </div>
              <SeloStatus tipo="assinatura" valor={s.status} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        {k.permissoes.atualizar_assinatura && (
          <button type="button" className="btn-ghost" onClick={atualizar} disabled={atualizando}>
            <RefreshCw size={16} aria-hidden /> {atualizando ? 'Consultando…' : 'Atualizar status'}
          </button>
        )}
        {k.permissoes.cancelar_envio && (
          <button type="button" className="btn-ghost" onClick={() => setCancelar(true)}>
            <XCircle size={16} aria-hidden /> Cancelar envio
          </button>
        )}
        {k.permissoes.baixar_assinado && (
          <button type="button" className="btn-primary" onClick={baixarAssinado}>
            <Download size={16} aria-hidden /> Baixar PDF assinado
          </button>
        )}
      </div>
      <ConfirmarModal
        aberto={cancelar} aoFechar={() => setCancelar(false)} perigo titulo="Cancelar o envio para assinatura"
        texto="O documento é cancelado no D4Sign (os signatários são avisados) e o contrato fica cancelado. O produto volta a ficar disponível. Esta ação não pode ser desfeita: para refazer, crie um contrato novo."
        motivo={{ rotulo: 'Motivo do cancelamento', minimo: 3 }} rotuloConfirmar="Cancelar envio"
        aoConfirmar={async (motivo) => {
          await cancelarEnvio(k.id, motivo ?? '')
          toast.success('Envio cancelado.')
          await recarregar()
        }}
      />
    </div>
  )
}

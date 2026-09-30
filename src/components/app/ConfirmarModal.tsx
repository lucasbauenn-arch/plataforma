import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Modal } from './Modal'
import { mensagemErro } from '@/lib/erros'

/**
 * Confirmação de ação, com motivo opcional ou obrigatório (perdido, rejeição, inativação, cancelamento…).
 * `aoConfirmar` pode ser assíncrona: em caso de erro, mostra o toast com a mensagem do servidor e mantém aberto.
 */
export function ConfirmarModal({
  aberto, titulo, texto, rotuloConfirmar = 'Confirmar', perigo, motivo, aoConfirmar, aoFechar,
}: {
  aberto: boolean
  titulo: ReactNode
  texto?: ReactNode
  rotuloConfirmar?: string
  /** Ação destrutiva ou irreversível (botão em destaque de alerta). */
  perigo?: boolean
  /** Pede motivo: `minimo` caracteres (padrão 5, como nas RPCs), `obrigatorio` (padrão true). */
  motivo?: { rotulo?: string; minimo?: number; obrigatorio?: boolean; placeholder?: string }
  aoConfirmar: (motivo: string | null) => unknown | Promise<unknown>
  aoFechar: () => void
}) {
  const [texto_, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const minimo = motivo?.minimo ?? 5
  const obrigatorio = motivo ? motivo.obrigatorio ?? true : false
  const valido = !motivo || !obrigatorio || texto_.trim().length >= minimo

  function fechar() {
    if (enviando) return
    setTexto('')
    aoFechar()
  }

  async function confirmar() {
    if (!valido) return
    setEnviando(true)
    try {
      await aoConfirmar(motivo ? texto_.trim() || null : null)
      setTexto('')
      aoFechar()
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal
      aberto={aberto} titulo={titulo} aoFechar={fechar} bloquearFechar={enviando}
      rodape={
        <>
          <button type="button" className="btn-ghost" onClick={fechar} disabled={enviando}>Cancelar</button>
          <button type="button" className={perigo ? 'btn-accent' : 'btn-primary'} onClick={confirmar} disabled={!valido || enviando}>
            {enviando ? 'Aguarde…' : rotuloConfirmar}
          </button>
        </>
      }
    >
      {texto && <div className="text-sm text-stone/85">{texto}</div>}
      {motivo && (
        <label className="mt-4 block">
          <span className="label">{motivo.rotulo ?? 'Motivo'}{obrigatorio && <span className="text-bronze"> *</span>}</span>
          <textarea
            className="input" rows={4} value={texto_} placeholder={motivo.placeholder} maxLength={2000}
            onChange={(e) => setTexto(e.target.value)}
          />
          {obrigatorio && <span className="mt-1 block text-xs text-muted">Mínimo de {minimo} caracteres.</span>}
        </label>
      )}
    </Modal>
  )
}

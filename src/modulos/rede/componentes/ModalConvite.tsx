import { useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Mail, MessageCircle } from 'lucide-react'
import { Modal } from '@/components/app/Modal'
import { Etiqueta } from '@/components/app/Etiqueta'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { mensagemErro } from '@/lib/erros'
import { waLink, whatsappBR } from '@/lib/format'
import {
  conviteDeuCerto, mensagemConvite, resumirConvites, STATUS_CONVITE, type ModoConvite, type ResultadoConvite,
} from '@/lib/convites'
import type { Uuid } from '@/lib/types'
import { chavesRede, convidarParceiros } from '../api'

export interface ConvidadoInfo { id: Uuid; nome: string; telefone: string | null }

/**
 * Convite (§6.2): por e-mail (o Auth envia o link) ou, só com rede.convite_por_link (⚑ padrão: internos), gerando o link
 * para enviar pelo WhatsApp. O link leva a /parceiros/definir-senha e só é consumido no clique em "Continuar".
 * A Edge decide parceiro a parceiro (rede_pode_convidar com o JWT de quem pede): e-mail de outra conta, quem já tem
 * acesso e quem está inativo não recebem link.
 */
export function ModalConvite({ aberto, convidados, podeLink, aoFechar }: {
  aberto: boolean
  convidados: ConvidadoInfo[]
  podeLink: boolean
  aoFechar: () => void
}) {
  const qc = useQueryClient()
  const [modo, setModo] = useState<ModoConvite>('email')
  const [enviando, setEnviando] = useState(false)
  const [resultados, setResultados] = useState<ResultadoConvite[] | null>(null)
  const telefone = new Map(convidados.map((c) => [c.id, c.telefone]))

  function fechar() {
    if (enviando) return
    setResultados(null)
    setModo('email')
    aoFechar()
  }

  async function enviar() {
    setEnviando(true)
    try {
      const r = await convidarParceiros(convidados.map((c) => c.id), modo)
      setResultados(r)
      const ok = r.filter((x) => conviteDeuCerto(x.status)).length
      if (ok === r.length) toast.success(resumirConvites(r, modo))
      else toast.warning(resumirConvites(r, modo))
      await qc.invalidateQueries({ queryKey: chavesRede.tudo })
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setEnviando(false)
    }
  }

  const copiar = (link: string) =>
    navigator.clipboard.writeText(link).then(() => toast.success('Link copiado.'), () => toast.error('Não foi possível copiar.'))

  return (
    <Modal
      aberto={aberto} titulo={resultados ? 'Resultado do convite' : 'Convidar para o acesso'} aoFechar={fechar} bloquearFechar={enviando} largura="lg"
      rodape={resultados ? (
        <button type="button" className="btn-primary" onClick={fechar}>Concluir</button>
      ) : (
        <>
          <button type="button" className="btn-ghost" onClick={fechar} disabled={enviando}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={enviar} disabled={enviando || convidados.length === 0}>
            {enviando ? 'Enviando…' : modo === 'email' ? 'Enviar por e-mail' : 'Gerar links'}
          </button>
        </>
      )}
    >
      {!resultados ? (
        <div className="grid gap-4 text-sm">
          <p className="text-stone/85">
            {convidados.length === 1 ? <>Convidar <strong>{convidados[0].nome}</strong>.</> : <>Convidar <strong>{convidados.length}</strong> parceiros.</>}
            {' '}Cada pessoa recebe um link para definir a senha (vale 24 h e só pode ser usado uma vez).
          </p>
          <fieldset className="grid gap-2">
            <legend className="label">Como enviar</legend>
            <label className="flex items-start gap-3 border border-line p-3">
              <input type="radio" name="modo-convite" className="mt-1 accent-bronze" checked={modo === 'email'} onChange={() => setModo('email')} />
              <span><span className="flex items-center gap-2 font-semibold"><Mail size={15} aria-hidden /> Por e-mail</span>
                <span className="text-muted">O convite sai do e-mail da Arken para o e-mail cadastrado.</span></span>
            </label>
            {podeLink ? (
              <label className="flex items-start gap-3 border border-line p-3">
                <input type="radio" name="modo-convite" className="mt-1 accent-bronze" checked={modo === 'link'} onChange={() => setModo('link')} />
                <span><span className="flex items-center gap-2 font-semibold"><MessageCircle size={15} aria-hidden /> Gerar link (WhatsApp)</span>
                  <span className="text-muted">Você recebe o link para enviar. Não abra o link: ele é pessoal e cada geração fica registrada.</span></span>
              </label>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">O link pelo WhatsApp fica com a equipe Arken. <SeloProvisorio campo="permissoes_rede.convite_por_link" /></p>
            )}
          </fieldset>
        </div>
      ) : (
        <ul className="grid gap-3" aria-label="Resultado por parceiro">
          {resultados.map((r) => {
            const s = STATUS_CONVITE[r.status] ?? STATUS_CONVITE.erro
            const wa = whatsappBR(telefone.get(r.parceiro_id))
            return (
              <li key={r.parceiro_id} className="border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{r.nome ?? 'Parceiro'}</span>
                  <Etiqueta tom={s.tom}>{s.rotulo}</Etiqueta>
                </div>
                <p className="mt-1 text-muted">{r.mensagem}</p>
                {r.link && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {wa && (
                      <a className="btn-ghost px-3 py-2 text-xs" target="_blank" rel="noreferrer" href={waLink(wa, mensagemConvite(r.nome, r.link))}>
                        <MessageCircle size={14} aria-hidden /> Enviar pelo WhatsApp
                      </a>
                    )}
                    <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => copiar(r.link!)}>
                      <Copy size={14} aria-hidden /> Copiar link
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

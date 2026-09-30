import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PAPEIS_SIGNATARIO } from '@/lib/constants'
import { mensagemErro, traduzirErro } from '@/lib/erros'
import { Modal } from '@/components/app/Modal'
import type { ContratoSignatarioRegra } from '@/modulos/config/tipos'
import { chavesContratos, enviarParaAssinatura } from '../api'
import { BLOQUEIOS_ENVIO } from '../rotulos'
import type { BloqueioEnvio, ContratoDetalhe } from '../tipos'

const FONTES: Record<ContratoSignatarioRegra['fonte'], string> = {
  cliente: 'e-mail do cadastro do cliente',
  corretor_do_cliente: 'e-mail do corretor do contrato',
  fixo: 'e-mail configurado',
}

/**
 * Envio para assinatura (só internos): mostra quem vai assinar (regras ativas do modelo, D3) e explica cada bloqueio
 * (§7.3 item 5). O servidor confere tudo de novo (contrato_preparar_envio) antes de falar com o D4Sign.
 */
export function ModalEnvio({ k, aberto, aoFechar }: { k: ContratoDetalhe; aberto: boolean; aoFechar: () => void }) {
  const qc = useQueryClient()
  const [enviando, setEnviando] = useState(false)
  const regras = useQuery({
    queryKey: ['contratos', 'regras-signatarios', k.modelo.chave],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await supabase.from('contrato_signatario_regras')
        .select('id, modelo_chave, ordem, papel, fonte, nome, email, ato, ativo')
        .eq('modelo_chave', k.modelo.chave).eq('ativo', true).order('ordem')
      if (error) throw traduzirErro(error)
      return (data ?? []) as ContratoSignatarioRegra[]
    },
  })
  const bloqueios = k.bloqueios_envio as BloqueioEnvio[]

  async function enviar() {
    setEnviando(true)
    try {
      await enviarParaAssinatura(k.id)
      toast.success('Contrato enviado para assinatura. Os signatários recebem o e-mail do D4Sign.')
      await qc.invalidateQueries({ queryKey: chavesContratos.todos })
      aoFechar()
    } catch (e) {
      toast.error(mensagemErro(e))
      await qc.invalidateQueries({ queryKey: chavesContratos.detalhe(k.id) })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal
      aberto={aberto} aoFechar={aoFechar} bloquearFechar={enviando} titulo="Enviar para assinatura (D4Sign)"
      rodape={
        <>
          <button type="button" className="btn-ghost" onClick={aoFechar} disabled={enviando}>Voltar</button>
          <button type="button" className="btn-primary" onClick={enviar} disabled={enviando || bloqueios.length > 0 || k.envio_em_andamento}>
            {enviando ? 'Enviando…' : 'Enviar para assinatura'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 text-sm">
        {k.envio_em_andamento && <p className="text-bronze">Já há um envio em andamento. Aguarde alguns minutos.</p>}
        {bloqueios.length > 0 ? (
          <div className="grid gap-2">
            <p className="font-semibold">O envio está bloqueado:</p>
            <ul className="grid gap-2">
              {bloqueios.map((b) => (
                <li key={b} className="flex gap-2">
                  <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-bronze" />
                  <span><span className="font-medium">{BLOQUEIOS_ENVIO[b]?.titulo ?? b}.</span> {BLOQUEIOS_ENVIO[b]?.como}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="flex gap-2"><CheckCircle2 size={16} aria-hidden className="mt-0.5 text-sage" /> Tudo pronto para o envio.</p>
        )}
        <div>
          <p className="font-semibold">Signatários</p>
          {regras.isPending ? <p className="text-muted">Carregando…</p> : regras.error ? <p className="text-perigo">{traduzirErro(regras.error).message}</p> : (
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {regras.data?.map((r) => (
                <li key={r.id}>
                  {r.fonte === 'fixo' ? r.nome : PAPEIS_SIGNATARIO[r.papel]} — {r.fonte === 'fixo' ? (r.email ?? 'sem e-mail (bloqueia o envio)') : FONTES[r.fonte]}
                  {r.ato === 'testemunhar' ? ' (testemunha)' : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted">Ao enviar, o contrato fica congelado (valores e cadeia) e o imóvel, se houver, passa a "no contrato".</p>
      </div>
    </Modal>
  )
}

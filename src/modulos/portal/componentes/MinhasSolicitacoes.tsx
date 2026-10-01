import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MessageSquarePlus } from 'lucide-react'
import { portalSolicitar } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { dataHora } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { Etiqueta } from '@/components/app/Etiqueta'
import { Modal } from '@/components/app/Modal'
import {
  chavesPortal, mensagemObrigatoria, numeroSolicitacao, ROTULOS_SOLICITACAO, ROTULOS_STATUS_SOLICITACAO, TIPOS_SOLICITACAO, TOM_STATUS_SOLICITACAO,
} from '../rotulos'
import type { PortalSolicitacao, TipoSolicitacao } from '../tipos'

const esquema = z.object({
  tipo: z.string().refine((t) => (TIPOS_SOLICITACAO as string[]).includes(t), 'Escolha o tipo de solicitação.'),
  negocio_id: z.string(),
  mensagem: z.string().trim().max(2000, 'Escreva no máximo 2.000 caracteres.'),
}).superRefine((v, ctx) => {
  if (v.tipo === 'outro' && !v.mensagem) {
    ctx.addIssue({ code: 'custom', path: ['mensagem'], message: 'Conte o que você precisa.' })
  }
})
type FormSolicitacao = z.infer<typeof esquema>


/**
 * "Solicitações" do portal: o titular abre um pedido (portal_solicitar: 2ª via de boleto, antecipação de parcelas,
 * agendar vistoria, dúvida sobre o contrato, outro) e acompanha o status e a resposta da equipe (portal_solicitacoes).
 * Boleto real e parcelas são da etapa financeira: aqui é só o pedido, atendido pela equipe.
 */
export function MinhasSolicitacoes({ solicitacoes, negocios }: {
  solicitacoes: PortalSolicitacao[]
  negocios: { id: string; titulo: string }[]
}) {
  const [aberto, setAberto] = useState(false)
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="portal-solicitacoes">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="portal-solicitacoes" className="flex items-center gap-2 font-semibold"><MessageSquarePlus size={18} className="text-bronze" aria-hidden /> Solicitações</h2>
          <p className="mt-1 text-sm text-muted">Peça a 2ª via de boleto, antecipação de parcelas, agendamento da vistoria ou tire uma dúvida. A equipe Arken responde por aqui.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setAberto(true)}>Solicitar</button>
      </div>
      {solicitacoes.length === 0 ? <p className="mt-4 text-sm text-muted">Você ainda não fez nenhuma solicitação.</p> : (
        <ul className="mt-4 divide-y divide-line">
          {solicitacoes.map((s) => (
            <li key={s.id} className="grid gap-1 py-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{ROTULOS_SOLICITACAO[s.tipo]} <span className="font-normal text-muted">{numeroSolicitacao(s.numero)}</span></p>
                <Etiqueta tom={TOM_STATUS_SOLICITACAO[s.status]}>{ROTULOS_STATUS_SOLICITACAO[s.status]}</Etiqueta>
              </div>
              <p className="text-xs text-muted">Aberta em {dataHora(s.criado_em)}{s.negocio ? ` · ${s.negocio.titulo}` : ''}</p>
              {s.mensagem && <p className="whitespace-pre-line text-stone/85">{s.mensagem}</p>}
              {s.resposta && (
                <div className="mt-1 border-l-2 border-bronze bg-sand/40 px-3 py-2">
                  <p className="text-xs font-semibold text-bronze">Resposta da equipe Arken</p>
                  <p className="whitespace-pre-line">{s.resposta}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <NovaSolicitacao aberto={aberto} aoFechar={() => setAberto(false)} negocios={negocios} />
    </section>
  )
}

function NovaSolicitacao({ aberto, aoFechar, negocios }: { aberto: boolean; aoFechar: () => void; negocios: { id: string; titulo: string }[] }) {
  const qc = useQueryClient()
  const form = useForm<FormSolicitacao>({
    resolver: zodResolver(esquema),
    defaultValues: { tipo: '', negocio_id: negocios.length === 1 ? negocios[0].id : '', mensagem: '' },
  })
  const tipo = useWatch({ control: form.control, name: 'tipo' })
  const erros = form.formState.errors
  const enviando = form.formState.isSubmitting

  async function enviar(v: FormSolicitacao) {
    try {
      await portalSolicitar({ p_tipo: v.tipo as TipoSolicitacao, p_negocio_id: v.negocio_id || null, p_mensagem: v.mensagem || null })
    } catch (e) {
      toast.error(mensagemErro(e))
      return
    }
    toast.success('Solicitação enviada. A equipe Arken vai responder por aqui.')
    form.reset({ tipo: '', negocio_id: negocios.length === 1 ? negocios[0].id : '', mensagem: '' })
    aoFechar()
    await qc.invalidateQueries({ queryKey: chavesPortal.solicitacoes })
  }

  return (
    <Modal
      aberto={aberto} titulo="Nova solicitação" aoFechar={aoFechar} bloquearFechar={enviando}
      rodape={<>
        <button type="button" className="btn-ghost" onClick={aoFechar} disabled={enviando}>Cancelar</button>
        <button type="submit" form="form-solicitacao" className="btn-primary" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar solicitação'}</button>
      </>}
    >
      <form id="form-solicitacao" className="grid gap-4" noValidate onSubmit={form.handleSubmit(enviar)}>
        <Campo label="O que você precisa?" obrigatorio erro={erros.tipo?.message}>
          <select className="input" aria-invalid={!!erros.tipo || undefined} {...form.register('tipo')}>
            <option value="" disabled>Escolha…</option>
            {TIPOS_SOLICITACAO.map((t) => <option key={t} value={t}>{ROTULOS_SOLICITACAO[t]}</option>)}
          </select>
        </Campo>
        {negocios.length > 0 && (
          <Campo label="Sobre qual imóvel?">
            <select className="input" {...form.register('negocio_id')}>
              <option value="">Nenhum em especial</option>
              {negocios.map((n) => <option key={n.id} value={n.id}>{n.titulo}</option>)}
            </select>
          </Campo>
        )}
        <Campo label="Mensagem" obrigatorio={mensagemObrigatoria(tipo as TipoSolicitacao)} erro={erros.mensagem?.message}>
          <textarea className="input" rows={4} maxLength={2000} placeholder="Detalhes que ajudam a equipe a atender (datas, parcelas, dúvida…)"
            aria-invalid={!!erros.mensagem || undefined} {...form.register('mensagem')} />
        </Campo>
        <p className="text-xs text-muted">A 2ª via e a antecipação são preparadas pela equipe e enviadas a você. Não informe senhas nem dados de cartão.</p>
      </form>
    </Modal>
  )
}

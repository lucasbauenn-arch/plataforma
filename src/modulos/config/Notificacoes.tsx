import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensagemErro, traduzirErro } from '@/lib/erros'
import { Consulta } from '@/components/app/Consulta'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import type { NotificacaoConfig, TipoNotificacao } from './tipos'

const CHAVE = ['config', 'notificacoes'] as const

const PARA: Record<TipoNotificacao, string> = {
  'crm.boas_vindas': 'Cliente',
  'crm.documento_rejeitado': 'Cliente',
  'crm.documento_solicitado': 'Cliente',
  'crm.novo_lead_corretor': 'Corretor',
  'contratos.enviado': 'Conforme o contrato',
  'contratos.assinado': 'Conforme o contrato',
  'rede.transferencia': 'Parceiros envolvidos',
}

/**
 * E-mails opcionais (notificacoes_config, N10): só boas-vindas e documento rejeitado começam ligados. Desligar faz o
 * tipo parar de entrar na fila; o que já está na fila é descartado no envio. Os avisos antigos (novo parceiro,
 * proposta e lead) não dependem desta tela.
 */
export default function Notificacoes() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await supabase.from('notificacoes_config').select('tipo, ativo, descricao, criado_em, atualizado_em, atualizado_por').order('tipo')
      if (error) throw error
      return (data ?? []) as NotificacaoConfig[]
    },
  })

  async function alternar(n: NotificacaoConfig) {
    const { data, error } = await supabase.from('notificacoes_config').update({ ativo: !n.ativo }).eq('tipo', n.tipo).select('tipo')
    if (error) return toast.error(mensagemErro(traduzirErro(error)))
    if (!data?.length) return toast.error('Sem permissão para alterar.')
    toast.success(n.ativo ? 'E-mail desligado.' : 'E-mail ligado.')
    await qc.invalidateQueries({ queryKey: CHAVE })
  }

  return (
    <section aria-labelledby="notif-titulo">
      <h3 id="notif-titulo" className="mb-2 flex flex-wrap items-center gap-2 text-lg font-semibold">
        <Mail size={18} className="text-bronze" aria-hidden /> E-mails automáticos <SeloProvisorio codigo="N10" />
      </h3>
      <p className="mb-5 max-w-3xl text-sm text-muted">
        Os e-mails saem pelo Resend. Enquanto o domínio não estiver verificado, as mensagens ficam na fila e saem sozinhas depois (até 7 dias).
        Cliente com consentimento revogado ou anonimizado não recebe nada.
      </p>
      <Consulta consulta={q} tituloVazio="Nenhum tipo de e-mail cadastrado">
        {(lista) => (
          <ul className="grid gap-3">
            {lista.map((n) => (
              <li key={n.tipo} className="card flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{n.descricao}</p>
                  <p className="text-xs text-muted">Para: {PARA[n.tipo] ?? '—'} · <span className="font-mono">{n.tipo}</span></p>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" className="h-4 w-4 accent-bronze" checked={n.ativo} onChange={() => void alternar(n)} aria-label={`Enviar: ${n.descricao}`} />
                  {n.ativo ? 'Ligado' : 'Desligado'}
                </label>
              </li>
            ))}
          </ul>
        )}
      </Consulta>
    </section>
  )
}

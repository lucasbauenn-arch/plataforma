import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { mascaraTelefone } from '@/lib/format'
import { Campo } from './Campo'
import { useCaptcha } from '@/hooks/useCaptcha'

const schema = z.object({
  nome: z.string().trim().min(2, 'Informe seu nome'),
  telefone: z.string().refine((v) => v.replace(/\D/g, '').length >= 10, 'Telefone inválido'),
  email: z.union([z.literal(''), z.email('E-mail inválido')]),
  mensagem: z.string().max(2000).optional(),
})
type Dados = z.infer<typeof schema>

export function FormLead({ empreendimentoId, escuro = false }: { empreendimentoId?: string; escuro?: boolean }) {
  const [enviado, setEnviado] = useState(false)
  const captcha = useCaptcha('lead')
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Dados>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })

  // grava pela Edge Function enviar-lead (valida o Turnstile); o insert direto na tabela é bloqueado
  async function enviar(d: Dados) {
    const { error } = await supabase.functions.invoke('enviar-lead', {
      body: { ...d, empreendimento_id: empreendimentoId ?? null, captcha: captcha.token },
    })
    captcha.renovar()
    if (error) {
      const msg = await error.context?.json?.().then((j: { erro?: string }) => j.erro).catch(() => null)
      return toast.error(msg ?? 'Não foi possível enviar. Tente pelo WhatsApp.')
    }
    setEnviado(true)
  }

  if (enviado) {
    return (
      <div className={`p-8 text-center ${escuro ? 'bg-white/5' : 'bg-ink-soft'}`}>
        <p className="display text-3xl">Recebemos seu contato.</p>
        <p className="mt-2 text-sm opacity-75">Um consultor Arken vai falar com você em breve.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(enviar)} className={`grid gap-4 ${escuro ? '[&_.label]:text-stone/80' : ''}`} noValidate>
      <Campo label="Nome" obrigatorio erro={errors.nome?.message}><input className="input" {...register('nome')} /></Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Telefone / WhatsApp" obrigatorio erro={errors.telefone?.message}>
          <input className="input" inputMode="tel" {...register('telefone', { onChange: (e) => setValue('telefone', mascaraTelefone(e.target.value)) })} />
        </Campo>
        <Campo label="E-mail" erro={errors.email?.message}><input className="input" type="email" {...register('email')} /></Campo>
      </div>
      <Campo label="Mensagem"><textarea rows={3} className="input" {...register('mensagem')} /></Campo>
      {captcha.widget}
      <button disabled={isSubmitting || !captcha.pronto} className="btn-accent mt-1 w-full sm:w-auto sm:justify-self-start">
        {isSubmitting ? 'Enviando…' : 'Quero ser atendido'}
      </button>
      <p className={`text-xs ${escuro ? 'text-stone/50' : 'text-muted'}`}>Ao enviar, você concorda com nossa política de privacidade.</p>
    </form>
  )
}

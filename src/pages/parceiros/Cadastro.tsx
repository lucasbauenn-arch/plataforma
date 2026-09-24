import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { mascaraTelefone } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { useCaptcha } from '@/hooks/useCaptcha'
import { AuthCard } from './AuthCard'

const schema = z.object({
  nome: z.string().trim().min(3, 'Informe seu nome completo'),
  email: z.email('E-mail inválido'),
  telefone: z.string().refine((v) => v.replace(/\D/g, '').length >= 10, 'Telefone inválido'),
  creci: z.string().trim().optional(),
  imobiliaria: z.string().trim().optional(),
  senha: z.string().min(8, 'Mínimo de 8 caracteres'),
  aceite: z.literal(true, { error: 'Aceite os termos para continuar' }),
})
type Dados = z.infer<typeof schema>

export default function CadastroParceiro() {
  const [feito, setFeito] = useState(false)
  const captcha = useCaptcha('cadastro_parceiro')
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Dados>({ resolver: zodResolver(schema) })

  async function enviar(d: Dados) {
    const { error } = await supabase.auth.signUp({
      email: d.email.trim(),
      password: d.senha,
      options: {
        emailRedirectTo: `${location.origin}/parceiros`,
        captchaToken: captcha.token,
        data: { nome: d.nome, telefone: d.telefone, creci: d.creci, imobiliaria: d.imobiliaria },
      },
    })
    captcha.renovar()
    if (error) return toast.error(error.message.includes('registered') ? 'Este e-mail já está cadastrado.' : 'Não foi possível concluir o cadastro.')
    setFeito(true)
  }

  if (feito) {
    return (
      <AuthCard eyebrow="Cadastro enviado" titulo="Confirme seu e-mail">
        <p className="text-muted">Enviamos um link de confirmação. Depois de confirmar, seu cadastro passa pela aprovação da equipe Arken — avisaremos quando o acesso for liberado.</p>
        <Link to="/parceiros" className="btn-primary mt-6">Ir para o login</Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard eyebrow="Área do parceiro" titulo="Cadastro de parceiro">
      <form onSubmit={handleSubmit(enviar)} className="grid gap-4" noValidate>
        <Campo label="Nome completo" obrigatorio erro={errors.nome?.message}><input className="input" {...register('nome')} /></Campo>
        <Campo label="E-mail" obrigatorio erro={errors.email?.message}><input className="input" type="email" {...register('email')} /></Campo>
        <Campo label="Telefone / WhatsApp" obrigatorio erro={errors.telefone?.message}>
          <input className="input" inputMode="tel" {...register('telefone', { onChange: (e) => setValue('telefone', mascaraTelefone(e.target.value)) })} />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="CRECI"><input className="input" {...register('creci')} /></Campo>
          <Campo label="Imobiliária"><input className="input" {...register('imobiliaria')} /></Campo>
        </div>
        <Campo label="Senha" obrigatorio erro={errors.senha?.message}><input className="input" type="password" autoComplete="new-password" {...register('senha')} /></Campo>
        <label className="flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" className="mt-1 accent-bronze" {...register('aceite')} />
          <span>Li e aceito os <Link to="/termos-de-uso" className="underline">termos de uso</Link> e a <Link to="/politica-de-privacidade" className="underline">política de privacidade</Link>.</span>
        </label>
        {errors.aceite && <span className="-mt-2 text-xs text-red-400">{errors.aceite.message}</span>}
        {captcha.widget}
        <button className="btn-primary mt-2" disabled={isSubmitting || !captcha.pronto}>{isSubmitting ? 'Enviando…' : 'Criar cadastro'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">Já é parceiro? <Link to="/parceiros" className="font-semibold text-bronze">Entrar</Link></p>
    </AuthCard>
  )
}

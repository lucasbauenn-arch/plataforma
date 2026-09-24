import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useCaptcha } from '@/hooks/useCaptcha'
import { Campo } from '@/components/Campo'
import { AuthCard } from './AuthCard'

export default function RecuperarSenha() {
  const [email, setEmail] = useState('')
  const [enviado, setEnviado] = useState(false)
  const captcha = useCaptcha('recuperar_senha')
  async function enviar(ev: React.FormEvent) {
    ev.preventDefault()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${location.origin}/parceiros/nova-senha`, captchaToken: captcha.token,
    })
    captcha.renovar()
    // erro de captcha/limite aparece; "e-mail não existe" nunca (resposta genérica)
    if (error && /captcha|rate|limit/i.test(error.message)) return toast.error('Não foi possível enviar agora. Aguarde um pouco e tente de novo.')
    setEnviado(true)
  }
  return (
    <AuthCard eyebrow="Área do parceiro" titulo="Recuperar senha">
      {enviado ? <p className="text-muted">Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.</p> : (
        <form onSubmit={enviar} className="grid gap-4">
          <Campo label="E-mail"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
          {captcha.widget}
          <button className="btn-primary" disabled={!captcha.pronto}>Enviar link</button>
        </form>
      )}
    </AuthCard>
  )
}

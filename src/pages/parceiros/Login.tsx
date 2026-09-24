import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Campo } from '@/components/Campo'
import { useCaptcha } from '@/hooks/useCaptcha'
import { AuthCard } from './AuthCard'

export default function LoginParceiro() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const captcha = useCaptcha('login_parceiro')
  const nav = useNavigate()
  const { profile } = useAuth()

  useEffect(() => {
    if (profile?.papel === 'admin') nav('/admin', { replace: true })
    else if (profile?.papel === 'parceiro') nav('/parceiros/painel', { replace: true })
  }, [profile, nav])

  async function entrar(ev: React.FormEvent) {
    ev.preventDefault()
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha, options: { captchaToken: captcha.token } })
    setEnviando(false)
    captcha.renovar()
    if (error?.code === 'email_not_confirmed') toast.error('Confirme seu e-mail pelo link que enviamos (veja também o spam) antes de entrar.')
    else if (error) toast.error('E-mail ou senha incorretos.')
  }

  return (
    <AuthCard eyebrow="Área do parceiro" titulo="Entrar">
      <form onSubmit={entrar} className="grid gap-4">
        <Campo label="E-mail"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
        <Campo label="Senha"><input className="input" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></Campo>
        {captcha.widget}
        <button className="btn-primary mt-2" disabled={enviando || !captcha.pronto}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        <Link to="/parceiros/recuperar-senha" className="text-muted hover:text-stone">Esqueci a senha</Link>
        <Link to="/parceiros/cadastro" className="font-semibold text-bronze">Quero ser parceiro</Link>
      </div>
    </AuthCard>
  )
}

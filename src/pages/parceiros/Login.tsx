import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { destinoPorPapel } from '@/lib/menu'
import { MENSAGENS } from '@/lib/erros'
import { Campo } from '@/components/Campo'
import { useCaptcha } from '@/hooks/useCaptcha'
import { contasDev } from '@/lib/dev'
import { AuthCard } from './AuthCard'

/** Volta para a rota pedida antes do login só se ela estiver na área do próprio papel. */
function destinoDepoisDoLogin(papelDestino: string, pedido: unknown): string {
  if (typeof pedido !== 'string' || !pedido.startsWith('/')) return papelDestino
  const caminho = pedido.split(/[?#]/)[0]
  return caminho === papelDestino || caminho.startsWith(papelDestino + '/') ? pedido : papelDestino
}

export default function LoginParceiro() {
  // em dev, já vem preenchido com a conta de teste de .env.development.local (vazio no build)
  const [email, setEmail] = useState(contasDev[0]?.email ?? '')
  const [senha, setSenha] = useState(contasDev[0]?.senha ?? '')
  const [enviando, setEnviando] = useState(false)
  const captcha = useCaptcha('login_parceiro')
  const nav = useNavigate()
  const loc = useLocation()
  const { profile } = useAuth()

  // já logado (ou acabou de entrar): cada papel vai para a sua área (colaborador vê "acesso ainda não liberado")
  useEffect(() => {
    if (!profile) return
    nav(destinoDepoisDoLogin(destinoPorPapel(profile.papel), (loc.state as { de?: unknown } | null)?.de), { replace: true })
  }, [profile, nav, loc.state])

  async function entrar(ev: React.FormEvent) {
    ev.preventDefault()
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha, options: { captchaToken: captcha.token } })
    setEnviando(false)
    captcha.renovar()
    if (!error) return
    // o hook de token (hook_token_acesso) recusa emitir sessão para parceiro inativo
    if (error.message?.includes('ACESSO_INATIVO')) toast.error(MENSAGENS.ACESSO_INATIVO)
    else if (error.code === 'email_not_confirmed') toast.error('Confirme seu e-mail pelo link que enviamos (veja também o spam) antes de entrar.')
    else if (error.code === 'captcha_failed') toast.error('Não foi possível confirmar que você não é um robô. Tente de novo.')
    else toast.error('E-mail ou senha incorretos.')
  }

  return (
    <AuthCard eyebrow="Área do parceiro" titulo="Entrar">
      <form onSubmit={entrar} className="grid gap-4">
        <Campo label="E-mail"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
        <Campo label="Senha"><input className="input" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></Campo>
        {captcha.widget}
        <button className="btn-primary mt-2" disabled={enviando || !captcha.pronto}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
      {contasDev.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Contas de teste (dev):</span>
          {contasDev.map((c) => (
            <button key={c.email} type="button" className="border border-line px-2 py-1 text-muted hover:text-stone" onClick={() => { setEmail(c.email); setSenha(c.senha) }}>
              {c.email}
            </button>
          ))}
        </div>
      )}
      <div className="mt-6 flex justify-between text-sm">
        <Link to="/parceiros/recuperar-senha" className="text-muted hover:text-stone">Esqueci a senha</Link>
        <Link to="/parceiros/cadastro" className="font-semibold text-bronze">Quero ser parceiro</Link>
      </div>
    </AuthCard>
  )
}

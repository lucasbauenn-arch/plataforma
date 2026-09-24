import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { mascaraCpf, cpfValido, waLink } from '@/lib/format'
import { EMPRESA } from '@/lib/constants'
import { Campo } from '@/components/Campo'
import { AuthCard } from '../parceiros/AuthCard'

// login só com CPF (decisão do cliente) — a Edge Function cliente-login limita tentativas e registra os acessos
export default function LoginCliente() {
  const [cpf, setCpf] = useState('')
  const [enviando, setEnviando] = useState(false)
  const nav = useNavigate()
  const { profile } = useAuth()

  useEffect(() => { if (profile?.papel === 'cliente') nav('/portal-do-cliente/meus-imoveis', { replace: true }) }, [profile, nav])

  async function entrar(ev: React.FormEvent) {
    ev.preventDefault()
    if (!cpfValido(cpf)) return toast.error('CPF inválido')
    setEnviando(true)
    const { data, error } = await supabase.functions.invoke('cliente-login', { body: { cpf } })
    if (error || !data?.access_token) {
      setEnviando(false)
      const msg = await error?.context?.json?.().then((j: { erro?: string }) => j.erro).catch(() => null)
      return toast.error(msg ?? 'Não foi possível entrar. Tente novamente.')
    }
    await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token })
    setEnviando(false)
  }

  return (
    <AuthCard eyebrow="Portal do cliente" titulo="Acesse sua conta">
      <form onSubmit={entrar} className="grid gap-4">
        <Campo label="CPF"><input className="input" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(mascaraCpf(e.target.value))} /></Campo>
        <button className="btn-primary" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <p className="mt-6 text-xs text-muted">
        Não encontrou seu cadastro?{' '}
        <a className="font-semibold text-bronze" target="_blank" rel="noreferrer" href={waLink(EMPRESA.whatsapp, 'Olá! Preciso de ajuda para acessar o Portal do Cliente.')}>Fale com nosso atendimento</a>.
      </p>
    </AuthCard>
  )
}

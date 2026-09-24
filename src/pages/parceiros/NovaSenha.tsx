import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Campo } from '@/components/Campo'
import { AuthCard } from './AuthCard'

export default function NovaSenha() {
  const [senha, setSenha] = useState('')
  const nav = useNavigate()
  async function salvar(ev: React.FormEvent) {
    ev.preventDefault()
    if (senha.length < 8) return toast.error('Mínimo de 8 caracteres')
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) return toast.error('Link expirado. Solicite novamente.')
    toast.success('Senha atualizada')
    nav('/parceiros')
  }
  return (
    <AuthCard eyebrow="Área do parceiro" titulo="Nova senha">
      <form onSubmit={salvar} className="grid gap-4">
        <Campo label="Nova senha"><input className="input" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} /></Campo>
        <button className="btn-primary">Salvar</button>
      </form>
    </AuthCard>
  )
}

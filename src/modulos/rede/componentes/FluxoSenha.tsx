import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { KeyRound, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { MENSAGENS } from '@/lib/erros'
import { lerLinkSenha, problemaSenha, type TipoLinkSenha } from '@/lib/convites'
import { Campo } from '@/components/Campo'
import { AuthCard } from '@/pages/parceiros/AuthCard'

type Etapa = 'inicio' | 'verificando' | 'senha' | 'invalido' | 'expirado'

const esquema = z.object({ senha: z.string(), confirmacao: z.string() }).superRefine((v, ctx) => {
  const p = problemaSenha(v.senha, v.confirmacao)
  if (p) ctx.addIssue({ code: 'custom', path: [p === 'As senhas não conferem.' ? 'confirmacao' : 'senha'], message: p })
})
type Valores = z.infer<typeof esquema>

/**
 * Definição de senha a partir do link do e-mail ou do WhatsApp (docs/ARQUITETURA_EXPANSAO.md §6.2):
 * 1. lê `token_hash` e `type` da URL e NÃO consome nada ao abrir (pré-visualização do WhatsApp e antivírus de e-mail
 *    abrem o link antes da pessoa);
 * 2. só no clique em "Continuar" chama `verifyOtp` (o token é de uso único e vale 24 h) e tira o token da barra;
 * 3. a pessoa define a senha (`updateUser`) e segue para a área do papel dela.
 * `aceitarSessaoAtual`: a recuperação antiga (link com a sessão no endereço) continua funcionando em /nova-senha.
 */
export function FluxoSenha({ aceitos, eyebrow, titulo, textoInicio, aceitarSessaoAtual }: {
  aceitos: readonly TipoLinkSenha[]
  eyebrow: string
  titulo: string
  textoInicio: string
  aceitarSessaoAtual?: boolean
}) {
  const { search } = useLocation()
  const nav = useNavigate()
  const [link] = useState(() => lerLinkSenha(search, aceitos))
  // sem token na URL: só a recuperação antiga (sessão já no endereço) pode seguir, depois de conferir a sessão
  const [etapa, setEtapa] = useState<Etapa>(link ? 'inicio' : aceitarSessaoAtual ? 'verificando' : 'invalido')
  const [erroVerificacao, setErroVerificacao] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Valores>({
    resolver: zodResolver(esquema), defaultValues: { senha: '', confirmacao: '' },
  })

  useEffect(() => {
    if (link || !aceitarSessaoAtual) return
    let vivo = true
    supabase.auth.getSession().then(({ data }) => { if (vivo) setEtapa(data.session ? 'senha' : 'invalido') })
    return () => { vivo = false }
  }, [link, aceitarSessaoAtual])

  async function continuar() {
    if (!link) return
    setEtapa('verificando')
    setErroVerificacao(null)
    const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.tipo })
    // o token já foi usado (ou não vale): some da barra de endereço e do histórico
    window.history.replaceState(window.history.state, '', window.location.pathname)
    if (error) {
      setErroVerificacao(error.message?.includes('ACESSO_INATIVO') ? MENSAGENS.ACESSO_INATIVO : null)
      setEtapa('expirado')
      return
    }
    setEtapa('senha')
  }

  async function salvar(v: Valores) {
    const { error } = await supabase.auth.updateUser({ password: v.senha })
    if (error) {
      if (error.code === 'same_password') toast.error('Escolha uma senha diferente da anterior.')
      else if (error.code === 'weak_password') toast.error('Senha fraca: use mais caracteres, letras e números.')
      else toast.error('Não foi possível salvar a senha. Abra o link de novo ou peça um novo convite.')
      return
    }
    toast.success('Senha definida. Bem-vindo(a)!')
    nav('/parceiros', { replace: true })
  }

  if (etapa === 'invalido' || etapa === 'expirado') {
    return (
      <AuthCard eyebrow={eyebrow} titulo={etapa === 'expirado' ? 'Link expirado' : 'Link inválido'}>
        <p className="text-muted">
          {erroVerificacao ?? (etapa === 'expirado'
            ? 'Este link já foi usado ou passou do prazo de 24 horas.'
            : 'O endereço está incompleto. Abra o link exatamente como recebeu.')}
        </p>
        <p className="mt-3 text-sm text-muted">
          Convite: peça um novo a quem cadastrou você. Senha esquecida: use "Esqueci a senha".
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/parceiros/recuperar-senha" className="btn-ghost">Esqueci a senha</Link>
          <Link to="/parceiros" className="btn-primary">Ir para o login</Link>
        </div>
      </AuthCard>
    )
  }

  if (etapa === 'inicio' || etapa === 'verificando') {
    return (
      <AuthCard eyebrow={eyebrow} titulo={titulo}>
        <p className="text-muted">{textoInicio}</p>
        <button type="button" className="btn-primary mt-6 w-full" onClick={continuar} disabled={etapa === 'verificando' || !link}>
          {etapa === 'verificando' ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Verificando…</> : <><KeyRound size={16} aria-hidden /> Continuar</>}
        </button>
        <p className="mt-4 text-xs text-muted">O link vale 24 horas e só pode ser usado uma vez.</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard eyebrow={eyebrow} titulo="Crie sua senha">
      <form onSubmit={handleSubmit(salvar)} className="grid gap-4" noValidate>
        <Campo label="Nova senha" obrigatorio erro={errors.senha?.message}>
          <input className="input" type="password" autoComplete="new-password" {...register('senha')} />
        </Campo>
        <Campo label="Repita a senha" obrigatorio erro={errors.confirmacao?.message}>
          <input className="input" type="password" autoComplete="new-password" {...register('confirmacao')} />
        </Campo>
        <p className="text-xs text-muted">Pelo menos 8 caracteres, com letras e números.</p>
        <button className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Salvando…' : 'Salvar senha'}</button>
      </form>
    </AuthCard>
  )
}

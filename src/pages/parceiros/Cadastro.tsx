import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { lgpdTermoVigente } from '@/lib/rpc'
import { cpfValido, mascaraCpf, mascaraTelefone, soDigitos } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { Modal } from '@/components/app/Modal'
import { useCaptcha } from '@/hooks/useCaptcha'
import { AuthCard } from './AuthCard'

const schema = z.object({
  nome: z.string().trim().min(3, 'Informe seu nome completo').max(200, 'Máximo de 200 caracteres'),
  cpf: z.string().refine((v) => cpfValido(v), 'CPF inválido'),
  email: z.email('E-mail inválido'),
  telefone: z.string().refine((v) => [10, 11].includes(soDigitos(v).length), 'Telefone inválido'),
  creci: z.string().trim().min(2, 'Informe seu CRECI').max(30, 'Máximo de 30 caracteres'),
  imobiliaria: z.string().trim().max(200, 'Máximo de 200 caracteres').optional(),
  senha: z.string().min(8, 'Mínimo de 8 caracteres').max(72, 'Máximo de 72 caracteres'),
  aceite: z.literal(true, { error: 'Aceite os termos para continuar' }),
})
type Dados = z.infer<typeof schema>

/**
 * [WP1] Cadastro espontâneo de parceiro (N8, N18): corretor autônomo na rede Arken, sempre com aprovação interna
 * (rede_aprovar_autocadastro escolhe a cadeia; padrão: a casa). CPF e CRECI obrigatórios (PAR-4). O aceite é do termo
 * vigente de parceiro (`termo_id` nos metadados: handle_new_user grava o consentimento). Os metadados nunca levam papel
 * nem cadeia; o CPF declarado é conferido na aprovação e depois sai dos metadados.
 */
export default function CadastroParceiro() {
  const [feito, setFeito] = useState(false)
  const [verTermo, setVerTermo] = useState(false)
  const captcha = useCaptcha('cadastro_parceiro')
  const termo = useQuery({
    queryKey: ['lgpd-termo', 'termos_parceiro'],
    queryFn: () => lgpdTermoVigente({ p_tipo: 'termos_parceiro' }),
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<Dados>({ resolver: zodResolver(schema) })

  async function enviar(d: Dados) {
    const { error } = await supabase.auth.signUp({
      email: d.email.trim().toLowerCase(),
      password: d.senha,
      options: {
        emailRedirectTo: `${location.origin}/parceiros`,
        captchaToken: captcha.token,
        data: {
          nome: d.nome.trim(),
          telefone: d.telefone,
          cpf: soDigitos(d.cpf),
          creci: d.creci.trim(),
          imobiliaria: d.imobiliaria?.trim() || undefined,
          // sem termo carregado, o painel pede o aceite depois (pendência "termo")
          termo_id: termo.data?.id,
        },
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
      <p className="-mt-4 mb-6 text-sm text-muted">
        Para corretores autônomos que querem vender com a rede Arken. Imobiliárias e equipes são cadastradas pela equipe Arken.
      </p>
      <form onSubmit={handleSubmit(enviar)} className="grid gap-4" noValidate>
        <Campo label="Nome completo" obrigatorio erro={errors.nome?.message}><input className="input" autoComplete="name" {...register('nome')} /></Campo>
        <Campo label="CPF" obrigatorio erro={errors.cpf?.message}>
          <Controller control={control} name="cpf" defaultValue="" render={({ field }) => (
            <input className="input" inputMode="numeric" placeholder="000.000.000-00" value={field.value} onBlur={field.onBlur}
              onChange={(e) => field.onChange(mascaraCpf(e.target.value))} />
          )} />
        </Campo>
        <Campo label="E-mail" obrigatorio erro={errors.email?.message}><input className="input" type="email" autoComplete="email" {...register('email')} /></Campo>
        <Campo label="Telefone / WhatsApp" obrigatorio erro={errors.telefone?.message}>
          <Controller control={control} name="telefone" defaultValue="" render={({ field }) => (
            <input className="input" inputMode="tel" autoComplete="tel" value={field.value} onBlur={field.onBlur}
              onChange={(e) => field.onChange(mascaraTelefone(e.target.value))} />
          )} />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="CRECI" obrigatorio erro={errors.creci?.message}><input className="input" {...register('creci')} /></Campo>
          <Campo label="Imobiliária" erro={errors.imobiliaria?.message}><input className="input" placeholder="Se trabalhar com uma" {...register('imobiliaria')} /></Campo>
        </div>
        <Campo label="Senha" obrigatorio erro={errors.senha?.message}><input className="input" type="password" autoComplete="new-password" {...register('senha')} /></Campo>
        <label className="flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" className="mt-1 accent-bronze" {...register('aceite')} />
          {termo.data ? (
            <span>
              Li e aceito os <button type="button" className="underline hover:text-stone" onClick={() => setVerTermo(true)}>termos de uso e a política de privacidade</button>
              {' '}(versão {termo.data.versao}).
            </span>
          ) : (
            <span>Li e aceito os <Link to="/termos-de-uso" className="underline">termos de uso</Link> e a <Link to="/politica-de-privacidade" className="underline">política de privacidade</Link>.</span>
          )}
        </label>
        {errors.aceite && <span className="-mt-2 text-xs text-perigo">{errors.aceite.message}</span>}
        {captcha.widget}
        <button className="btn-primary mt-2" disabled={isSubmitting || !captcha.pronto}>{isSubmitting ? 'Enviando…' : 'Criar cadastro'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">Já é parceiro? <Link to="/parceiros" className="font-semibold text-bronze">Entrar</Link></p>

      <Modal aberto={verTermo && !!termo.data} titulo={`Termos do parceiro — versão ${termo.data?.versao ?? ''}`} aoFechar={() => setVerTermo(false)} largura="lg"
        rodape={<button type="button" className="btn-primary" onClick={() => setVerTermo(false)}>Fechar</button>}>
        <div className="whitespace-pre-line text-sm leading-relaxed text-stone/85">{termo.data?.texto}</div>
      </Modal>
    </AuthCard>
  )
}

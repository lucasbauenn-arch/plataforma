import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { KeyRound, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useEscopo } from '@/lib/escopo'
import { ErroRpc } from '@/lib/erros'
import { dataHora } from '@/lib/format'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ErroConsulta } from '@/components/app/Consulta'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { Campo } from '@/components/Campo'
import { Carregando } from '@/components/Estados'
import { codigoTotp, codigoTotpValido, etapaMfa, type FatorResumo, fatoresPendentes, podeRemover } from '../seguranca'

const esquemaCodigo = z.object({ codigo: z.string().refine(codigoTotpValido, 'Informe os 6 dígitos do aplicativo') })
type FormCodigo = z.infer<typeof esquemaCodigo>

interface Cadastro { factorId: string; qr: string; segredo: string }

/** Mensagem do Auth em pt-BR (código errado é o caso comum). */
function mensagemMfa(e: unknown): string {
  const m = (e as { message?: string; code?: string } | null)?.message ?? ''
  const c = (e as { code?: string } | null)?.code ?? ''
  if (c === 'mfa_verification_failed' || /invalid.*code|verification failed/i.test(m)) return 'Código incorreto ou vencido. Confira o relógio do celular e tente de novo.'
  if (c === 'mfa_factor_name_conflict') return 'Já existe um autenticador com esse nome.'
  if (/aal2/i.test(m)) return 'Confirme a verificação em duas etapas nesta sessão antes de continuar.'
  return 'Não foi possível concluir agora. Tente de novo.'
}

/**
 * Verificação em duas etapas dos internos (TOTP do Supabase, H5). Abre mesmo com a sessão em aal1 (rota sem
 * permissão): com a 2FA exigida é por aqui que o interno conclui o cadastro ou confirma o código e libera o painel.
 */
export default function Seguranca() {
  const qc = useQueryClient()
  const { escopo } = useEscopo()
  const [cadastro, setCadastro] = useState<Cadastro | null>(null)
  const [preparando, setPreparando] = useState(false)
  const [remover, setRemover] = useState<FatorResumo | null>(null)

  const q = useQuery({
    queryKey: ['mfa-fatores'],
    queryFn: async () => {
      const [fatores, nivel] = await Promise.all([supabase.auth.mfa.listFactors(), supabase.auth.mfa.getAuthenticatorAssuranceLevel()])
      if (fatores.error) throw fatores.error
      if (nivel.error) throw nivel.error
      return { fatores: (fatores.data?.all ?? []) as FatorResumo[], aal: nivel.data?.currentLevel ?? 'aal1' }
    },
  })

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormCodigo>({
    resolver: zodResolver(esquemaCodigo), defaultValues: { codigo: '' },
  })

  const exigida = !!escopo?.mfa_exigido
  const atualizar = () => qc.invalidateQueries({ queryKey: ['mfa-fatores'] })

  async function iniciarCadastro() {
    setPreparando(true)
    try {
      // sobras de um cadastro interrompido atrapalham o novo (mesmo nome): remove antes
      for (const f of fatoresPendentes(q.data?.fatores ?? [])) await supabase.auth.mfa.unenroll({ factorId: f.id })
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Autenticador ${new Date().toLocaleDateString('pt-BR')}` })
      if (error || !data) throw error
      setCadastro({ factorId: data.id, qr: data.totp.qr_code, segredo: data.totp.secret })
      reset({ codigo: '' })
    } catch (e) {
      toast.error(mensagemMfa(e))
    } finally {
      setPreparando(false)
    }
  }

  async function confirmar(d: FormCodigo) {
    const fator = cadastro?.factorId ?? (q.data?.fatores ?? []).find((f) => f.factor_type === 'totp' && f.status === 'verified')?.id
    if (!fator) return
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator, code: codigoTotp(d.codigo) })
    if (error) return toast.error(mensagemMfa(error))
    // a sessão passa a aal2; o AuthProvider reconsulta o escopo sozinho (MFA_CHALLENGE_VERIFIED)
    toast.success(cadastro ? 'Verificação em duas etapas ativada.' : 'Código confirmado.')
    setCadastro(null)
    reset({ codigo: '' })
    await atualizar()
  }

  async function removerFator() {
    if (!remover) return
    const { error } = await supabase.auth.mfa.unenroll({ factorId: remover.id })
    if (error) throw new ErroRpc('DESCONHECIDO', mensagemMfa(error))
    toast.success('Autenticador removido.')
    await atualizar()
  }

  const etapa = q.data ? etapaMfa(q.data.fatores, q.data.aal) : null
  const confirmados = (q.data?.fatores ?? []).filter((f) => f.factor_type === 'totp' && f.status === 'verified')

  return (
    <>
      <CabecalhoPagina
        titulo="Segurança"
        subtitulo="Verificação em duas etapas com aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password…)."
      />

      <div className="card mb-6 flex flex-wrap items-center gap-3 p-5 text-sm">
        {exigida ? <ShieldAlert size={18} className="text-bronze" aria-hidden /> : <ShieldCheck size={18} className="text-sage" aria-hidden />}
        <span>
          {exigida
            ? 'A verificação em duas etapas é obrigatória para a equipe interna.'
            : 'A verificação em duas etapas ainda é opcional. Cadastre agora: quando ela passar a ser exigida, você não perde o acesso.'}
        </span>
        <SeloProvisorio codigo="H5" />
      </div>

      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card p-6">
            {etapa === 'ativa' && !cadastro && (
              <>
                <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={18} className="text-sage" aria-hidden /> Ativa nesta sessão</h2>
                <p className="mt-2 text-sm text-muted">Você entrou com a senha e o código do aplicativo.</p>
                <button type="button" className="btn-ghost mt-5" onClick={iniciarCadastro} disabled={preparando}>
                  <KeyRound size={16} aria-hidden /> {preparando ? 'Preparando…' : 'Cadastrar outro aplicativo'}
                </button>
              </>
            )}

            {etapa === 'cadastrar' && !cadastro && (
              <>
                <h2 className="text-lg font-semibold">Cadastre um aplicativo autenticador</h2>
                <p className="mt-2 text-sm text-muted">Você vai ler um QR code com o celular e digitar o código de 6 dígitos que ele mostrar.</p>
                <button type="button" className="btn-primary mt-5" onClick={iniciarCadastro} disabled={preparando}>
                  <KeyRound size={16} aria-hidden /> {preparando ? 'Preparando…' : 'Começar'}
                </button>
              </>
            )}

            {cadastro && (
              <>
                <h2 className="text-lg font-semibold">Leia o QR code</h2>
                <p className="mt-2 text-sm text-muted">No aplicativo, adicione uma conta e aponte a câmera. Sem câmera, digite a chave abaixo.</p>
                <img src={cadastro.qr} alt="QR code para o aplicativo autenticador" className="mt-4 h-48 w-48 bg-stone p-2" />
                <p className="mt-3 text-xs text-muted">Chave: <span className="break-all font-mono text-stone">{cadastro.segredo}</span></p>
              </>
            )}

            {(cadastro || etapa === 'confirmar_sessao') && (
              <form onSubmit={handleSubmit(confirmar)} className="mt-5 grid gap-4" noValidate>
                {etapa === 'confirmar_sessao' && !cadastro && (
                  <>
                    <h2 className="text-lg font-semibold">Confirme o código</h2>
                    <p className="-mt-2 text-sm text-muted">Digite o código atual do seu aplicativo autenticador para liberar o painel nesta sessão.</p>
                  </>
                )}
                <Campo label="Código do aplicativo" obrigatorio erro={errors.codigo?.message}>
                  <input className="input font-mono tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={7} {...register('codigo')} />
                </Campo>
                <div className="flex flex-wrap gap-3">
                  <button className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Confirmando…' : 'Confirmar'}</button>
                  {cadastro && <button type="button" className="btn-ghost" onClick={() => setCadastro(null)}>Cancelar</button>}
                </div>
              </form>
            )}
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-semibold">Seus autenticadores</h2>
            {confirmados.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nenhum autenticador cadastrado.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {confirmados.map((f) => {
                  const pode = podeRemover(q.data?.fatores ?? [], q.data?.aal, exigida)
                  return (
                    <li key={f.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span>
                        {f.friendly_name || 'Aplicativo autenticador'}
                        {f.created_at && <span className="block text-xs text-muted">Cadastrado em {dataHora(f.created_at)}</span>}
                      </span>
                      <button
                        type="button" className="inline-flex items-center gap-1 font-semibold text-bronze disabled:opacity-40"
                        disabled={!pode} onClick={() => setRemover(f)}
                        title={pode ? undefined : q.data?.aal !== 'aal2' ? 'Confirme o código nesta sessão para remover' : 'É o único autenticador e a verificação é obrigatória'}
                      >
                        <Trash2 size={15} aria-hidden /> Remover
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      <ConfirmarModal
        aberto={!!remover} titulo="Remover autenticador?" perigo rotuloConfirmar="Remover"
        texto="Depois de remover, o código desse aplicativo deixa de valer para entrar."
        aoConfirmar={removerFator} aoFechar={() => setRemover(null)}
      />
    </>
  )
}

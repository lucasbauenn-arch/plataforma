import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { configAtualizar } from '@/lib/rpc'
import { mensagemErro, traduzirErro, listaDoDetalhe } from '@/lib/erros'
import { mascaraCnpj } from '@/lib/format'
import { Consulta } from '@/components/app/Consulta'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Campo } from '@/components/Campo'
import type { ConfigAtualizacao, ConfiguracaoGeral } from './tipos'
import {
  CAMPOS_CONFIG, type CampoConfig, type FormConfig, formDaConfig, GRUPOS_CONFIG, mudancasDaConfig,
} from '@/modulos/governanca/configuracao'

const COLUNAS = [
  'id', 'imobiliaria_casa_id', 'gerente_casa_id', 'corretor_casa_id', 'exclusividade_dias', 'duplicidade_bloqueios_hora',
  'documentos_basicos', 'documento_max_bytes', 'portal_libera_pre_cadastro', 'vendedora_razao_social', 'vendedora_cnpj',
  'vendedora_endereco', 'prazo_assinatura_dias', 'imovel_fotos_max', 'imovel_foto_max_bytes', 'exigir_mfa_interno',
  'sessao_inatividade_horas', 'retencao_acesso_meses', 'retencao_operacao_meses', 'download_ttl_segundos', 'criado_em',
  'atualizado_em', 'atualizado_por',
].join(', ')

const chaveConfigGeral = ['config', 'geral'] as const

/** Configurações gerais (só o Super): `config_atualizar` recebe só o que mudou e audita antes e depois. */
export default function Geral() {
  const q = useQuery({
    queryKey: chaveConfigGeral,
    queryFn: async () => {
      const { data, error } = await supabase.from('configuracao_geral').select(COLUNAS).single()
      if (error) throw error
      return data as unknown as ConfiguracaoGeral
    },
  })
  return (
    <Consulta consulta={q} tituloVazio="Configuração indisponível">
      {(c) => <FormGeral atual={c} />}
    </Consulta>
  )
}

function FormGeral({ atual }: { atual: ConfiguracaoGeral }) {
  const qc = useQueryClient()
  const [pendente, setPendente] = useState<ConfigAtualizacao | null>(null)
  const esquema = useMemo(() => z.record(z.string(), z.union([z.string(), z.boolean()])).superRefine((v, ctx) => {
    const r = mudancasDaConfig(atual, v as FormConfig)
    if (!r.ok) for (const [chave, msg] of Object.entries(r.erros)) ctx.addIssue({ code: 'custom', path: [chave], message: msg })
  }), [atual])
  const { register, handleSubmit, reset, setValue, setError, formState: { errors, isSubmitting, isDirty } } = useForm<Record<string, string | boolean>>({
    resolver: zodResolver(esquema), defaultValues: formDaConfig(atual),
  })
  useEffect(() => { reset(formDaConfig(atual)) }, [atual, reset])

  /** Grava e recarrega; o erro sobe para quem chamou (o formulário ou o modal de confirmação mostram). */
  async function salvar(mudancas: ConfigAtualizacao) {
    await configAtualizar({ p: mudancas })
    toast.success('Configurações salvas.')
    await qc.invalidateQueries({ queryKey: chaveConfigGeral })
  }

  async function enviar(v: Record<string, string | boolean>) {
    const r = mudancasDaConfig(atual, v as FormConfig)
    if (!r.ok) return
    if (Object.keys(r.mudancas).length === 0) return toast('Nada mudou.')
    // ligar a 2FA obrigatória dos internos pede confirmação explícita
    if (r.mudancas.exigir_mfa_interno === true) return setPendente(r.mudancas)
    try {
      await salvar(r.mudancas)
    } catch (e) {
      const erro = traduzirErro(e, 'config_atualizar')
      const campos = listaDoDetalhe(erro, 'campos')
      for (const campo of campos) setError(campo, { message: 'Valor recusado pelo servidor' })
      toast.error(campos.length ? 'Alguns valores foram recusados. Confira os campos destacados.' : mensagemErro(erro))
    }
  }

  const campoInput = (c: CampoConfig) => {
    const erro = errors[c.chave]?.message as string | undefined
    const selo = <SeloProvisorio campo={`configuracao_geral.${c.chave}`} />
    if (c.tipo === 'booleano') {
      return (
        <div key={c.chave} className="sm:col-span-2">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 accent-bronze" {...register(c.chave)} />
            <span>
              <span className="font-medium">{c.rotulo}</span> {selo}
              {c.ajuda && <span className="block text-xs text-muted">{c.ajuda}</span>}
            </span>
          </label>
        </div>
      )
    }
    return (
      <div key={c.chave} className={c.tipo === 'lista' || c.chave === 'vendedora_endereco' ? 'sm:col-span-2' : undefined}>
        <Campo label={c.rotulo} erro={erro} obrigatorio={!c.opcional}>
          {c.tipo === 'lista' ? (
            <textarea className="input" rows={5} {...register(c.chave)} />
          ) : c.tipo === 'cnpj' ? (
            <input className="input" inputMode="numeric" {...register(c.chave, { onChange: (e) => setValue(c.chave, mascaraCnpj(e.target.value), { shouldDirty: true }) })} />
          ) : (
            <input className="input" inputMode={c.tipo === 'texto' ? undefined : 'decimal'} {...register(c.chave)} />
          )}
        </Campo>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">{selo}{c.ajuda && <span>{c.ajuda}</span>}</div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(enviar)} noValidate className="grid gap-8" aria-label="Configurações gerais">
      {GRUPOS_CONFIG.map((g) => (
        <fieldset key={g} className="card p-6">
          <legend className="px-2 text-sm font-semibold uppercase tracking-wider text-muted">{g}</legend>
          <div className="grid gap-5 sm:grid-cols-2">{CAMPOS_CONFIG.filter((c) => c.grupo === g).map(campoInput)}</div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={isSubmitting || !isDirty}><Save size={16} aria-hidden /> {isSubmitting ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className="btn-ghost" disabled={isSubmitting || !isDirty} onClick={() => reset(formDaConfig(atual))}>Descartar</button>
        <span className="text-xs text-muted">Cada alteração fica na auditoria, com o valor anterior e o novo.</span>
      </div>

      <ConfirmarModal
        aberto={!!pendente} titulo="Exigir a verificação em duas etapas?" rotuloConfirmar="Exigir agora" perigo
        texto="Todo admin e Super sem o autenticador cadastrado perde o acesso ao painel até concluir o cadastro em Segurança. A sua sessão precisa estar confirmada com o código (verificação concluída nesta sessão)."
        aoConfirmar={() => salvar(pendente!)} aoFechar={() => setPendente(null)}
      />
    </form>
  )
}

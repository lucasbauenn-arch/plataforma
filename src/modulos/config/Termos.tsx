import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { AlertTriangle, FilePlus2, ScrollText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { lgpdPublicarTermo } from '@/lib/rpc'
import { dataHora } from '@/lib/format'
import { Consulta } from '@/components/app/Consulta'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Etiqueta } from '@/components/app/Etiqueta'
import { Campo } from '@/components/Campo'
import type { TipoTermo } from '@/lib/types'

const CHAVE = ['config', 'termos'] as const

const TIPOS: { id: TipoTermo; rotulo: string; efeito: string }[] = [
  {
    id: 'consentimento_cliente', rotulo: 'Consentimento do cliente (LGPD)',
    efeito: 'Aceito no pré-cadastro por link e no portal. Sem uma versão revisada pelo jurídico, o pré-cadastro público não abre (H4).',
  },
  {
    id: 'termos_parceiro', rotulo: 'Termos de uso do parceiro',
    efeito: 'Uma versão nova faz todo parceiro aceitar de novo: o painel dele só abre "Meu cadastro" até o aceite.',
  },
]

interface Termo { id: string; tipo: TipoTermo; versao: string; texto: string; vigente_desde: string; revisado_juridico: boolean; criado_em: string }

const esquema = z.object({
  tipo: z.enum(['consentimento_cliente', 'termos_parceiro']),
  versao: z.string().trim().min(1, 'Informe a versão').max(40, 'Até 40 caracteres').regex(/^[^\p{Cc}]+$/u, 'Versão inválida'),
  texto: z.string().trim().min(20, 'Texto muito curto').max(200_000, 'Texto muito longo'),
  revisado_juridico: z.boolean(),
})
type Form = z.infer<typeof esquema>

/**
 * Termos LGPD versionados (lgpd_termos, somente inclusão; §5.4, H4): a vigente é a mais recente de cada tipo. Publicar
 * cria uma versão nova (nunca edita a anterior) e fica na auditoria. A revogação de um consentimento é feita na tela de
 * Anonimização, a partir do cliente.
 */
export default function Termos() {
  const qc = useQueryClient()
  const [confirmar, setConfirmar] = useState<Form | null>(null)
  const q = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await supabase.from('lgpd_termos')
        .select('id, tipo, versao, texto, vigente_desde, revisado_juridico, criado_em')
        .order('vigente_desde', { ascending: false }).order('criado_em', { ascending: false })
      if (error) throw error
      return (data ?? []) as Termo[]
    },
  })
  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(esquema), defaultValues: { tipo: 'consentimento_cliente', versao: '', texto: '', revisado_juridico: false },
  })
  const tipoEscolhido = useWatch({ control, name: 'tipo' })

  async function publicar(v: Form) {
    await lgpdPublicarTermo({ p_tipo: v.tipo, p_versao: v.versao.trim(), p_texto: v.texto.trim(), p_revisado_juridico: v.revisado_juridico })
    toast.success('Nova versão publicada e vigente.')
    reset({ tipo: v.tipo, versao: '', texto: '', revisado_juridico: false })
    await qc.invalidateQueries({ queryKey: CHAVE })
  }

  return (
    <div className="grid gap-10">
      <Consulta consulta={q} tituloVazio="Nenhum termo cadastrado">
        {(termos) => (
          <div className="grid gap-6 lg:grid-cols-2">
            {TIPOS.map((t) => {
              const versoes = termos.filter((x) => x.tipo === t.id)
              const vigente = versoes[0]
              return (
                <section key={t.id} className="card p-6" aria-labelledby={`termo-${t.id}`}>
                  <h3 id={`termo-${t.id}`} className="flex flex-wrap items-center gap-2 font-semibold">
                    <ScrollText size={18} className="text-bronze" aria-hidden /> {t.rotulo} <SeloProvisorio codigo="H4" />
                  </h3>
                  <p className="mt-1 text-xs text-muted">{t.efeito}</p>
                  {vigente ? (
                    <>
                      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                        Vigente: <strong>{vigente.versao}</strong> desde {dataHora(vigente.vigente_desde)}
                        {vigente.revisado_juridico ? <Etiqueta tom="ok">Revisado pelo jurídico</Etiqueta> : <Etiqueta tom="alerta">Sem revisão jurídica</Etiqueta>}
                      </p>
                      {!vigente.revisado_juridico && t.id === 'consentimento_cliente' && (
                        <p className="mt-2 flex items-start gap-2 text-xs text-bronze"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> O pré-cadastro público fica fechado até publicar uma versão revisada.</p>
                      )}
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer text-muted">Ver o texto vigente</summary>
                        <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap border border-line bg-ink p-3 text-xs text-stone/85">{vigente.texto}</div>
                      </details>
                      {versoes.length > 1 && (
                        <details className="mt-2 text-sm">
                          <summary className="cursor-pointer text-muted">Versões anteriores ({versoes.length - 1})</summary>
                          <ul className="mt-2 grid gap-1 text-xs text-muted">
                            {versoes.slice(1).map((v) => <li key={v.id}>{v.versao} · desde {dataHora(v.vigente_desde)}{v.revisado_juridico ? ' · revisada' : ''}</li>)}
                          </ul>
                        </details>
                      )}
                    </>
                  ) : <p className="mt-4 text-sm text-muted">Nenhuma versão publicada.</p>}
                </section>
              )
            })}
          </div>
        )}
      </Consulta>

      <form onSubmit={handleSubmit((v) => setConfirmar(v))} className="card grid gap-4 p-6" noValidate aria-labelledby="termo-novo">
        <h3 id="termo-novo" className="flex items-center gap-2 font-semibold"><FilePlus2 size={18} className="text-bronze" aria-hidden /> Publicar nova versão</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Termo" obrigatorio erro={errors.tipo?.message}>
            <select className="input" {...register('tipo')}>
              {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
            </select>
          </Campo>
          <Campo label="Versão" obrigatorio erro={errors.versao?.message}>
            <input className="input" placeholder="ex.: 1.0 (2026-10)" {...register('versao')} />
          </Campo>
        </div>
        <Campo label="Texto" obrigatorio erro={errors.texto?.message}>
          <textarea className="input font-mono text-xs" rows={12} {...register('texto')} />
        </Campo>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 accent-bronze" {...register('revisado_juridico')} />
          <span>Texto revisado e aprovado pelo jurídico</span>
        </label>
        <p className="text-xs text-muted">{TIPOS.find((t) => t.id === tipoEscolhido)?.efeito}</p>
        <button className="btn-primary justify-self-start" disabled={isSubmitting}>Publicar</button>
      </form>

      <ConfirmarModal
        aberto={!!confirmar} titulo="Publicar nova versão?" rotuloConfirmar="Publicar"
        texto={confirmar && (
          <>A versão <strong>{confirmar.versao}</strong> passa a valer agora e não pode ser editada depois. {TIPOS.find((t) => t.id === confirmar.tipo)?.efeito}</>
        )}
        aoConfirmar={() => publicar(confirmar!)} aoFechar={() => setConfirmar(null)}
      />
    </div>
  )
}

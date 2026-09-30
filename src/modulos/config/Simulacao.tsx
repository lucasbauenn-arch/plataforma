import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { configPublicarParametros } from '@/lib/rpc'
import { listaDoDetalhe, traduzirErro } from '@/lib/erros'
import { brlCentavos, dataHora, percentual } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { CampoMoeda } from '@/components/app/CampoMoeda'
import { Consulta } from '@/components/app/Consulta'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { Tabela } from '@/components/app/Tabela'
import { chavesContratos } from '@/modulos/contratos/api'
import { lerPercentual, percentualParaTexto } from '@/modulos/contratos/simulacao-form'
import type { ParametrosPublicacao, ParametrosSimulacao } from './tipos'

const chaveParametros = ['config', 'parametros-simulacao'] as const

const pct = (obrigatorio: boolean, minimo = 0) => z.string().trim().refine((v) => {
  if (!v) return !obrigatorio
  const n = lerPercentual(v.replace(/^-/, ''))
  return n != null && (v.startsWith('-') ? -n : n) >= minimo && n <= 100
}, 'Percentual entre 0 e 100, com até 4 casas.')
const inteiro = z.string().trim().regex(/^\d{1,3}$/, 'Número inteiro.')

const esquema = z.object({
  taxa_aporte_proprio: pct(true),
  taxa_financeiro: pct(false),
  juros_ao_mes: pct(false),
  igpm_atual: pct(false, -100),
  parcela_minima: inteiro,
  parcela_maxima: inteiro,
  valor_minimo: z.number().positive('Maior que zero.').nullable(),
  valor_minimo_flex: z.number().positive('Maior que zero.').nullable(),
}).superRefine((v, ctx) => {
  const min = Number(v.parcela_minima)
  const max = Number(v.parcela_maxima)
  if (min < 1) ctx.addIssue({ code: 'custom', path: ['parcela_minima'], message: 'No mínimo 1.' })
  if (max > 600) ctx.addIssue({ code: 'custom', path: ['parcela_maxima'], message: 'No máximo 600.' })
  if (max < min) ctx.addIssue({ code: 'custom', path: ['parcela_maxima'], message: 'Não pode ser menor que a mínima.' })
})
type Form = z.infer<typeof esquema>

const numeroPct = (v: string) => {
  if (!v.trim()) return null
  const neg = v.trim().startsWith('-')
  const n = lerPercentual(v.trim().replace(/^-/, ''))
  return n == null ? null : neg ? -n : n
}

function paraPublicacao(f: Form): ParametrosPublicacao {
  return {
    taxa_aporte_proprio: numeroPct(f.taxa_aporte_proprio) ?? 0,
    taxa_financeiro: numeroPct(f.taxa_financeiro), juros_ao_mes: numeroPct(f.juros_ao_mes), igpm_atual: numeroPct(f.igpm_atual),
    parcela_minima: Number(f.parcela_minima), parcela_maxima: Number(f.parcela_maxima),
    valor_minimo: f.valor_minimo, valor_minimo_flex: f.valor_minimo_flex,
  }
}

/** Super: nova versão de parametros_simulacao (config_publicar_parametros). Versões antigas ficam como histórico. */
export default function Simulacao() {
  const q = useQuery({
    queryKey: chaveParametros,
    queryFn: async () => {
      const { data, error } = await supabase.from('parametros_simulacao').select('*')
        .order('vigente_desde', { ascending: false }).order('criado_em', { ascending: false })
      if (error) throw traduzirErro(error)
      return (data ?? []) as ParametrosSimulacao[]
    },
  })
  return (
    <Consulta consulta={q} tituloVazio="Nenhuma versão de parâmetros">
      {(versoes) => <Parametros versoes={versoes} />}
    </Consulta>
  )
}

function Parametros({ versoes }: { versoes: ParametrosSimulacao[] }) {
  const qc = useQueryClient()
  const vigente = versoes.find((v) => new Date(v.vigente_desde) <= new Date()) ?? versoes[0]
  const [pendente, setPendente] = useState<ParametrosPublicacao | null>(null)
  const { register, control, handleSubmit, setError, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(esquema),
    defaultValues: {
      taxa_aporte_proprio: percentualParaTexto(vigente?.taxa_aporte_proprio), taxa_financeiro: percentualParaTexto(vigente?.taxa_financeiro),
      juros_ao_mes: percentualParaTexto(vigente?.juros_ao_mes), igpm_atual: percentualParaTexto(vigente?.igpm_atual),
      parcela_minima: String(vigente?.parcela_minima ?? 12), parcela_maxima: String(vigente?.parcela_maxima ?? 360),
      valor_minimo: vigente?.valor_minimo ?? null, valor_minimo_flex: vigente?.valor_minimo_flex ?? null,
    },
  })

  async function publicar(p: ParametrosPublicacao) {
    try {
      await configPublicarParametros({ p })
    } catch (e) {
      for (const c of listaDoDetalhe(traduzirErro(e), 'campos')) setError(c as keyof Form, { message: 'Valor recusado pelo servidor' })
      throw e
    }
    toast.success('Nova versão dos parâmetros publicada. Vale para as próximas simulações.')
    await qc.invalidateQueries({ queryKey: chaveParametros })
    await qc.invalidateQueries({ queryKey: chavesContratos.parametros })
  }

  const campoPct = (nome: keyof Form, rotulo: string, obrigatorio = false, ajuda?: string) => (
    <Campo label={rotulo} obrigatorio={obrigatorio} erro={errors[nome]?.message}>
      <input className="input" inputMode="decimal" placeholder="%" {...register(nome as 'taxa_aporte_proprio')} />
      {ajuda && <span className="mt-1 block text-xs text-muted">{ajuda}</span>}
    </Campo>
  )

  return (
    <div className="grid gap-8">
      {vigente && (
        <section className="card p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold">Versão vigente</h3>
            <SeloProvisorio codigo="N14" />
            <span className="text-xs text-muted">desde {dataHora(vigente.vigente_desde)}</span>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted">Taxa do aporte próprio</dt><dd className="font-medium">{percentual(vigente.taxa_aporte_proprio, 4)}</dd></div>
            <div><dt className="text-muted">Parcelas</dt><dd className="font-medium">de {vigente.parcela_minima} a {vigente.parcela_maxima}</dd></div>
            <div><dt className="text-muted">Valor mínimo do produto</dt><dd className="font-medium">{vigente.valor_minimo == null ? 'sem mínimo' : brlCentavos(vigente.valor_minimo)}</dd></div>
            <div>
              <dt className="text-muted">Mínimo por pagamento (flexível)</dt>
              <dd className="font-medium">{vigente.valor_minimo_flex == null ? 'não configurado: plano flexível bloqueado' : brlCentavos(vigente.valor_minimo_flex)}</dd>
            </div>
          </dl>
        </section>
      )}

      <form onSubmit={handleSubmit((f) => setPendente(paraPublicacao(f)))} noValidate className="card grid gap-5 p-6" aria-label="Publicar nova versão dos parâmetros">
        <div>
          <h3 className="text-lg font-semibold">Publicar nova versão</h3>
          <p className="mt-1 text-sm text-muted">
            Vale a partir de agora para simulações e contratos novos. Contratos já criados guardam a versão que usaram.
            Percentuais na unidade % (8,5 = 8,5%).
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {campoPct('taxa_aporte_proprio', 'Taxa do aporte próprio (%)', true, 'Entra no cálculo da parcela (FIN-2).')}
          <Campo label="Parcelas: mínimo" obrigatorio erro={errors.parcela_minima?.message}>
            <input className="input" inputMode="numeric" {...register('parcela_minima')} />
          </Campo>
          <Campo label="Parcelas: máximo" obrigatorio erro={errors.parcela_maxima?.message}>
            <input className="input" inputMode="numeric" {...register('parcela_maxima')} />
          </Campo>
          <Campo label="Valor mínimo do produto" erro={errors.valor_minimo?.message}>
            <Controller control={control} name="valor_minimo" render={({ field }) => <CampoMoeda valor={field.value} aoMudar={field.onChange} placeholder="sem mínimo" />} />
          </Campo>
          <Campo label="Mínimo por pagamento (plano flexível)" erro={errors.valor_minimo_flex?.message}>
            <Controller control={control} name="valor_minimo_flex" render={({ field }) => <CampoMoeda valor={field.value} aoMudar={field.onChange} placeholder="vazio = flexível bloqueado" />} />
          </Campo>
          {campoPct('taxa_financeiro', 'Taxa financeira (%)', false, 'Só guardada; fora do cálculo nesta etapa.')}
          {campoPct('juros_ao_mes', 'Juros ao mês (%)', false, 'Só guardado; fora do cálculo nesta etapa.')}
          {campoPct('igpm_atual', 'IGP-M atual (%)', false, 'Só guardado; fora do cálculo nesta etapa.')}
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary"><Upload size={16} aria-hidden /> Publicar nova versão</button>
        </div>
      </form>

      <section>
        <h3 className="mb-3 text-lg font-semibold">Histórico de versões</h3>
        <Tabela legenda="Versões dos parâmetros" colunas={['Vigente desde', 'Taxa', 'Parcelas', 'Mínimo', 'Mínimo flexível']} minimo={560}>
          {versoes.map((v) => (
            <tr key={v.id} className={v.id === vigente?.id ? 'bg-sand/40' : undefined}>
              <td>{dataHora(v.vigente_desde)}{v.id === vigente?.id ? ' (vigente)' : ''}</td>
              <td>{percentual(v.taxa_aporte_proprio, 4)}</td>
              <td>{v.parcela_minima}–{v.parcela_maxima}</td>
              <td>{v.valor_minimo == null ? '—' : brlCentavos(v.valor_minimo)}</td>
              <td>{v.valor_minimo_flex == null ? '—' : brlCentavos(v.valor_minimo_flex)}</td>
            </tr>
          ))}
        </Tabela>
      </section>

      <ConfirmarModal
        aberto={!!pendente} aoFechar={() => setPendente(null)} titulo="Publicar nova versão dos parâmetros"
        texto="As próximas simulações e contratos usam os valores novos. Esta publicação fica registrada na auditoria e não pode ser apagada."
        rotuloConfirmar="Publicar"
        aoConfirmar={async () => { if (pendente) await publicar(pendente) }}
      />
    </div>
  )
}

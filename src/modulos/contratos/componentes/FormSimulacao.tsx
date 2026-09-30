import { useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { mensagemErro } from '@/lib/erros'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { FORMAS_PAGAMENTO } from '@/lib/constants'
import { Campo } from '@/components/Campo'
import { CampoMoeda } from '@/components/app/CampoMoeda'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { ErroConsulta } from '@/components/app/Consulta'
import { chavesContratos, parametrosVigentes } from '../api'
import { motivoSimulacao } from '../rotulos'
import {
  escolhasDoForm, esquemaSimulacao, percentualParaTexto, previaSimulacao, type EscolhasSimulacao, type FormSimulacao as Form,
} from '../simulacao-form'
import { ValoresSimulacao } from './ValoresSimulacao'

/**
 * Escolhas da simulação (forma, % de aporte, entrada, nº de parcelas) com a PRÉVIA instantânea no navegador
 * (@shared/simulacao, o mesmo cálculo do servidor). "Salvar" manda só as escolhas; os valores oficiais são os que o
 * servidor devolve (FIN-1/FIN-2, SEG-4).
 */
export function FormSimulacao({ valorProduto, inicial, rotuloSalvar, aoSalvar, desabilitado, extra }: {
  /** Valor de tabela do produto (referência para a prévia); nulo = sem produto escolhido. */
  valorProduto: number | null | undefined
  inicial?: EscolhasSimulacao
  rotuloSalvar: string
  aoSalvar: (e: EscolhasSimulacao) => Promise<unknown>
  desabilitado?: boolean
  /** Conteúdo acima do botão (ex.: aviso de produto obrigatório). */
  extra?: ReactNode
}) {
  const par = useQuery({ queryKey: chavesContratos.parametros, queryFn: parametrosVigentes, staleTime: 60_000 })
  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(esquemaSimulacao),
    defaultValues: {
      forma: inicial?.forma ?? 'parcelado',
      perc_aporte: percentualParaTexto(inicial?.perc_aporte ?? 30),
      entrada: inicial?.entrada ?? 0,
      n_parcelas: inicial?.n_parcelas != null ? String(inicial.n_parcelas) : '60',
    },
  })
  const atual = useWatch({ control }) as Form
  const escolhas = useMemo(() => escolhasDoForm({
    forma: atual.forma ?? 'parcelado', perc_aporte: atual.perc_aporte ?? '', entrada: atual.entrada ?? null, n_parcelas: atual.n_parcelas ?? '',
  }), [atual.forma, atual.perc_aporte, atual.entrada, atual.n_parcelas])
  const previa = valorProduto == null ? null : previaSimulacao(valorProduto, escolhas, par.data ?? null)
  const p = par.data

  return (
    <form onSubmit={handleSubmit(async (f) => { try { await aoSalvar(escolhasDoForm(f)) } catch (e) { toast.error(mensagemErro(e)) } })} noValidate className="grid gap-5" aria-label="Simulação">
      <fieldset className="grid gap-5 sm:grid-cols-2" disabled={desabilitado || isSubmitting}>
        <Campo label="Forma de pagamento" obrigatorio erro={errors.forma?.message}>
          <select className="input" {...register('forma')}>
            {(Object.keys(FORMAS_PAGAMENTO) as (keyof typeof FORMAS_PAGAMENTO)[]).map((f) => (
              <option key={f} value={f}>{FORMAS_PAGAMENTO[f]}</option>
            ))}
          </select>
        </Campo>
        <Campo label="% de aporte próprio" obrigatorio erro={errors.perc_aporte?.message}>
          <input className="input" inputMode="decimal" placeholder="30" {...register('perc_aporte')} />
        </Campo>
        <Campo label="Entrada" erro={errors.entrada?.message}>
          <Controller control={control} name="entrada" render={({ field }) => (
            <CampoMoeda valor={field.value} aoMudar={field.onChange} invalido={!!errors.entrada} />
          )} />
        </Campo>
        {atual.forma !== 'flexivel' && (
          <Campo label="Número de parcelas" obrigatorio erro={errors.n_parcelas?.message}>
            <input className="input" inputMode="numeric" {...register('n_parcelas')} />
            {p && <span className="mt-1 block text-xs text-muted">Entre {p.parcela_minima} e {p.parcela_maxima} parcelas.</span>}
          </Campo>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        Parâmetros da simulação: taxa de {p ? `${String(p.taxa_aporte_proprio).replace('.', ',')}%` : '—'} <SeloProvisorio codigo="N14" />
      </div>

      <section className="border border-dashed border-line p-4" aria-live="polite">
        <p className="eyebrow mb-3">Prévia <span className="normal-case tracking-normal text-muted">— valores oficiais vêm do servidor ao salvar</span></p>
        {par.error ? <ErroConsulta erro={par.error} tentarDeNovo={par.refetch} />
          : par.isSuccess && !p ? <p className="text-sm text-bronze">Parâmetros de simulação não configurados. Fale com a equipe Arken.</p>
          : valorProduto == null ? <p className="text-sm text-muted">Escolha o produto para ver a prévia.</p>
          : !previa ? <p className="text-sm text-muted">Carregando os parâmetros…</p>
            : previa.ok ? <ValoresSimulacao v={previa.valores} rotulo="Prévia da simulação" />
              : <ul className="list-disc space-y-1 pl-5 text-sm text-bronze">{previa.motivos.map((m) => <li key={m}>{motivoSimulacao(m)}</li>)}</ul>}
      </section>

      {extra}
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={desabilitado || isSubmitting}>{isSubmitting ? 'Aguarde…' : rotuloSalvar}</button>
      </div>
    </form>
  )
}

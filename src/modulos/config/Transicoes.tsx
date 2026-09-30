import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { ArrowRight, Cpu, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensagemErro, traduzirErro } from '@/lib/erros'
import { Consulta } from '@/components/app/Consulta'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { Etiqueta } from '@/components/app/Etiqueta'
import type { Papel } from '@/lib/types'
import type { StatusTransicao } from './tipos'
import {
  ENTIDADES, linhasDaEntidade, papeisPermitidos, rotuloEfeito, rotuloPapel, rotuloStatus, rotuloValidacao, soDoSistema,
} from '@/modulos/governanca/transicoes'

const CHAVE = ['config', 'transicoes'] as const

/**
 * Transições de status (status_transicoes, §3.8; F1, F2, E2, N13): o Super liga ou desliga cada transição, escolhe os
 * papéis que acionam e se exige motivo. Validações e efeitos são fixos. O banco recusa (23514) o que não pode:
 * colaborador, cliente fora do envio de documento e papéis nas transições do D4Sign.
 */
export default function Transicoes() {
  const q = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await supabase.from('status_transicoes')
        .select('entidade, de, para, papeis, permite_criador, sistema, exige_motivo, validacoes, efeitos, ativa, atualizado_em, atualizado_por')
      if (error) throw error
      return (data ?? []) as StatusTransicao[]
    },
  })
  return (
    <Consulta consulta={q} tituloVazio="Nenhuma transição cadastrada">
      {(ts) => (
        <div className="grid gap-10">
          <p className="max-w-3xl text-sm text-muted">
            Cada linha é uma mudança de status permitida. Desligar uma linha impede a mudança para todos; os papéis dizem quem aciona
            manualmente. As linhas do sistema (assinatura e imóvel no contrato) acontecem sozinhas.
          </p>
          {ENTIDADES.map((e) => {
            const linhas = linhasDaEntidade(ts, e.id)
            if (!linhas.length) return null
            return (
              <section key={e.id} aria-labelledby={`trans-${e.id}`}>
                <h3 id={`trans-${e.id}`} className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
                  {e.rotulo} <SeloProvisorio campo={`status_transicoes.${e.id}`} />
                </h3>
                <ul className="grid gap-3">
                  {linhas.map((t) => <LinhaTransicao key={`${t.de}>${t.para}`} t={t} />)}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </Consulta>
  )
}

const esquema = z.object({ papeis: z.array(z.string()), exige_motivo: z.boolean(), ativa: z.boolean() })
type Form = z.infer<typeof esquema>

function LinhaTransicao({ t }: { t: StatusTransicao }) {
  const qc = useQueryClient()
  const permitidos = papeisPermitidos(t)
  const sistema = soDoSistema(t)
  const { register, handleSubmit, reset, formState: { isDirty, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(esquema),
    values: { papeis: t.papeis.filter((p) => permitidos.includes(p)), exige_motivo: t.exige_motivo, ativa: t.ativa },
  })

  async function salvar(v: Form) {
    const { data, error } = await supabase.from('status_transicoes')
      .update({ papeis: v.papeis as Papel[], exige_motivo: v.exige_motivo, ativa: v.ativa })
      .eq('entidade', t.entidade).eq('de', t.de).eq('para', t.para).select('entidade')
    if (error) return toast.error(mensagemErro(traduzirErro(error)))
    if (!data?.length) return toast.error('Sem permissão para alterar esta transição.')
    toast.success('Transição atualizada.')
    await qc.invalidateQueries({ queryKey: CHAVE })
    reset(v)
  }

  const idBase = `t-${t.entidade}-${t.de}-${t.para}`
  return (
    <li className="card p-4">
      <form onSubmit={handleSubmit(salvar)} className="grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_2fr_auto] lg:items-start" aria-label={`Transição ${rotuloStatus(t.entidade, t.de)} para ${rotuloStatus(t.entidade, t.para)}`}>
        <div>
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {rotuloStatus(t.entidade, t.de)} <ArrowRight size={14} aria-hidden className="text-muted" /> {rotuloStatus(t.entidade, t.para)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.sistema && <Etiqueta tom="neutro" titulo="O sistema também aciona"><Cpu size={11} className="mr-1 inline" aria-hidden />Sistema</Etiqueta>}
            {t.permite_criador && <Etiqueta tom="neutro">Criador do imóvel</Etiqueta>}
          </div>
          {(t.validacoes.length > 0 || t.efeitos.length > 0) && (
            <p className="mt-2 text-xs text-muted">
              {t.validacoes.length > 0 && <>Exige: {t.validacoes.map(rotuloValidacao).join(', ')}. </>}
              {t.efeitos.length > 0 && <>Efeito: {t.efeitos.map(rotuloEfeito).join(', ')}.</>}
            </p>
          )}
        </div>

        <fieldset className="grid gap-2">
          <legend className="sr-only">Quem aciona</legend>
          {sistema ? (
            <p className="text-sm text-muted">Só o sistema (depende da assinatura eletrônica ou do envio do contrato).</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {permitidos.map((p) => (
                <label key={p} htmlFor={`${idBase}-${p}`} className="flex items-center gap-1.5 text-sm">
                  <input id={`${idBase}-${p}`} type="checkbox" value={p} className="accent-bronze" {...register('papeis')} /> {rotuloPapel(p)}
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-bronze" {...register('exige_motivo')} /> Exige motivo</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-bronze" {...register('ativa')} /> Ativa</label>
          </div>
        </fieldset>

        <button className="btn-ghost justify-self-start px-4 py-2" disabled={!isDirty || isSubmitting}>
          <Save size={15} aria-hidden /> {isSubmitting ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </li>
  )
}

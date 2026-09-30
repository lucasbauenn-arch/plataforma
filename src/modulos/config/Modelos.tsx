import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, CircleAlert, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { configLiberarModelo, configPublicarModelo } from '@/lib/rpc'
import { mensagemErro, traduzirErro } from '@/lib/erros'
import { MODELOS_CONTRATO } from '@/lib/constants'
import { dataHora } from '@/lib/format'
import type { ModeloChave } from '@/lib/types'
import {
  DADOS_EXEMPLO, renderizarModelo, ROTULOS_VARIAVEIS, validarModelo, VARIAVEIS_MODELO, type NomeVariavel,
} from '@shared/modelo-contrato'
import { Campo } from '@/components/Campo'
import { Abas } from '@/components/app/Abas'
import { Consulta } from '@/components/app/Consulta'
import { Etiqueta } from '@/components/app/Etiqueta'
import { Modal } from '@/components/app/Modal'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { BlocosContrato } from '@/modulos/contratos/componentes/BlocosContrato'
import type { ContratoModelo } from './tipos'

const chaveModelos = ['config', 'modelos'] as const
const CHAVES = Object.keys(MODELOS_CONTRATO) as ModeloChave[]
const DE_SERVICO: ModeloChave[] = ['servico_corretor', 'servico_imobiliaria']

const esquema = z.object({
  titulo: z.string().trim().min(3, 'Mínimo de 3 caracteres.').max(200, 'Máximo de 200 caracteres.'),
  conteudo: z.string().refine((v) => v.trim().length >= 20, 'Mínimo de 20 caracteres.').refine((v) => v.length <= 200000, 'Texto grande demais.'),
})
type Form = z.infer<typeof esquema>

/**
 * Super: modelos de contrato em marcação restrita (§6.3, nunca HTML). Editor com paleta de variáveis e prévia com dados
 * de exemplo; "Publicar nova versão" (config_publicar_modelo) e "Liberar para envio" (config_liberar_modelo, que
 * registra a revisão jurídica). Versões são somente inclusão.
 */
export default function Modelos() {
  const q = useQuery({
    queryKey: chaveModelos,
    queryFn: async () => {
      const { data, error } = await supabase.from('contrato_modelos')
        .select('id, chave, versao, titulo, conteudo, variaveis, revisado_juridico, liberado_para_envio, liberado_por, liberado_em, publicado_em, publicado_por')
        .order('chave').order('versao', { ascending: false })
      if (error) throw traduzirErro(error)
      return (data ?? []) as ContratoModelo[]
    },
  })
  const [chave, setChave] = useState<ModeloChave>('parcelado')
  return (
    <div className="grid gap-6">
      <Abas abas={CHAVES.map((c) => ({ id: c, rotulo: MODELOS_CONTRATO[c] }))} ativa={chave} aoMudar={setChave} rotulo="Modelos de contrato" />
      <Consulta consulta={q}>
        {(modelos) => <EditorModelo key={chave} chave={chave} versoes={modelos.filter((m) => m.chave === chave)} />}
      </Consulta>
    </div>
  )
}

function EditorModelo({ chave, versoes }: { chave: ModeloChave; versoes: ContratoModelo[] }) {
  const qc = useQueryClient()
  const vigente = versoes[0] ?? null
  const [liberar, setLiberar] = useState(false)
  const texto = useRef<HTMLTextAreaElement | null>(null)
  const { register, handleSubmit, control, setValue, getValues, reset, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(esquema), defaultValues: { titulo: vigente?.titulo ?? '', conteudo: vigente?.conteudo ?? '' },
  })
  // só quando a versão vigente muda (publicação): uma nova consulta em segundo plano não apaga o que está sendo editado
  const versaoCarregada = useRef(vigente?.id)
  useEffect(() => {
    if (versaoCarregada.current === vigente?.id) return
    versaoCarregada.current = vigente?.id
    reset({ titulo: vigente?.titulo ?? '', conteudo: vigente?.conteudo ?? '' })
  }, [vigente, reset])
  const conteudo = useWatch({ control, name: 'conteudo' }) ?? ''
  const validacao = useMemo(() => validarModelo(conteudo), [conteudo])
  const previa = useMemo(() => renderizarModelo(conteudo, DADOS_EXEMPLO), [conteudo])
  const campoConteudo = register('conteudo')

  function inserir(v: NomeVariavel) {
    const el = texto.current
    const atual = getValues('conteudo')
    const ini = el?.selectionStart ?? atual.length
    const fim = el?.selectionEnd ?? atual.length
    const novo = `${atual.slice(0, ini)}{{${v}}}${atual.slice(fim)}`
    setValue('conteudo', novo, { shouldDirty: true, shouldValidate: true })
    requestAnimationFrame(() => {
      el?.focus()
      const pos = ini + v.length + 4
      el?.setSelectionRange(pos, pos)
    })
  }

  async function publicar(f: Form) {
    if (validacao.invalidas.length || validacao.chavesSemPar) {
      toast.error('Corrija as variáveis antes de publicar.')
      return
    }
    try {
      await configPublicarModelo({ p_chave: chave, p_titulo: f.titulo, p_conteudo: f.conteudo })
      toast.success('Nova versão publicada. Ela só vai para assinatura depois de liberada.')
      await qc.invalidateQueries({ queryKey: chaveModelos })
    } catch (e) {
      toast.error(mensagemErro(e))
    }
  }

  return (
    <div className="grid gap-6">
      {vigente && (
        <section className="card flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <p className="eyebrow">Versão vigente</p>
            <p className="mt-1 font-semibold">{vigente.titulo} · v{vigente.versao}</p>
            <p className="mt-1 text-xs text-muted">Publicada em {dataHora(vigente.publicado_em)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {DE_SERVICO.includes(chave)
              ? <Etiqueta>Só pré-visualização (D6)</Etiqueta>
              : vigente.liberado_para_envio
                ? <Etiqueta tom="ok">Liberado para envio · revisado pelo jurídico</Etiqueta>
                : <Etiqueta tom="alerta">Não liberado: nenhum envio para assinatura</Etiqueta>}
            {!DE_SERVICO.includes(chave) && !vigente.liberado_para_envio && (
              <button type="button" className="btn-primary" onClick={() => setLiberar(true)}>Liberar para envio</button>
            )}
          </div>
        </section>
      )}

      <form onSubmit={handleSubmit(publicar)} noValidate className="card grid gap-5 p-6" aria-label="Editor de modelo">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-semibold">Editar e publicar nova versão</h3>
          <SeloProvisorio codigo={DE_SERVICO.includes(chave) ? 'D6' : 'D2'} />
        </div>
        <Campo label="Título" obrigatorio erro={errors.titulo?.message}>
          <input className="input" {...register('titulo')} />
        </Campo>
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="grid content-start gap-3">
            <Campo label="Texto (marcação restrita)" obrigatorio erro={errors.conteudo?.message}>
              <textarea
                className="input min-h-[24rem] font-mono text-xs leading-relaxed" spellCheck={false}
                {...campoConteudo} ref={(el) => { campoConteudo.ref(el); texto.current = el }}
              />
            </Campo>
            <p className="text-xs text-muted">
              # título · ## subtítulo · ### seção · **negrito** · *itálico* · - item · 1. item numerado · --- nova página ·
              linha em branco separa parágrafos. HTML não é aceito.
            </p>
            {(validacao.invalidas.length > 0 || validacao.chavesSemPar) ? (
              <p className="flex gap-2 text-sm text-bronze">
                <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
                {validacao.invalidas.length > 0 && `Variáveis fora da lista: ${validacao.invalidas.join(', ')}. `}
                {validacao.chavesSemPar && 'Há "{{" ou "}}" sem par.'}
              </p>
            ) : <p className="flex gap-2 text-sm text-sage"><CheckCircle2 size={16} aria-hidden className="mt-0.5" /> Variáveis válidas.</p>}
            <div>
              <p className="label">Variáveis (clique para inserir)</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {VARIAVEIS_MODELO.map((v) => (
                  <button key={v} type="button" onClick={() => inserir(v)} title={ROTULOS_VARIAVEIS[v]}
                    className="border border-line px-2 py-1 text-xs hover:bg-stone hover:text-ink">{`{{${v}}}`}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid content-start gap-2">
            <p className="label">Prévia com dados de exemplo</p>
            <div className="max-h-[36rem] overflow-y-auto border border-line bg-ink p-5">
              {previa.ok ? <BlocosContrato blocos={previa.blocos} />
                : <p className="text-sm text-bronze">A prévia aparece quando as variáveis estiverem corretas.</p>}
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={isSubmitting}><Upload size={16} aria-hidden /> {isSubmitting ? 'Publicando…' : 'Publicar nova versão'}</button>
        </div>
      </form>

      <section>
        <h3 className="mb-3 text-lg font-semibold">Versões</h3>
        <ul className="divide-y divide-line border border-line">
          {versoes.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span><span className="font-semibold">v{m.versao}</span> · {m.titulo}</span>
              <span className="flex items-center gap-3 text-xs text-muted">
                {dataHora(m.publicado_em)}
                {m.liberado_para_envio && <Etiqueta tom="ok">Liberado {m.liberado_em ? dataHora(m.liberado_em) : ''}</Etiqueta>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {vigente && <ModalLiberar aberto={liberar} aoFechar={() => setLiberar(false)} modelo={vigente} aoLiberar={() => qc.invalidateQueries({ queryKey: chaveModelos })} />}
    </div>
  )
}

function ModalLiberar({ aberto, aoFechar, modelo, aoLiberar }: { aberto: boolean; aoFechar: () => void; modelo: ContratoModelo; aoLiberar: () => unknown }) {
  const [revisado, setRevisado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  async function liberar() {
    setEnviando(true)
    try {
      await configLiberarModelo({ p_id: modelo.id, p_revisado_juridico: revisado })
      toast.success('Modelo liberado para envio.')
      await aoLiberar()
      aoFechar()
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} bloquearFechar={enviando} titulo={`Liberar "${modelo.titulo}" (v${modelo.versao})`}
      rodape={
        <>
          <button type="button" className="btn-ghost" onClick={aoFechar} disabled={enviando}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={liberar} disabled={!revisado || enviando}>{enviando ? 'Aguarde…' : 'Liberar para envio'}</button>
        </>
      }>
      <div className="grid gap-4 text-sm">
        <p>Depois de liberada, esta versão pode ser enviada para assinatura no D4Sign. A liberação é registrada na auditoria e não pode ser desfeita (publique uma versão nova para mudar o texto).</p>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 accent-bronze" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} />
          <span>Confirmo que esta versão foi revisada pelo jurídico da Arken.</span>
        </label>
      </div>
    </Modal>
  )
}

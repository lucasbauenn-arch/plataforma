import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Ban, Download, FilePlus2, ThumbsDown, ThumbsUp, Upload } from 'lucide-react'
import { crmDocumentoAnalisar, crmDocumentoCancelar, crmDocumentoSolicitar, crmDocumentos } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { FORMATOS_DOCUMENTO } from '@/lib/constants'
import { dataHora } from '@/lib/format'
import type { FormatoDocumento } from '@/lib/types'
import { Campo } from '@/components/Campo'
import { Consulta } from '@/components/app/Consulta'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Etiqueta, SeloStatus } from '@/components/app/Etiqueta'
import { Modal } from '@/components/app/Modal'
import { MAX_BYTES_PADRAO, abrirArquivo, chavesFunil, enviarArquivoDocumento, useConfigDocumentos } from '../api-funil'
import { acceptDosFormatos, tamanhoLegivel } from '../funil'
import type { ClienteDocumento, PropsAbaFicha } from '../tipos'

const FORMATOS = Object.keys(FORMATOS_DOCUMENTO) as FormatoDocumento[]
const esquemaSolicitar = z.object({
  nome: z.string().trim().min(2, 'Informe o nome (de 2 a 120 caracteres).').max(120, 'Informe o nome (de 2 a 120 caracteres).'),
  formatos: z.array(z.enum(['jpeg', 'png', 'pdf', 'doc', 'planilha'])).min(1, 'Escolha ao menos um formato.'),
})
type FormSolicitar = z.infer<typeof esquemaSolicitar>

const rotulosFormatos = (f: readonly FormatoDocumento[]) => f.map((x) => FORMATOS_DOCUMENTO[x].rotulo).join(', ')

function ModalSolicitar({ clienteId, aoFechar, aoSalvar }: { clienteId: string; aoFechar: () => void; aoSalvar: () => void }) {
  const form = useForm<FormSolicitar>({ resolver: zodResolver(esquemaSolicitar), defaultValues: { nome: '', formatos: ['pdf', 'jpeg', 'png'] } })
  const e = form.formState.errors
  const salvar = useMutation({
    mutationFn: (d: FormSolicitar) => crmDocumentoSolicitar({ p_cliente_id: clienteId, p_nome: d.nome, p_formatos: d.formatos, p_contrato_id: null }),
    onSuccess: () => { toast.success('Documento solicitado.'); aoSalvar(); aoFechar() },
    onError: (err) => toast.error(mensagemErro(err)),
  })
  return (
    <Modal
      aberto titulo="Solicitar documento" aoFechar={aoFechar} bloquearFechar={salvar.isPending}
      rodape={
        <>
          <button type="button" className="btn-ghost" onClick={aoFechar} disabled={salvar.isPending}>Cancelar</button>
          <button type="submit" form="form-solicitar-documento" className="btn-primary" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Solicitar'}
          </button>
        </>
      }
    >
      <form id="form-solicitar-documento" className="grid gap-4" noValidate onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
        <Campo label="Documento" obrigatorio erro={e.nome?.message}>
          <input className="input" maxLength={120} placeholder="Ex.: Certidão de casamento" aria-invalid={!!e.nome || undefined} {...form.register('nome')} />
        </Campo>
        <fieldset>
          <legend className="label">Formatos aceitos <span className="text-bronze">*</span></legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {FORMATOS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input type="checkbox" value={f} className="size-4 accent-bronze" {...form.register('formatos')} /> {FORMATOS_DOCUMENTO[f].rotulo}
              </label>
            ))}
          </div>
          {e.formatos?.message && <span className="mt-1 block text-xs text-perigo">{e.formatos.message}</span>}
        </fieldset>
      </form>
    </Modal>
  )
}

/**
 * [WP3] Aba Documentos (§3.10, §4.3, §7.3): solicitar, enviar em nome do cliente (bucket privado, sem upsert), analisar
 * (F4, com motivo na rejeição), baixar cada versão (RPC auditada + URL assinada pela Edge) e cancelar a solicitação
 * (inativa, nunca exclui). Todas as versões ficam, inclusive as rejeitadas. O que a tela oferece vem de
 * `ficha.permissoes`; o servidor confere de novo em cada RPC.
 */
export default function AbaDocumentos({ clienteId, ficha, recarregarFicha }: PropsAbaFicha) {
  const qc = useQueryClient()
  const consulta = useQuery({ queryKey: chavesFunil.documentos(clienteId), queryFn: () => crmDocumentos({ p_id: clienteId }) })
  const config = useConfigDocumentos()
  const maxBytes = config.data?.documento_max_bytes ?? MAX_BYTES_PADRAO
  const p = ficha.permissoes
  const ativo = !ficha.cliente.inativado_em
  const [solicitando, setSolicitando] = useState(false)
  const [rejeitando, setRejeitando] = useState<ClienteDocumento | null>(null)
  const [cancelando, setCancelando] = useState<ClienteDocumento | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)

  function atualizar() {
    void qc.invalidateQueries({ queryKey: chavesFunil.documentos(clienteId) })
    void qc.invalidateQueries({ queryKey: chavesFunil.timeline(clienteId) })
    void qc.invalidateQueries({ queryKey: chavesFunil.kanbanTodas })
    recarregarFicha()
  }
  const aprovar = useMutation({
    mutationFn: (d: ClienteDocumento) => crmDocumentoAnalisar({ p_id: d.id, p_aprovar: true, p_motivo: null }),
    onSuccess: (_r, d) => { toast.success(`${d.nome}: aprovado.`); atualizar() },
    onError: (e) => toast.error(mensagemErro(e)),
  })

  async function enviar(d: ClienteDocumento, arquivo: File | undefined) {
    if (!arquivo) return
    setEnviando(d.id)
    try {
      await enviarArquivoDocumento(d, arquivo, maxBytes)
      toast.success(`${d.nome}: arquivo enviado para análise.`)
      atualizar()
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setEnviando(null)
    }
  }

  async function baixar(arquivoId: string) {
    setBaixando(arquivoId)
    try {
      await abrirArquivo(arquivoId)
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setBaixando(null)
    }
  }

  return (
    <section aria-labelledby="titulo-documentos">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="titulo-documentos" className="text-lg font-semibold">Documentos</h3>
          <p className="text-xs text-muted">Arquivos de até {tamanhoLegivel(maxBytes)}. O cliente com portal liberado também pode enviar.</p>
        </div>
        {p.solicitar_documento && ativo && (
          <button type="button" className="btn-primary" onClick={() => setSolicitando(true)}><FilePlus2 size={16} aria-hidden /> Solicitar documento</button>
        )}
      </div>

      <Consulta consulta={consulta} tituloVazio="Nenhum documento solicitado" textoVazio="Ao entrar em Documentação, os documentos básicos são solicitados automaticamente.">
        {(docs) => (
          <ul className="grid gap-3">
            {docs!.map((d) => {
              const aguardaEnvio = d.status === 'pendente' || d.status === 'rejeitado'
              return (
                <li key={d.id} className="card p-4" aria-label={d.nome}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{d.nome}</p>
                        <SeloStatus tipo="documento" valor={d.status} />
                        {d.basico && <Etiqueta>Básico</Etiqueta>}
                        {d.tipo === 'contrato' && <Etiqueta tom="destaque">Contrato</Etiqueta>}
                      </div>
                      <p className="mt-1 text-xs text-muted">Aceita: {rotulosFormatos(d.formatos_aceitos)}</p>
                      {d.analisado_em && (
                        <p className="mt-1 text-xs text-muted">Analisado{d.analisado_por && ` por ${d.analisado_por.nome}`} em {dataHora(d.analisado_em)}</p>
                      )}
                      {d.status === 'rejeitado' && d.motivo_rejeicao && (
                        <p className="mt-2 border border-perigo/30 bg-perigo/10 px-3 py-2 text-sm text-perigo">
                          Rejeitado: <span className="whitespace-pre-wrap break-words">{d.motivo_rejeicao}</span>
                        </p>
                      )}
                    </div>
                    {ativo && (
                      <div className="flex flex-wrap gap-2">
                        {p.enviar_documento && aguardaEnvio && (
                          <label className={`btn-ghost cursor-pointer px-3 py-1.5 text-xs ${enviando === d.id ? 'pointer-events-none opacity-50' : ''}`}>
                            <Upload size={14} aria-hidden /> {enviando === d.id ? 'Enviando…' : d.status === 'rejeitado' ? 'Reenviar arquivo' : 'Enviar arquivo'}
                            <input
                              type="file" className="sr-only" accept={acceptDosFormatos(d.formatos_aceitos)} disabled={enviando !== null}
                              aria-label={`Arquivo para ${d.nome}`}
                              onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; void enviar(d, f) }}
                            />
                          </label>
                        )}
                        {p.analisar_documento && d.status === 'em_analise' && (
                          <>
                            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={aprovar.isPending}
                              onClick={() => aprovar.mutate(d)} aria-label={`Aprovar ${d.nome}`}>
                              <ThumbsUp size={14} aria-hidden /> Aprovar
                            </button>
                            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setRejeitando(d)} aria-label={`Rejeitar ${d.nome}`}>
                              <ThumbsDown size={14} aria-hidden /> Rejeitar
                            </button>
                          </>
                        )}
                        {p.solicitar_documento && d.status !== 'aprovado' && (
                          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setCancelando(d)} aria-label={`Cancelar solicitação de ${d.nome}`}>
                            <Ban size={14} aria-hidden /> Cancelar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {d.arquivos.length > 0 && (
                    <ol className="mt-3 grid gap-1.5 border-t border-line pt-3" aria-label={`Versões de ${d.nome}`}>
                      {d.arquivos.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-stone/85">
                            {dataHora(a.enviado_em)} · {tamanhoLegivel(a.tamanho_bytes)} · {a.enviado_por_nome ?? '—'}
                            {a.atual && <> · <strong>atual</strong></>}
                          </span>
                          {a.removido ? (
                            <Etiqueta>Removido (LGPD)</Etiqueta>
                          ) : p.baixar_documento && (
                            <button type="button" className="inline-flex items-center gap-1 text-bronze hover:underline disabled:opacity-50"
                              disabled={baixando === a.id} onClick={() => void baixar(a.id)} aria-label={`Baixar versão de ${dataHora(a.enviado_em)} de ${d.nome}`}>
                              <Download size={13} aria-hidden /> {baixando === a.id ? 'Abrindo…' : 'Baixar'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Consulta>

      {solicitando && <ModalSolicitar clienteId={clienteId} aoFechar={() => setSolicitando(false)} aoSalvar={atualizar} />}
      <ConfirmarModal
        aberto={!!rejeitando} titulo={rejeitando ? `Rejeitar ${rejeitando.nome}` : ''}
        texto="O cliente é avisado por e-mail (se tiver consentimento) e o documento volta a aguardar um novo arquivo."
        rotuloConfirmar="Rejeitar" perigo motivo={{ rotulo: 'Motivo da rejeição', minimo: 3, placeholder: 'Ex.: imagem ilegível' }}
        aoConfirmar={async (motivo) => {
          if (!rejeitando) return
          await crmDocumentoAnalisar({ p_id: rejeitando.id, p_aprovar: false, p_motivo: motivo })
          toast.success(`${rejeitando.nome}: rejeitado.`)
          atualizar()
        }}
        aoFechar={() => setRejeitando(null)}
      />
      <ConfirmarModal
        aberto={!!cancelando} titulo={cancelando ? `Cancelar a solicitação de ${cancelando.nome}` : ''}
        texto="A solicitação sai da lista. Os arquivos já enviados continuam guardados no histórico."
        rotuloConfirmar="Cancelar solicitação" perigo motivo={{ rotulo: 'Motivo', minimo: 3 }}
        aoConfirmar={async (motivo) => {
          if (!cancelando) return
          await crmDocumentoCancelar({ p_id: cancelando.id, p_motivo: motivo ?? '' })
          toast.success('Solicitação cancelada.')
          atualizar()
        }}
        aoFechar={() => setCancelando(null)}
      />
    </section>
  )
}

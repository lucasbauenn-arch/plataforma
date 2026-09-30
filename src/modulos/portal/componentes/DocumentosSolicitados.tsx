import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FolderUp, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { crmDocumentoRegistrarEnvio } from '@/lib/rpc'
import { ErroRpc, mensagemErro } from '@/lib/erros'
import { dataHora } from '@/lib/format'
import { SeloStatus } from '@/components/app/Etiqueta'
import { aceitarDe, caminhoEnvio, limiteEnvio, rotuloFormatos, tamanhoLegivel, validarArquivo } from '../envio'
import type { PortalDocumento } from '../tipos'

/**
 * "Documentos solicitados" (portal_documentos): o titular só ENVIA (N1). O arquivo sobe para crm-documentos
 * (política de INSERT pode_enviar_documento) e crm_documento_registrar_envio confere tamanho e tipo reais e leva a
 * solicitação para análise. Não há download de documento pessoal pelo portal.
 */
export function DocumentosSolicitados({ clienteId, documentos }: { clienteId: string; documentos: PortalDocumento[] }) {
  const pendentes = documentos.filter((d) => d.pode_enviar).length
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="portal-documentos">
      <h2 id="portal-documentos" className="flex items-center gap-2 font-semibold">
        <FolderUp size={18} className="text-bronze" aria-hidden /> Documentos solicitados
        {pendentes > 0 && <span className="bg-bronze px-2 py-0.5 text-xs text-ink">{pendentes} para enviar</span>}
      </h2>
      {documentos.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nenhum documento solicitado no momento.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {documentos.map((d) => <ItemDocumento key={d.id} clienteId={clienteId} d={d} />)}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">Por segurança, os documentos enviados não ficam disponíveis para download aqui.</p>
    </section>
  )
}

function ItemDocumento({ clienteId, d }: { clienteId: string; d: PortalDocumento }) {
  const qc = useQueryClient()
  const entrada = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(arquivo: File) {
    // limite configurado pelo Super: o que passar dele nem sobe (o registro do envio recusaria e o objeto ficaria órfão)
    const v = validarArquivo(arquivo, d.formatos_aceitos, limiteEnvio(d.max_bytes))
    if (!v.ok) return toast.error(v.erro)
    setEnviando(true)
    try {
      const path = caminhoEnvio(clienteId, d.id, crypto.randomUUID(), v.extensao)
      const up = await supabase.storage.from('crm-documentos').upload(path, arquivo, { upsert: false, contentType: v.mime })
      if (up.error) throw new ErroRpc('DESCONHECIDO', 'Não foi possível enviar o arquivo. Confira a conexão e tente de novo.')
      await crmDocumentoRegistrarEnvio({ p_documento_id: d.id, p_path: path })
      toast.success('Documento enviado para análise.')
      await qc.invalidateQueries({ queryKey: ['portal', 'documentos'] })
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setEnviando(false)
      if (entrada.current) entrada.current.value = ''
    }
  }

  const idEntrada = `doc-${d.id}`
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm">
      <div className="min-w-0">
        <p className="font-semibold">{d.nome}</p>
        <p className="text-xs text-muted">
          {rotuloFormatos(d.formatos_aceitos)}
          {d.pode_enviar && ` · até ${tamanhoLegivel(limiteEnvio(d.max_bytes))}`}
          {d.ultimo_envio_em && ` · último envio em ${dataHora(d.ultimo_envio_em)}`}
        </p>
        {d.status === 'rejeitado' && d.motivo_rejeicao && (
          <p className="mt-2 whitespace-pre-wrap border-l-2 border-perigo pl-3 text-perigo">{d.motivo_rejeicao}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <SeloStatus tipo="documento" valor={d.status} />
        {d.pode_enviar && (
          <>
            <input
              ref={entrada} id={idEntrada} type="file" className="sr-only" accept={aceitarDe(d.formatos_aceitos)}
              disabled={enviando} onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviar(f) }}
            />
            <label htmlFor={idEntrada} aria-disabled={enviando}
              className={`btn-ghost cursor-pointer px-4 py-2 ${enviando ? 'pointer-events-none opacity-50' : ''}`}>
              <Upload size={15} aria-hidden /> {enviando ? 'Enviando…' : d.status === 'rejeitado' ? `Reenviar ${d.nome}` : `Enviar ${d.nome}`}
            </label>
          </>
        )}
      </div>
    </li>
  )
}

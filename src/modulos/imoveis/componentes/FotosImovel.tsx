import { useRef, useState, type ElementType } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, ImageOff, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { imovelFotosOrdenar } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Consulta } from '@/components/app/Consulta'
import { Etiqueta } from '@/components/app/Etiqueta'
import { Modal } from '@/components/app/Modal'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import {
  chavesImoveis, enviarFoto, fotosComUrls, LIMITES_PADRAO, limitesFotos, removerFoto, urlDaFoto, type FotoComUrl,
} from '../api'
import { interrompeEnvio, mensagemDoEnvio, planejarEnvio, vagasDeFotos } from '../envio'
import { podeEditarFotos, podeRemoverFotos, type Usuario } from '../fluxo'
import { formatarBytes, LADO_MAXIMO, TIPOS_ACEITOS } from '../imagem'
import type { Imovel } from '../tipos'

/** URLs assinadas valem 1 h: a lista é refeita antes disso. */
const RENOVAR_URLS_MS = 45 * 60_000

/**
 * [WP5] Fotos do imóvel (§3.10, §7.3): galeria com capa, envio com redução no navegador (WebP ≤ 1920 px + miniatura
 * de 480 px), reordenação e remoção. Quem edita: `pode_editar_imovel` (criador em RA/PE e internos); o servidor
 * confere de novo o limite, o tamanho e o tipo reais.
 */
export function FotosImovel({ imovel, usuario, Titulo }: {
  imovel: Pick<Imovel, 'id' | 'status' | 'criado_por' | 'inativado_em'>
  usuario: Usuario
  Titulo: ElementType
}) {
  const qc = useQueryClient()
  const chave = chavesImoveis.fotos(imovel.id)
  const editar = podeEditarFotos(imovel, usuario)
  const remover = podeRemoverFotos(imovel, usuario)
  const fotos = useQuery({ queryKey: chave, queryFn: () => fotosComUrls(imovel.id), staleTime: RENOVAR_URLS_MS, refetchInterval: RENOVAR_URLS_MS })
  const limites = useQuery({ queryKey: chavesImoveis.limites, queryFn: limitesFotos, staleTime: 10 * 60_000, enabled: editar })
  const { maximo, maxBytes } = limites.data ?? LIMITES_PADRAO
  const quantidade = fotos.data?.length ?? 0
  const vagas = vagasDeFotos(quantidade, maximo)

  const entrada = useRef<HTMLInputElement>(null)
  const [envio, setEnvio] = useState<{ atual: number; total: number } | null>(null)
  const [ordenando, setOrdenando] = useState(false)
  const [aRemover, setARemover] = useState<FotoComUrl | null>(null)
  const [ampliada, setAmpliada] = useState<FotoComUrl | null>(null)
  const ocupado = !!envio || ordenando

  async function enviar(lista: FileList | null) {
    if (!lista?.length) return
    const plano = planejarEnvio(Array.from(lista), vagas)
    for (const r of plano.recusados) toast.error(r.motivo)
    if (plano.excedentes > 0) {
      toast.warning(vagas === 0
        ? `Este imóvel já tem ${maximo} fotos, o máximo permitido.`
        : `Só cabem mais ${vagas} foto(s): ${plano.excedentes} não foram enviadas.`)
    }
    let enviadas = 0
    try {
      for (let k = 0; k < plano.enviar.length; k++) {
        const arquivo = plano.enviar[k]
        setEnvio({ atual: k + 1, total: plano.enviar.length })
        try {
          await enviarFoto(imovel.id, arquivo, maxBytes)
          enviadas++
        } catch (e) {
          toast.error(`${arquivo.name}: ${mensagemDoEnvio(e)}`)
          if (interrompeEnvio(e)) break
        }
      }
    } finally {
      setEnvio(null)
      if (entrada.current) entrada.current.value = ''
      await qc.invalidateQueries({ queryKey: chave })
    }
    if (enviadas) toast.success(enviadas === 1 ? 'Foto enviada.' : `${enviadas} fotos enviadas.`)
  }

  async function mover(indice: number, delta: -1 | 1) {
    const atual = fotos.data ?? []
    const destino = indice + delta
    if (destino < 0 || destino >= atual.length) return
    const nova = [...atual]
    ;[nova[indice], nova[destino]] = [nova[destino], nova[indice]]
    setOrdenando(true)
    qc.setQueryData<FotoComUrl[]>(chave, nova.map((f, i) => ({ ...f, ordem: i })))
    try {
      await imovelFotosOrdenar({ p_imovel_id: imovel.id, p_ids: nova.map((f) => f.id) })
    } catch (e) {
      qc.setQueryData<FotoComUrl[]>(chave, atual)
      toast.error(mensagemErro(e))
    } finally {
      setOrdenando(false)
      void qc.invalidateQueries({ queryKey: chave })
    }
  }

  return (
    <section className="card p-6" aria-labelledby="titulo-fotos">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Titulo id="titulo-fotos" className="text-lg font-semibold">Fotos</Titulo>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {editar && (
            <>
              <span>{quantidade} de {maximo} fotos</span>
              <SeloProvisorio campo="configuracao_geral.imovel_fotos_max" />
            </>
          )}
        </div>
      </div>

      {editar && (
        <div className="mb-5 grid gap-2">
          <input
            ref={entrada} type="file" multiple accept={TIPOS_ACEITOS.join(',')} className="hidden" tabIndex={-1}
            aria-label="Escolher fotos" data-testid="entrada-fotos" disabled={ocupado || vagas === 0}
            onChange={(e) => void enviar(e.target.files)}
          />
          <button type="button" className="btn-ghost justify-self-start" disabled={ocupado || vagas === 0}
            onClick={() => entrada.current?.click()}>
            {envio ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ImagePlus size={16} aria-hidden />}
            {envio ? `Enviando ${envio.atual} de ${envio.total}…` : 'Enviar fotos'}
          </button>
          <p className="text-xs text-muted">
            JPG, PNG ou WEBP. As fotos são reduzidas no seu navegador (até {LADO_MAXIMO} px, no máximo {formatarBytes(maxBytes)}) antes
            do envio; os dados de localização do arquivo não são enviados. A primeira foto é a capa.
          </p>
        </div>
      )}

      <Consulta consulta={fotos} tituloVazio="Nenhuma foto enviada"
        textoVazio={editar ? 'Envie fotos da fachada, dos cômodos e da vista.' : 'Este imóvel ainda não tem fotos.'}>
        {(lista) => (
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label="Fotos do imóvel">
            {lista.map((f, i) => (
              <li key={f.id} className="border border-line bg-ink">
                <button type="button" onClick={() => setAmpliada(f)} className="block w-full" aria-label={`Ampliar a foto ${i + 1}`}>
                  {f.url ? (
                    <img src={f.url} alt={`Foto ${i + 1} do imóvel`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  ) : (
                    <span className="flex aspect-[4/3] w-full items-center justify-center text-muted"><ImageOff size={20} aria-label="Foto indisponível" /></span>
                  )}
                </button>
                <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
                  {i === 0 ? <Etiqueta tom="destaque">Capa</Etiqueta> : <span className="text-xs text-muted">{i + 1}</span>}
                  <div className="flex items-center gap-1">
                    {editar && (
                      <>
                        <button type="button" className="p-1.5 text-muted hover:text-stone disabled:opacity-30" disabled={ocupado || i === 0}
                          onClick={() => void mover(i, -1)} aria-label={`Mover a foto ${i + 1} para antes`}>
                          <ArrowLeft size={15} />
                        </button>
                        <button type="button" className="p-1.5 text-muted hover:text-stone disabled:opacity-30" disabled={ocupado || i === lista.length - 1}
                          onClick={() => void mover(i, 1)} aria-label={`Mover a foto ${i + 1} para depois`}>
                          <ArrowRight size={15} />
                        </button>
                      </>
                    )}
                    {remover && (
                      <button type="button" className="p-1.5 text-muted hover:text-perigo disabled:opacity-30" disabled={ocupado}
                        onClick={() => setARemover(f)} aria-label={`Remover a foto ${i + 1}`}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Consulta>

      <ConfirmarModal
        aberto={!!aRemover} titulo="Remover foto" perigo rotuloConfirmar="Remover"
        texto="A foto sai do imóvel e o arquivo é apagado. Esta ação não pode ser desfeita."
        aoFechar={() => setARemover(null)}
        aoConfirmar={async () => {
          if (!aRemover) return
          await removerFoto(aRemover)
          toast.success('Foto removida.')
          await qc.invalidateQueries({ queryKey: chave })
        }}
      />

      <FotoAmpliada foto={ampliada} aoFechar={() => setAmpliada(null)} />
    </section>
  )
}

function FotoAmpliada({ foto, aoFechar }: { foto: FotoComUrl | null; aoFechar: () => void }) {
  const url = useQuery({
    queryKey: ['imoveis', 'foto-url', foto?.storage_path],
    queryFn: () => urlDaFoto(foto!.storage_path),
    enabled: !!foto,
    staleTime: RENOVAR_URLS_MS,
  })
  return (
    <Modal aberto={!!foto} titulo="Foto do imóvel" aoFechar={aoFechar} largura="lg">
      {url.isPending ? (
        <p className="flex items-center gap-2 py-10 text-muted"><Loader2 size={16} className="animate-spin" aria-hidden /> Carregando…</p>
      ) : url.data ? (
        <img src={url.data} alt="Foto do imóvel em tamanho maior" className="mx-auto max-h-[70svh] w-auto" />
      ) : (
        <p className="py-10 text-muted">Não foi possível abrir a foto agora.</p>
      )}
    </Modal>
  )
}

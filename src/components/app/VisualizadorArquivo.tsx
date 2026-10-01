import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileWarning, X } from 'lucide-react'
import { mensagemErro } from '@/lib/erros'
import { podeVisualizar } from '@/lib/arquivos'
import { Carregando } from '@/components/Estados'

interface Props {
  /** Arquivo a mostrar; `null` fecha o lightbox. `chave` identifica o arquivo (id da versão). */
  arquivo: { chave: string; titulo: string; mimeType: string } | null
  /** Busca o conteúdo (RPC auditada + URL assinada), só quando o lightbox abre. */
  carregar: () => Promise<Blob>
  aoFechar: () => void
  aoBaixar?: () => void
}

/**
 * Lightbox de documento: tela cheia escura, imagem ou PDF no centro, Esc ou clique fora fecham.
 * O conteúdo vira um endereço `blob:` local (liberado ao fechar), então o link assinado não fica exposto na página.
 * Cada abertura é um novo acesso auditado (sem cache).
 */
export function VisualizadorArquivo({ arquivo, carregar, aoFechar, aoBaixar }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const visualizavel = !!arquivo && podeVisualizar(arquivo.mimeType)

  const q = useQuery({
    queryKey: ['visualizar-arquivo', arquivo?.chave],
    queryFn: carregar,
    enabled: visualizavel,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  })

  const url = useMemo(() => (visualizavel && q.data ? URL.createObjectURL(q.data) : null), [visualizavel, q.data])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (arquivo && !d.open) d.showModal()
    if (!arquivo && d.open) d.close()
  }, [arquivo])

  const fecharSeFora = (e: React.MouseEvent) => { if (e.target === e.currentTarget) aoFechar() }

  return (
    <dialog
      ref={ref}
      aria-label={arquivo ? `Visualizar ${arquivo.titulo}` : 'Visualizar arquivo'}
      onCancel={(e) => { e.preventDefault(); aoFechar() }}
      onClick={fecharSeFora}
      className="m-0 h-svh max-h-none w-screen max-w-none bg-transparent p-0 text-stone backdrop:bg-ink/95"
    >
      {arquivo && (
        <div className="flex h-full flex-col" onClick={fecharSeFora}>
          <div className="flex items-center justify-between gap-4 border-b border-line bg-ink px-5 py-3">
            <p className="min-w-0 truncate text-sm font-semibold">{arquivo.titulo}</p>
            <div className="flex shrink-0 items-center gap-2">
              {aoBaixar && (
                <button type="button" className="btn-ghost" onClick={aoBaixar}><Download size={15} aria-hidden /> Baixar</button>
              )}
              <button type="button" onClick={aoFechar} aria-label="Fechar" className="p-2 text-muted hover:text-stone"><X size={22} /></button>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 place-items-center p-4" onClick={fecharSeFora}>
            {!visualizavel ? (
              <div className="max-w-sm text-center">
                <FileWarning className="mx-auto text-bronze" size={36} aria-hidden />
                <p className="mt-3 text-sm text-muted">Este formato não pode ser visualizado no navegador. Use “Baixar” para abrir o arquivo.</p>
              </div>
            ) : q.isError ? (
              <p role="alert" className="border border-perigo/30 bg-perigo/10 px-6 py-5 text-sm text-perigo">{mensagemErro(q.error)}</p>
            ) : !url ? (
              <Carregando />
            ) : arquivo.mimeType === 'application/pdf' ? (
              <iframe src={url} title={arquivo.titulo} className="h-full w-full max-w-5xl border border-line bg-ink-soft" />
            ) : (
              <img src={url} alt={arquivo.titulo} className="max-h-full max-w-full object-contain" />
            )}
          </div>
        </div>
      )}
    </dialog>
  )
}

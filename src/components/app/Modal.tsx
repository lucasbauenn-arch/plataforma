import { useEffect, useId, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'

interface PropsJanela {
  aberto: boolean
  titulo: ReactNode
  aoFechar: () => void
  children: ReactNode
  /** Botões do rodapé (ex.: Cancelar / Salvar). */
  rodape?: ReactNode
  /** Impede fechar por Esc ou clique fora (ex.: durante o envio). */
  bloquearFechar?: boolean
}

/** `<dialog>` nativo: foco preso, Esc e fundo escurecido pelo navegador. */
function Janela({ aberto, titulo, aoFechar, children, rodape, bloquearFechar, classe }: PropsJanela & { classe: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const idTitulo = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (aberto && !d.open) d.showModal()
    if (!aberto && d.open) d.close()
  }, [aberto])

  // fecha se o componente sair da tela com o diálogo aberto
  useEffect(() => () => { if (ref.current?.open) ref.current.close() }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      onCancel={(e) => { e.preventDefault(); if (!bloquearFechar) aoFechar() }}
      onClick={(e) => { if (e.target === ref.current && !bloquearFechar) aoFechar() }}
      className={clsx('border border-line bg-ink-soft p-0 text-stone backdrop:bg-ink/80', classe)}
    >
      {aberto && (
        <div className="flex max-h-[inherit] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <h2 id={idTitulo} className="text-lg font-semibold">{titulo}</h2>
            <button type="button" onClick={aoFechar} disabled={bloquearFechar} aria-label="Fechar" className="text-muted hover:text-stone disabled:opacity-40">
              <X size={20} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {rodape && <div className="flex flex-wrap justify-end gap-3 border-t border-line px-6 py-4">{rodape}</div>}
        </div>
      )}
    </dialog>
  )
}

/** Janela central. `largura`: `md` (formulários curtos) ou `lg`. */
export function Modal({ largura = 'md', ...p }: PropsJanela & { largura?: 'md' | 'lg' }) {
  return <Janela {...p} classe={clsx('m-auto max-h-[90svh] w-[calc(100%-2rem)]', largura === 'md' ? 'max-w-lg' : 'max-w-3xl')} />
}

/** Painel lateral à direita (detalhes, filtros avançados). Ocupa a tela inteira no celular. */
export function Gaveta(p: PropsJanela) {
  return <Janela {...p} classe="my-0 mr-0 ml-auto h-svh max-h-svh w-full max-w-xl" />
}

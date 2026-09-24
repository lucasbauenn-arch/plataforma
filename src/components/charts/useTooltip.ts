import { useRef, useState } from 'react'

interface Estado { x: number; y: number; titulo: string; valor: string }

/** Tooltip posicionado pelo retângulo do próprio marco (sem seguir o mouse) — um container `relative` + <Tooltip>. */
export function useTooltip() {
  const container = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Estado | null>(null)

  function mostrar(ev: React.MouseEvent | React.FocusEvent, titulo: string, valor: string) {
    const alvo = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    const base = container.current?.getBoundingClientRect()
    if (!base) return
    setTip({ x: alvo.left - base.left + alvo.width / 2, y: alvo.top - base.top, titulo, valor })
  }
  const esconder = () => setTip(null)

  return { container, tip, mostrar, esconder }
}

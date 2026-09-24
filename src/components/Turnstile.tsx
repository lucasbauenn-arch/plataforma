import { useEffect, useRef } from 'react'

// Cloudflare Turnstile (anti-robô). Sem VITE_TURNSTILE_SITE_KEY não renderiza e o servidor decide se exige o token.
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opcoes: Record<string, unknown>) => string
      remove: (id: string) => void
    }
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

let script: Promise<void> | null = null
function carregarScript() {
  script ??= new Promise<void>((ok, falha) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => ok()
    s.onerror = () => { script = null; falha(new Error('Turnstile indisponível')) }
    document.head.appendChild(s)
  })
  return script
}

/** Chama onToken com o token ('' quando expira ou falha). Remonte (prop key) para gerar um token novo. */
export function Turnstile({ onToken, acao }: { onToken: (token: string) => void; acao: string }) {
  const el = useRef<HTMLDivElement>(null)
  const callback = useRef(onToken)
  useEffect(() => { callback.current = onToken }, [onToken])

  useEffect(() => {
    if (!SITE_KEY) return
    let id: string | undefined
    let ativo = true
    carregarScript()
      .then(() => {
        if (!ativo || !el.current || !window.turnstile) return
        id = window.turnstile.render(el.current, {
          sitekey: SITE_KEY, action: acao, theme: 'dark', language: 'pt-br', size: 'flexible',
          callback: (t: string) => callback.current(t),
          'expired-callback': () => callback.current(''),
          'error-callback': () => callback.current(''),
        })
      })
      .catch(() => callback.current(''))
    return () => { ativo = false; if (id) window.turnstile?.remove(id) }
  }, [acao])

  if (!SITE_KEY) return null
  return <div ref={el} className="min-h-[65px]" />
}

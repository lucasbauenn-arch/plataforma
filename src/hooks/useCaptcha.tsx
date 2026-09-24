import { useState } from 'react'
import { Turnstile } from '@/components/Turnstile'

const ATIVO = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY)

/** Token do Turnstile + widget pronto para o formulário. O token vale uma vez: chame renovar() após cada envio. */
export function useCaptcha(acao: string) {
  const [token, setToken] = useState('')
  const [rodada, setRodada] = useState(0)
  return {
    token: token || undefined,
    pronto: !ATIVO || Boolean(token),
    widget: <Turnstile key={rodada} acao={acao} onToken={setToken} />,
    renovar: () => { setToken(''); setRodada((r) => r + 1) },
  }
}

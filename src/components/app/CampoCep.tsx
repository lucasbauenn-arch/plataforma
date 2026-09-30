import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { criarConsultaCep, type EnderecoCep } from '@/lib/cep'
import { mascaraCep, soDigitos } from '@/lib/format'

interface PropsCampo {
  id?: string
  desabilitado?: boolean
  /** Marca o campo como inválido (borda e `aria-invalid`), para usar com o erro do `Campo`. */
  invalido?: boolean
}

/**
 * CEP com máscara; guarda só os 8 dígitos. Ao completar, consulta o endereço (ViaCEP/BrasilAPI) e chama `aoEncontrar`
 * para o formulário preencher logradouro, bairro, cidade e UF. Com react-hook-form, use dentro de um `Controller`.
 */
export function CampoCep({ valor, aoMudar, aoEncontrar, id, desabilitado, invalido }: PropsCampo & {
  valor: string | null | undefined
  aoMudar: (digitos: string) => void
  aoEncontrar?: (endereco: EnderecoCep) => void
}) {
  const [buscando, setBuscando] = useState(false)
  const ultimo = useRef<string | null>(null)
  // uma consulta por vez: digitar outro CEP (ou apagar) cancela a anterior e descarta a resposta atrasada
  const [consulta] = useState(criarConsultaCep)
  useEffect(() => () => consulta.cancelar(), [consulta])

  async function mudar(texto: string) {
    const d = soDigitos(texto).slice(0, 8)
    aoMudar(d)
    if (!aoEncontrar) return
    if (d.length !== 8) {
      if (ultimo.current !== null) {
        ultimo.current = null
        consulta.cancelar()
        setBuscando(false)
      }
      return
    }
    if (d === ultimo.current) return
    ultimo.current = d
    setBuscando(true)
    try {
      const r = await consulta.consultar(d)
      if (r.descartada) return
      setBuscando(false)
      if (r.endereco) aoEncontrar(r.endereco)
      else toast.error('CEP não encontrado. Preencha o endereço manualmente.')
    } catch {
      setBuscando(false)
      toast.error('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.')
    }
  }

  return (
    <div className="relative">
      <input
        id={id} className="input" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000"
        value={mascaraCep(valor ?? '')} disabled={desabilitado} aria-invalid={invalido || undefined}
        onChange={(e) => void mudar(e.target.value)}
      />
      {buscando && <Loader2 size={16} aria-label="Consultando CEP" className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-muted" />}
    </div>
  )
}

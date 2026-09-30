// Consulta de CEP no navegador, só para preencher formulários (docs/ARQUITETURA_EXPANSAO.md §6.7).
// ViaCEP primeiro; BrasilAPI como alternativa. O servidor valida `cep ~ '^\d{8}$'` e a UF por conta própria.

import { soDigitos } from './format'

export interface EnderecoCep {
  /** 8 dígitos. */
  cep: string
  logradouro: string
  bairro: string
  cidade: string
  uf: string
  complemento: string
}

const TEMPO_LIMITE_MS = 5000

async function buscarJson(url: string, sinal?: AbortSignal): Promise<unknown> {
  const controle = new AbortController()
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS)
  const cancelar = () => controle.abort()
  sinal?.addEventListener('abort', cancelar)
  try {
    const r = await fetch(url, { signal: controle.signal, headers: { accept: 'application/json' } })
    if (r.status === 404 || r.status === 400) return null
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(limite)
    sinal?.removeEventListener('abort', cancelar)
  }
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Normaliza a resposta do ViaCEP (`{ erro: true }` = não encontrado). */
export function lerViaCep(cep: string, j: unknown): EnderecoCep | null {
  if (!j || typeof j !== 'object' || (j as { erro?: unknown }).erro) return null
  const o = j as Record<string, unknown>
  const uf = texto(o.uf).toUpperCase()
  if (!/^[A-Z]{2}$/.test(uf)) return null
  return { cep, logradouro: texto(o.logradouro), bairro: texto(o.bairro), cidade: texto(o.localidade), uf, complemento: texto(o.complemento) }
}

/** Normaliza a resposta da BrasilAPI (`/api/cep/v1`). */
export function lerBrasilApi(cep: string, j: unknown): EnderecoCep | null {
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  const uf = texto(o.state).toUpperCase()
  if (!/^[A-Z]{2}$/.test(uf)) return null
  return { cep, logradouro: texto(o.street), bairro: texto(o.neighborhood), cidade: texto(o.city), uf, complemento: '' }
}

export type ResultadoConsultaCep = { descartada: true } | { descartada: false; endereco: EnderecoCep | null }

export interface ConsultaCep {
  /**
   * Consulta o CEP cancelando a consulta anterior do mesmo campo. Se outra consulta começou (ou `cancelar` foi
   * chamado) antes desta responder, devolve `{ descartada: true }`: a resposta de um CEP antigo nunca preenche o
   * endereço de um CEP novo. Erro dos dois serviços é relançado só se a consulta ainda for a atual.
   */
  consultar: (cep: string) => Promise<ResultadoConsultaCep>
  /** Cancela a consulta em andamento (CEP apagado ou incompleto, componente desmontado). */
  cancelar: () => void
}

/** Uma por campo de CEP. `buscar` é injetável para os testes. */
export function criarConsultaCep(buscar: (cep: string, sinal?: AbortSignal) => Promise<EnderecoCep | null> = buscarCep): ConsultaCep {
  let atual: AbortController | null = null
  return {
    async consultar(cep) {
      atual?.abort()
      const controle = new AbortController()
      atual = controle
      const valendo = () => atual === controle && !controle.signal.aborted
      try {
        const endereco = await buscar(cep, controle.signal)
        return valendo() ? { descartada: false, endereco } : { descartada: true }
      } catch (e) {
        if (!valendo()) return { descartada: true }
        throw e
      } finally {
        if (atual === controle) atual = null
      }
    },
    cancelar() {
      atual?.abort()
      atual = null
    },
  }
}

/**
 * Endereço do CEP (8 dígitos, com ou sem máscara). `null` quando o CEP é inválido ou não existe.
 * Lança erro só se os dois serviços estiverem fora do ar (a tela deixa o usuário digitar).
 */
export async function buscarCep(valor: string, sinal?: AbortSignal): Promise<EnderecoCep | null> {
  const cep = soDigitos(valor)
  if (cep.length !== 8) return null
  try {
    return lerViaCep(cep, await buscarJson(`https://viacep.com.br/ws/${cep}/json/`, sinal))
  } catch (e) {
    if (sinal?.aborted) throw e
    return lerBrasilApi(cep, await buscarJson(`https://brasilapi.com.br/api/cep/v1/${cep}`, sinal))
  }
}

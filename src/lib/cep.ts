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

// ---------- coordenadas (latitude/longitude) para o mapa do empreendimento ----------

export interface Coordenadas {
  latitude: number
  longitude: number
  /**
   * `endereco` = geocodificação da rua (OpenStreetMap/Nominatim); `aproximada` = centro do município ou do bairro
   * (a BrasilAPI v2 devolve, na prática, o ponto do município do IBGE, não o da rua). A tela avisa para conferir.
   */
  precisao: 'endereco' | 'aproximada'
}

const numeroCoordenada = (v: unknown, limite: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && Math.abs(n) <= limite && n !== 0 ? n : null
}

/** `location.coordinates` da BrasilAPI `/api/cep/v2` (números em texto; objeto vazio quando não há). */
export function lerCoordenadasBrasilApi(j: unknown): { latitude: number; longitude: number } | null {
  const c = (j as { location?: { coordinates?: { latitude?: unknown; longitude?: unknown } } } | null)?.location?.coordinates
  if (!c) return null
  const latitude = numeroCoordenada(c.latitude, 90)
  const longitude = numeroCoordenada(c.longitude, 180)
  return latitude !== null && longitude !== null ? { latitude, longitude } : null
}

/** Primeiro resultado do Nominatim (`[{ lat, lon }]`, lista vazia quando não acha). */
export function lerCoordenadasNominatim(j: unknown): { latitude: number; longitude: number } | null {
  if (!Array.isArray(j) || !j.length) return null
  const o = j[0] as { lat?: unknown; lon?: unknown }
  const latitude = numeroCoordenada(o.lat, 90)
  const longitude = numeroCoordenada(o.lon, 180)
  return latitude !== null && longitude !== null ? { latitude, longitude } : null
}

/** Texto de busca do Nominatim: partes preenchidas, separadas por vírgula, com o país no fim. */
export function consultaNominatim(partes: (string | null | undefined)[]) {
  const limpas = partes.map((p) => (p ?? '').trim()).filter(Boolean)
  return limpas.length ? [...limpas, 'Brasil'].join(', ') : ''
}

export const urlNominatim = (q: string) =>
  `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`

type BuscarJson = (url: string, sinal?: AbortSignal) => Promise<unknown>

/** Coordenadas de um endereço digitado (rua e número, cidade, UF), pelo Nominatim. `null` quando não acha. */
export async function geocodificarEndereco(partes: (string | null | undefined)[], sinal?: AbortSignal, buscar: BuscarJson = buscarJson): Promise<Coordenadas | null> {
  const q = consultaNominatim(partes)
  if (!q) return null
  const c = lerCoordenadasNominatim(await buscar(urlNominatim(q), sinal))
  return c && { ...c, precisao: 'endereco' }
}

/**
 * Latitude e longitude do CEP já consultado. Ordem: BrasilAPI v2 (`location.coordinates`); como ela devolve o centro do
 * município, quando o CEP tem rua a rua é geocodificada no Nominatim e, se achar, vale a da rua. Sem rua (CEP geral
 * da cidade) ou sem resultado na rua: fica a da BrasilAPI e, se ela vier vazia, o Nominatim pelo bairro/cidade — as
 * duas como `aproximada`. Falha de rede de um serviço não impede o outro; `null` quando nenhum acha.
 * Uma chamada por CEP completo ao Nominatim (política de uso: no máximo 1 requisição por segundo).
 */
export async function buscarCoordenadas(end: EnderecoCep, sinal?: AbortSignal, buscar: BuscarJson = buscarJson): Promise<Coordenadas | null> {
  const tentar = async <T>(f: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await f()
    } catch (e) {
      if (sinal?.aborted) throw e
      return null
    }
  }
  const brasil = await tentar(async () => lerCoordenadasBrasilApi(await buscar(`https://brasilapi.com.br/api/cep/v2/${soDigitos(end.cep)}`, sinal)))
  const doNominatim = (partes: string[]) => tentar(async () => lerCoordenadasNominatim(await buscar(urlNominatim(consultaNominatim(partes)), sinal)))
  if (end.logradouro) {
    const rua = await doNominatim([end.logradouro, end.cidade, end.uf])
    if (rua) return { ...rua, precisao: 'endereco' }
  }
  if (brasil) return { ...brasil, precisao: 'aproximada' }
  if (end.logradouro || !end.cidade) return null
  const regiao = await doNominatim([end.bairro, end.cidade, end.uf])
  return regiao && { ...regiao, precisao: 'aproximada' }
}

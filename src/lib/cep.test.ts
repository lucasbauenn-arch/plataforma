import { describe, expect, it } from 'vitest'
import {
  buscarCoordenadas, consultaNominatim, criarConsultaCep, geocodificarEndereco, lerCoordenadasBrasilApi, lerCoordenadasNominatim,
  urlNominatim, type EnderecoCep,
} from './cep'

const endereco = (cep: string, logradouro: string): EnderecoCep => ({ cep, logradouro, bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', complemento: '' })

/** `buscar` controlado pelo teste: cada chamada fica pendente até `responder`/`falhar`. */
function buscaControlada() {
  const pendentes = new Map<string, { resolver: (e: EnderecoCep | null) => void; rejeitar: (e: unknown) => void; sinal?: AbortSignal }>()
  const buscar = (cep: string, sinal?: AbortSignal) =>
    new Promise<EnderecoCep | null>((resolver, rejeitar) => { pendentes.set(cep, { resolver, rejeitar, sinal }) })
  return {
    buscar,
    responder: (cep: string, e: EnderecoCep | null) => pendentes.get(cep)!.resolver(e),
    falhar: (cep: string, erro: unknown) => pendentes.get(cep)!.rejeitar(erro),
    sinal: (cep: string) => pendentes.get(cep)!.sinal,
  }
}

describe('criarConsultaCep (um campo de CEP)', () => {
  it('resposta atrasada de um CEP antigo é descartada: não sobrescreve o endereço do CEP novo', async () => {
    const b = buscaControlada()
    const c = criarConsultaCep(b.buscar)
    const a = c.consultar('01001000')
    const novo = c.consultar('20040002')
    expect(b.sinal('01001000')?.aborted).toBe(true)
    b.responder('20040002', endereco('20040002', 'Av. Rio Branco'))
    b.responder('01001000', endereco('01001000', 'Praça da Sé'))
    await expect(novo).resolves.toEqual({ descartada: false, endereco: endereco('20040002', 'Av. Rio Branco') })
    await expect(a).resolves.toEqual({ descartada: true })
  })

  it('cancelar (CEP apagado ou componente desmontado) descarta a consulta em andamento', async () => {
    const b = buscaControlada()
    const c = criarConsultaCep(b.buscar)
    const p = c.consultar('01001000')
    c.cancelar()
    expect(b.sinal('01001000')?.aborted).toBe(true)
    b.responder('01001000', endereco('01001000', 'Praça da Sé'))
    await expect(p).resolves.toEqual({ descartada: true })
  })

  it('erro da consulta atual é relançado; erro (abort) de consulta substituída é só descartado', async () => {
    const b = buscaControlada()
    const c = criarConsultaCep(b.buscar)
    const antiga = c.consultar('01001000')
    const atual = c.consultar('20040002')
    b.falhar('01001000', new DOMException('abortada', 'AbortError'))
    await expect(antiga).resolves.toEqual({ descartada: true })
    b.falhar('20040002', new Error('fora do ar'))
    await expect(atual).rejects.toThrow('fora do ar')
  })

  it('CEP inexistente na consulta atual: endereço nulo (a tela avisa)', async () => {
    const b = buscaControlada()
    const c = criarConsultaCep(b.buscar)
    const p = c.consultar('99999999')
    b.responder('99999999', null)
    await expect(p).resolves.toEqual({ descartada: false, endereco: null })
  })
})

describe('coordenadas do CEP', () => {
  const end: EnderecoCep = { cep: '03333050', logradouro: 'Rua Coronel Irineu de Castro', bairro: 'Jardim Anália Franco', cidade: 'São Paulo', uf: 'SP', complemento: '' }
  const brasilV2 = { location: { type: 'Point', coordinates: { longitude: '-46.63611', latitude: '-23.5475' } } }
  const nominatim = [{ lat: '-23.5585800', lon: '-46.5688690' }]

  /** `buscar` simulado por serviço; registra as URLs chamadas. */
  function simular(respostas: { brasil?: unknown; nominatim?: unknown; brasilFalha?: boolean }) {
    const urls: string[] = []
    const buscar = async (url: string) => {
      urls.push(url)
      if (url.includes('brasilapi')) {
        if (respostas.brasilFalha) throw new Error('fora do ar')
        return respostas.brasil ?? { location: { type: 'Point', coordinates: {} } }
      }
      return respostas.nominatim ?? []
    }
    return { urls, buscar }
  }

  it('lê a BrasilAPI v2 (números em texto) e ignora coordenadas vazias, zeradas ou fora da faixa', () => {
    expect(lerCoordenadasBrasilApi(brasilV2)).toEqual({ latitude: -23.5475, longitude: -46.63611 })
    expect(lerCoordenadasBrasilApi({ location: { type: 'Point', coordinates: {} } })).toBeNull()
    expect(lerCoordenadasBrasilApi({ location: { coordinates: { latitude: '0', longitude: '0' } } })).toBeNull()
    expect(lerCoordenadasBrasilApi({ location: { coordinates: { latitude: '123', longitude: '-46' } } })).toBeNull()
    expect(lerCoordenadasBrasilApi(null)).toBeNull()
  })

  it('lê o primeiro resultado do Nominatim; lista vazia = nada', () => {
    expect(lerCoordenadasNominatim(nominatim)).toEqual({ latitude: -23.55858, longitude: -46.568869 })
    expect(lerCoordenadasNominatim([])).toBeNull()
    expect(lerCoordenadasNominatim({ erro: true })).toBeNull()
  })

  it('monta a busca do Nominatim com o país e codifica a URL', () => {
    expect(consultaNominatim(['Rua A, 10', '', null, 'São Paulo', 'SP'])).toBe('Rua A, 10, São Paulo, SP, Brasil')
    expect(consultaNominatim(['', undefined])).toBe('')
    expect(urlNominatim('Rua São João, SP')).toBe('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=Rua%20S%C3%A3o%20Jo%C3%A3o%2C%20SP')
  })

  it('CEP com rua: consulta a BrasilAPI v2 primeiro e fica com a rua do Nominatim (a BrasilAPI dá o centro da cidade)', async () => {
    const s = simular({ brasil: brasilV2, nominatim })
    await expect(buscarCoordenadas(end, undefined, s.buscar)).resolves.toEqual({ latitude: -23.55858, longitude: -46.568869, precisao: 'endereco' })
    expect(s.urls[0]).toBe('https://brasilapi.com.br/api/cep/v2/03333050')
    expect(s.urls[1]).toContain('nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=Rua%20Coronel')
    expect(s.urls).toHaveLength(2)
  })

  it('rua não encontrada no Nominatim: fica a BrasilAPI, marcada como aproximada (uma chamada só ao Nominatim)', async () => {
    const s = simular({ brasil: brasilV2, nominatim: [] })
    await expect(buscarCoordenadas(end, undefined, s.buscar)).resolves.toEqual({ latitude: -23.5475, longitude: -46.63611, precisao: 'aproximada' })
    expect(s.urls.filter((u) => u.includes('nominatim'))).toHaveLength(1)
  })

  it('BrasilAPI vazia ou fora do ar: geocodifica pelo Nominatim', async () => {
    const s = simular({ brasilFalha: true, nominatim })
    await expect(buscarCoordenadas(end, undefined, s.buscar)).resolves.toMatchObject({ precisao: 'endereco' })
  })

  it('CEP geral da cidade (sem rua) e sem BrasilAPI: bairro/cidade no Nominatim, aproximada', async () => {
    const s = simular({ nominatim })
    const semRua = { ...end, logradouro: '', bairro: '' }
    await expect(buscarCoordenadas(semRua, undefined, s.buscar)).resolves.toMatchObject({ precisao: 'aproximada' })
    expect(decodeURIComponent(s.urls[1])).toContain('q=São Paulo, SP, Brasil')
  })

  it('nada encontrado em lugar nenhum: null (a tela deixa preencher à mão)', async () => {
    const s = simular({})
    await expect(buscarCoordenadas(end, undefined, s.buscar)).resolves.toBeNull()
  })

  it('geocodificarEndereco usa o endereço digitado (com número)', async () => {
    const s = simular({ nominatim })
    await expect(geocodificarEndereco(['Rua A, 43', 'São Paulo', 'SP'], undefined, s.buscar)).resolves.toMatchObject({ precisao: 'endereco' })
    expect(decodeURIComponent(s.urls[0])).toContain('q=Rua A, 43, São Paulo, SP, Brasil')
    await expect(geocodificarEndereco(['', ''], undefined, s.buscar)).resolves.toBeNull()
  })
})

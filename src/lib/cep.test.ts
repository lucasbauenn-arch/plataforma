import { describe, expect, it } from 'vitest'
import { criarConsultaCep, type EnderecoCep } from './cep'

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

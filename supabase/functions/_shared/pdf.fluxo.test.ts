// Fluxo da Edge Function contrato-gerar com portas falsas (WP4R-09): permissão pela RPC com o JWT; variável faltando
// não gera nada; caminho com a versão esperada e o sha do arquivo; registro com a service role; conflito de versão
// (outro PDF ou simulação alterada no meio, WP4R-04) apaga o arquivo recém-enviado.
import { describe, expect, it } from 'vitest'
import { criarRespostas } from './http.ts'
import { sha256Hex } from './chaves.ts'
import { renderizarModelo } from './modelo-contrato.ts'
import type { ErroPostgrest, ResultadoRpc } from './d4sign.ts'
import { type PortasGeracao, tratarGeracao } from '../contrato-gerar/fluxo.ts'

const r = criarRespostas()
const ID = 'e4000000-0000-4000-8000-000000000001'
const PDF = new TextEncoder().encode('%PDF-1.7 minuta desenhada')
const MODELO = '# Contrato {{codigo}}\n\nComprador: **{{nome}}**, CEP {{cep}}.'
const DADOS = { modelo: { id: 'm1', chave: 'parcelado', versao: 1, titulo: 'Modelo', conteudo: MODELO }, variaveis: { codigo: 123, nome: 'Maria', cep: '01001000' }, codigo: 123, pdf_versao: 2 }
const ok = (data: unknown = null): ResultadoRpc => ({ data, error: null })
const falhou = (error: ErroPostgrest): ResultadoRpc => ({ data: null, error })

function geracao(o: { dados?: ResultadoRpc; registro?: ResultadoRpc; jaExistia?: boolean; semSessao?: boolean } = {}) {
  const log: string[] = []
  const registros: Record<string, unknown>[] = []
  const desenhos: { versao: number; codigo: number }[] = []
  const portas: PortasGeracao = {
    async autenticar() {
      log.push('auth')
      return o.semSessao ? r.erro(401, 'Sua sessão expirou. Entre de novo.') : { rpc: async (nome) => { log.push(`usuario:${nome}`); return o.dados ?? ok(DADOS) } }
    },
    sistema: async (nome, args) => { log.push(`sistema:${nome}`); registros.push(args); return o.registro ?? ok() },
    async desenharPdf(_blocos, meta) { log.push('desenhar'); desenhos.push(meta); return PDF },
    async salvarMinuta(caminho) { log.push(`salvar:${caminho}`); return { jaExistia: o.jaExistia ?? false } },
    async removerMinuta(caminho) { log.push(`remover:${caminho}`) },
  }
  const pedir = (corpo: Record<string, unknown>) => tratarGeracao(new Request('https://x.supabase.co/functions/v1/contrato-gerar', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer jwt' }, body: JSON.stringify(corpo),
  }), r, portas)
  return { log, registros, desenhos, pedir }
}

describe('contrato-gerar', () => {
  it('sem sessão → 401; id inválido → 422; nada chamado', async () => {
    const a = geracao({ semSessao: true })
    expect((await a.pedir({ contrato_id: ID })).status).toBe(401)
    expect(a.log).toEqual(['auth'])
    const b = geracao()
    expect((await b.pedir({ contrato_id: 'x' })).status).toBe(422)
    expect(b.log).toEqual(['auth'])
  })

  it('a permissão é da RPC com o JWT: fora do escopo → 403 e nada é desenhado nem gravado', async () => {
    const c = geracao({ dados: falhou({ code: '42501', message: 'Sem acesso a este registro' }) })
    const res = await c.pedir({ contrato_id: ID })
    expect(res.status).toBe(403)
    expect(c.log).toEqual(['auth', 'usuario:contrato_dados_modelo'])
  })

  it('variável usada e vazia → 422 com a lista; nada é desenhado nem gravado', async () => {
    const c = geracao({ dados: ok({ ...DADOS, variaveis: { ...DADOS.variaveis, cep: null } }) })
    const res = await c.pedir({ contrato_id: ID })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ codigo: 'variaveis_faltando', detalhes: { desconhecidas: [], vazias: ['cep'] } })
    expect(c.log).toEqual(['auth', 'usuario:contrato_dados_modelo'])
  })

  it('gera a versão esperada (pdf_versao + 1), grava <id>/minuta-v<n>-<sha8>.pdf e registra com a service role os dois hashes', async () => {
    const c = geracao()
    const res = await c.pedir({ contrato_id: ID.toUpperCase() })
    const sha = await sha256Hex(PDF)
    const caminho = `${ID}/minuta-v3-${sha.slice(0, 8)}.pdf`
    expect(await res.json()).toEqual({ ok: true, versao: 3, path: caminho })
    expect(c.desenhos).toEqual([{ codigo: 123, versao: 3 }])
    expect(c.log).toEqual(['auth', 'usuario:contrato_dados_modelo', 'desenhar', `salvar:${caminho}`, 'sistema:contrato_registrar_documento'])
    const render = renderizarModelo(MODELO, DADOS.variaveis)
    if (!render.ok) throw new Error('modelo de teste inválido')
    expect(c.registros).toEqual([{ p_id: ID, p_versao: 3, p_path: caminho, p_sha256: sha, p_texto_sha256: await sha256Hex(render.texto) }])
  })

  it('WP4R-04: CONFLITO_VERSAO (a simulação mudou no meio) → apaga o arquivo recém-enviado e pede para gerar de novo', async () => {
    const c = geracao({ registro: falhou({ code: 'P0001', message: 'CONFLITO_VERSAO', details: '{"esperada":4,"recebida":3}' }) })
    const res = await c.pedir({ contrato_id: ID })
    expect(res.status).toBe(409)
    expect((await res.json()).erro).toBe('O contrato mudou enquanto o PDF era gerado. Gere de novo.')
    expect(c.log.at(-1)).toMatch(new RegExp(`^remover:${ID}/minuta-v3-[0-9a-f]{8}\\.pdf$`))
  })

  it('conflito com o arquivo que já existia (mesmo caminho = mesmo conteúdo) → não apaga', async () => {
    const c = geracao({ jaExistia: true, registro: falhou({ code: 'P0001', message: 'ENVIO_EM_ANDAMENTO' }) })
    const res = await c.pedir({ contrato_id: ID })
    expect(res.status).toBe(409)
    expect(c.log.some((l) => l.startsWith('remover:'))).toBe(false)
  })
})

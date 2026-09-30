import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EDGE_DOWNLOAD, urlDoDownload } from './rpc'
import { ErroRpc } from './erros'

// vi.hoisted e vi.mock sobem para antes dos imports: rpc.ts recebe o cliente simulado
const { invoke, storageFrom } = vi.hoisted(() => ({ invoke: vi.fn(), storageFrom: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { functions: { invoke }, storage: { from: storageFrom }, rpc: vi.fn() } }))

const autorizacao = { bucket: 'crm-documentos', path: 'd0/e0/f0.pdf', expira_em: '2026-09-28T12:01:00Z' } as const

/** Erro de `functions.invoke` para resposta fora de 2xx: `context` é a Response da Edge. */
const erroHttp = (status: number, corpo: unknown) => ({
  name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code',
  context: { status, json: async () => corpo },
})

describe('urlDoDownload (§4.3: download só pela Edge, nunca createSignedUrl no navegador)', () => {
  beforeEach(() => { invoke.mockReset(); storageFrom.mockReset() })

  it('pede a URL à Edge baixar-arquivo com o bucket e o caminho da autorização, sem prazo escolhido pelo cliente', async () => {
    invoke.mockResolvedValue({ data: { url: 'https://x.supabase.co/storage/v1/object/sign/crm-documentos/d0/e0/f0.pdf?token=t', expira_em: '…' }, error: null })
    await expect(urlDoDownload(autorizacao)).resolves.toContain('/object/sign/crm-documentos/')
    expect(EDGE_DOWNLOAD).toBe('baixar-arquivo')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('baixar-arquivo', { body: { bucket: 'crm-documentos', path: 'd0/e0/f0.pdf' } })
    expect(storageFrom).not.toHaveBeenCalled()
  })

  it('autorização vencida ou de outro usuário (403): SEM_ACESSO com a mensagem da Edge', async () => {
    invoke.mockResolvedValue({ data: null, error: erroHttp(403, { erro: 'O link de download expirou. Tente baixar de novo.', codigo: 'download_nao_autorizado' }) })
    const e = await urlDoDownload(autorizacao).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErroRpc)
    expect(e).toMatchObject({ codigo: 'SEM_ACESSO', message: 'O link de download expirou. Tente baixar de novo.', rpc: 'baixar-arquivo' })
  })

  it('sessão inválida (401): SESSAO_EXPIRADA; resposta sem URL: erro genérico', async () => {
    invoke.mockResolvedValue({ data: null, error: erroHttp(401, { erro: 'Sua sessão expirou. Entre de novo.' }) })
    await expect(urlDoDownload(autorizacao)).rejects.toMatchObject({ codigo: 'SESSAO_EXPIRADA' })
    invoke.mockResolvedValue({ data: {}, error: null })
    await expect(urlDoDownload(autorizacao)).rejects.toMatchObject({ codigo: 'DESCONHECIDO' })
  })
})

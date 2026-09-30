import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroRpc } from '@/lib/erros'

// supabase-js e a redução de imagem (canvas) simulados: aqui se testa a ordem das chamadas e o que vai para o servidor
const s = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  storageFrom: vi.fn(),
  from: vi.fn(),
  reduzir: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: s.rpc, from: s.from, storage: { from: s.storageFrom } } }))
vi.mock('./imagem', async (original) => ({ ...(await original<typeof import('./imagem')>()), reduzirImagem: s.reduzir }))

import { atualizarImovel, contratoDoImovel, enviarFoto, listarImoveis, removerFoto } from './api'
import { ErroImagem, RE_CAMINHO_FOTO } from './imagem'

const IMOVEL = 'e5000000-0000-4000-8000-000000000009'
const FOTO_ID = 'f0000000-0000-4000-8000-000000000001'

/** Construtor de consulta do PostgREST que registra cada chamada e resolve com `resultado`. */
function consulta(resultado: unknown) {
  const chamadas: [string, unknown[]][] = []
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'eq', 'is', 'or', 'ilike', 'order', 'range', 'in', 'limit']) {
    q[m] = (...args: unknown[]) => { chamadas.push([m, args]); return q }
  }
  q.maybeSingle = () => { chamadas.push(['maybeSingle', []]); return Promise.resolve(resultado) }
  q.single = () => { chamadas.push(['single', []]); return Promise.resolve(resultado) }
  q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, erro)
  return { q, chamadas }
}

beforeEach(() => {
  vi.clearAllMocks()
  s.storageFrom.mockReturnValue({ upload: s.upload, remove: s.remove })
  s.reduzir.mockResolvedValue({
    principal: new Blob(['p'], { type: 'image/webp' }), miniatura: new Blob(['m'], { type: 'image/webp' }),
    largura: 1920, altura: 1080, tipo: 'image/webp', extensao: 'webp',
  })
  s.upload.mockResolvedValue({ data: {}, error: null })
  s.remove.mockResolvedValue({ data: [], error: null })
})

describe('enviarFoto (§3.10, §4.4)', () => {
  const arquivo = new File(['x'], 'fachada.jpg', { type: 'image/jpeg' })

  it('reduz, envia principal e miniatura sem sobrescrever e só então registra pela RPC', async () => {
    s.rpc.mockResolvedValue({ data: FOTO_ID, error: null })
    await expect(enviarFoto(IMOVEL, arquivo, 5242880)).resolves.toBe(FOTO_ID)

    expect(s.reduzir).toHaveBeenCalledWith(arquivo, 5242880)
    expect(s.storageFrom).toHaveBeenCalledWith('imoveis')
    expect(s.upload).toHaveBeenCalledTimes(2)
    const [[principal, , op1], [miniatura, , op2]] = s.upload.mock.calls
    expect(principal).toMatch(RE_CAMINHO_FOTO)
    expect(principal.startsWith(`${IMOVEL}/`)).toBe(true)
    expect(miniatura).toBe(principal.replace(/\.webp$/, '-min.webp'))
    expect(op1).toMatchObject({ upsert: false, contentType: 'image/webp', metadata: { largura: 1920, altura: 1080 } })
    expect(op2).toMatchObject({ upsert: false, contentType: 'image/webp' })
    // nome do arquivo original (dado da pessoa) nunca vai para o caminho
    expect(principal).not.toContain('fachada')
    expect(s.rpc).toHaveBeenCalledWith('imovel_foto_registrar', { p_imovel_id: IMOVEL, p_path: principal, p_miniatura_path: miniatura })
    expect(s.remove).not.toHaveBeenCalled()
  })

  it('registro recusado (ex.: limite de fotos): apaga os dois arquivos e devolve o erro traduzido', async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'LIMITE_FOTOS', details: '{"maximo":20}' } })
    const erro = await enviarFoto(IMOVEL, arquivo, 5242880).catch((e) => e)
    expect(erro).toBeInstanceOf(ErroRpc)
    expect(erro.codigo).toBe('LIMITE_FOTOS')
    const [principal, miniatura] = s.upload.mock.calls.map((c) => c[0])
    expect(s.remove).toHaveBeenCalledWith([principal, miniatura])
  })

  it('miniatura recusada pelo bucket: apaga a principal e não registra', async () => {
    s.upload.mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'new row violates row-level security policy', status: 400, statusCode: '403' } })
    const erro = await enviarFoto(IMOVEL, arquivo, 5242880).catch((e) => e)
    expect(erro.codigo).toBe('SEM_ACESSO')
    expect(s.remove).toHaveBeenCalledWith([s.upload.mock.calls[0][0]])
    expect(s.rpc).not.toHaveBeenCalled()
  })

  it('imagem ilegível: nada vai para o bucket', async () => {
    s.reduzir.mockRejectedValue(new ErroImagem('Não foi possível ler esta imagem.'))
    await expect(enviarFoto(IMOVEL, arquivo, 5242880)).rejects.toBeInstanceOf(ErroImagem)
    expect(s.upload).not.toHaveBeenCalled()
    expect(s.rpc).not.toHaveBeenCalled()
  })
})

describe('removerFoto', () => {
  const foto = { id: FOTO_ID, storage_path: `${IMOVEL}/a.webp`, miniatura_path: `${IMOVEL}/a-min.webp` }

  it('remove o registro pela RPC e depois os arquivos', async () => {
    s.rpc.mockResolvedValue({ data: null, error: null })
    await removerFoto(foto)
    expect(s.rpc).toHaveBeenCalledWith('imovel_foto_remover', { p_id: FOTO_ID })
    expect(s.remove).toHaveBeenCalledWith([foto.storage_path, foto.miniatura_path])
    expect(s.rpc.mock.invocationCallOrder[0]).toBeLessThan(s.remove.mock.invocationCallOrder[0])
  })

  it('RPC negada: os arquivos ficam', async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Sem acesso a este registro' } })
    await expect(removerFoto(foto)).rejects.toMatchObject({ codigo: 'SEM_ACESSO' })
    expect(s.remove).not.toHaveBeenCalled()
  })
})

describe('leitura e edição direta na tabela (RLS E4 + grant por coluna)', () => {
  it('lista: aba, só ativos, busca por código e paginação de 20', async () => {
    const { q, chamadas } = consulta({ data: [], error: null, count: 0 })
    s.from.mockReturnValue(q)
    await expect(listarImoveis({ aba: 'pendente', busca: '#0000012', offset: 20, inativos: false, criadoPor: null }))
      .resolves.toEqual({ total: 0, itens: [] })
    expect(s.from).toHaveBeenCalledWith('imoveis')
    expect(chamadas).toContainEqual(['eq', ['status', 'pendente']])
    expect(chamadas).toContainEqual(['is', ['inativado_em', null]])
    expect(chamadas).toContainEqual(['or', ['codigo.eq.12,nome.ilike.*12*']])
    expect(chamadas).toContainEqual(['range', [20, 39]])
  })

  it('lista: busca por nome com curingas escapados, sem filtro de status', async () => {
    const { q, chamadas } = consulta({ data: [], error: null, count: 0 })
    s.from.mockReturnValue(q)
    await listarImoveis({ aba: 'todos', busca: 'Casa 100%', offset: 0, inativos: true, criadoPor: 'u1' })
    expect(chamadas).toContainEqual(['ilike', ['nome', '%Casa 100\\%%']])
    expect(chamadas).toContainEqual(['eq', ['criado_por', 'u1']])
    expect(chamadas.some(([m, a]) => m === 'eq' && a[0] === 'status')).toBe(false)
    expect(chamadas.some(([m]) => m === 'is')).toBe(false)
  })

  it('edição que a política filtrou (0 linhas) vira mensagem clara, não sucesso silencioso', async () => {
    const { q, chamadas } = consulta({ data: null, error: null })
    s.from.mockReturnValue(q)
    const erro = await atualizarImovel(IMOVEL, { nome: 'Novo nome' }).catch((e) => e)
    expect(erro).toBeInstanceOf(ErroRpc)
    expect(erro.message).toMatch(/mudou de status/)
    expect(chamadas[0]).toEqual(['update', [{ nome: 'Novo nome' }]])
  })
})

describe('contratoDoImovel (§7.3: em NC, link para o contrato)', () => {
  const contrato = (id: string, produto: Record<string, unknown>) => ({ id, codigo: 1, produto })

  it('filtra pelo próprio imóvel (imovel_id) nos contratos em assinatura ou assinados: sem busca por nome', async () => {
    s.rpc.mockResolvedValue({ data: { total: 1, itens: [contrato('k3', { tipo: 'imovel', id: IMOVEL, nome: 'Casa do Lago' })] }, error: null })
    await expect(contratoDoImovel({ id: IMOVEL })).resolves.toBe('k3')
    expect(s.rpc).toHaveBeenCalledTimes(1)
    expect(s.rpc).toHaveBeenCalledWith('contratos_listar', {
      p_filtros: { imovel_id: IMOVEL, status: ['assinatura_pendente', 'assinado'], limite: 1, offset: 0 },
    })
    expect(s.rpc.mock.calls[0][1].p_filtros).not.toHaveProperty('busca')
  })

  it('funciona com nome comum, longo ou vazio (o nome não entra na consulta)', async () => {
    s.rpc.mockResolvedValue({ data: { total: 1, itens: [contrato('k9', { tipo: 'imovel', id: IMOVEL, nome: 'x'.repeat(300) })] }, error: null })
    await expect(contratoDoImovel({ id: IMOVEL, nome: 'x'.repeat(300) } as { id: string })).resolves.toBe('k9')
    await expect(contratoDoImovel({ id: IMOVEL, nome: '' } as { id: string })).resolves.toBe('k9')
    expect(s.rpc).toHaveBeenCalledTimes(2)
  })

  it('defesa: ignora item de outro produto que venha na lista', async () => {
    s.rpc.mockResolvedValue({
      data: {
        total: 2,
        itens: [
          contrato('k1', { tipo: 'imovel', id: 'outro-imovel', nome: 'Casa do Lago 2' }),
          contrato('k2', { tipo: 'unidade', id: IMOVEL, nome: 'Residencial · 101' }),
        ],
      },
      error: null,
    })
    await expect(contratoDoImovel({ id: IMOVEL })).resolves.toBeNull()
  })

  it('fora do escopo (nenhum contrato do imóvel na lista) devolve nulo', async () => {
    s.rpc.mockResolvedValue({ data: { total: 0, itens: [] }, error: null })
    await expect(contratoDoImovel({ id: IMOVEL })).resolves.toBeNull()
    s.rpc.mockResolvedValue({ data: null, error: null })
    await expect(contratoDoImovel({ id: IMOVEL })).resolves.toBeNull()
  })

  it('erro da RPC sai traduzido', async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Sem acesso a este registro' } })
    await expect(contratoDoImovel({ id: IMOVEL })).rejects.toMatchObject({ codigo: 'SEM_ACESSO' })
  })
})

import { describe, expect, it } from 'vitest'
import { ErroRpc } from '@/lib/erros'
import { erroDoStorage, interrompeEnvio, mensagemDoEnvio, planejarEnvio, vagasDeFotos } from './envio'
import { ErroImagem, ORIGINAL_MAX_BYTES } from './imagem'

const arq = (name: string, type = 'image/jpeg', size = 1000) => ({ name, type, size })

describe('planejarEnvio', () => {
  it('recusa o que não é JPG/PNG/WEBP, vazio ou grande demais, e respeita as vagas', () => {
    const p = planejarEnvio([
      arq('a.jpg'), arq('b.gif', 'image/gif'), arq('c.png', 'image/png'), arq('d.webp', 'image/webp', 0),
      arq('e.webp', 'image/webp'), arq('f.jpg', 'image/jpeg', ORIGINAL_MAX_BYTES + 1), arq('g.jpg'),
    ], 2)
    expect(p.enviar.map((a) => a.name)).toEqual(['a.jpg', 'c.png'])
    expect(p.recusados.map((r) => r.arquivo.name)).toEqual(['b.gif', 'd.webp', 'f.jpg'])
    expect(p.recusados[0].motivo).toMatch(/JPG, PNG ou WEBP/)
    expect(p.excedentes).toBe(2)
  })
  it('sem vagas não envia nada', () => {
    expect(planejarEnvio([arq('a.jpg')], 0)).toMatchObject({ enviar: [], excedentes: 1 })
    expect(planejarEnvio([arq('a.jpg')], -3)).toMatchObject({ enviar: [], excedentes: 1 })
  })
  it('vagas até o limite configurado', () => {
    expect(vagasDeFotos(3, 20)).toBe(17)
    expect(vagasDeFotos(25, 20)).toBe(0)
  })
})

describe('erroDoStorage', () => {
  it('RLS do bucket (política pode_editar_imovel) vira sem acesso', () => {
    const e = erroDoStorage({ name: 'StorageApiError', message: 'new row violates row-level security policy', status: 400, statusCode: '403' })
    expect(e).toBeInstanceOf(ErroRpc)
    expect(e.codigo).toBe('SEM_ACESSO')
    expect(erroDoStorage({ message: 'x', status: 403 }).codigo).toBe('SEM_ACESSO')
  })
  it('tamanho ou tipo recusado pelo bucket vira arquivo inválido', () => {
    expect(erroDoStorage({ message: 'The object exceeded the maximum allowed size', status: 413 }).codigo).toBe('ARQUIVO_INVALIDO')
    expect(erroDoStorage({ message: 'mime type image/gif is not supported', status: 400, code: 'InvalidMimeType' }).codigo).toBe('ARQUIVO_INVALIDO')
  })
  it('sessão vencida', () => {
    expect(erroDoStorage({ message: 'jwt expired', status: 401 }).codigo).toBe('SESSAO_EXPIRADA')
  })
  it('mensagem em inglês desconhecida nunca vai para a tela', () => {
    const e = erroDoStorage({ message: 'Internal Server Error', status: 500 })
    expect(e.codigo).toBe('DESCONHECIDO')
    expect(e.message).not.toMatch(/Internal/)
  })
  it('ErroRpc passa direto', () => {
    const r = new ErroRpc('LIMITE_FOTOS', 'limite')
    expect(erroDoStorage(r)).toBe(r)
  })
})

describe('mensagens do envio', () => {
  it('a mensagem da redução no navegador vai como está; a do servidor é traduzida', () => {
    expect(mensagemDoEnvio(new ErroImagem('A imagem é grande demais.'))).toBe('A imagem é grande demais.')
    expect(mensagemDoEnvio({ code: 'P0001', message: 'LIMITE_FOTOS', details: '{"maximo":20}' })).toBe('O limite de fotos deste imóvel foi atingido.')
    expect(mensagemDoEnvio(new Error('boom'))).toBe('Não foi possível concluir a operação. Tente de novo.')
  })
  it('limite, acesso e sessão interrompem a fila; foto ruim não', () => {
    expect(interrompeEnvio({ code: 'P0001', message: 'LIMITE_FOTOS' })).toBe(true)
    expect(interrompeEnvio({ code: '42501', message: 'Sem acesso a este registro' })).toBe(true)
    expect(interrompeEnvio({ code: 'P0001', message: 'ARQUIVO_INVALIDO', details: '{"motivo":"tamanho_ou_tipo"}' })).toBe(false)
    expect(interrompeEnvio(new ErroImagem('corrompida'))).toBe(false)
  })
})

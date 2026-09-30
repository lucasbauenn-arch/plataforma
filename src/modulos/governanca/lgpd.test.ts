import { describe, expect, it } from 'vitest'
import { esquemaAnonimizacao, idCliente, lerResultado } from './lgpd'

describe('pedido de anonimização', () => {
  it('protocolo e palavra de confirmação', () => {
    expect(esquemaAnonimizacao.safeParse({ protocolo: 'LGPD-2026/001', confirmacao: 'ANONIMIZAR' }).success).toBe(true)
    expect(esquemaAnonimizacao.safeParse({ protocolo: 'a b', confirmacao: 'ANONIMIZAR' }).success).toBe(false)
    expect(esquemaAnonimizacao.safeParse({ protocolo: 'ab', confirmacao: 'ANONIMIZAR' }).success).toBe(false)
    expect(esquemaAnonimizacao.safeParse({ protocolo: 'LGPD-1', confirmacao: 'anonimizar' }).success).toBe(false)
  })

  it('id do cliente', () => {
    expect(idCliente.safeParse(' D0000000-0000-4000-8000-000000000001 ').data).toBe('d0000000-0000-4000-8000-000000000001')
    expect(idCliente.safeParse('x').success).toBe(false)
  })

  it('resposta da Edge', () => {
    expect(lerResultado(200, { ok: true, arquivos_apagados: 2, usuario_removido: true }))
      .toEqual({ situacao: 'concluida', arquivos: 2, usuarioRemovido: true })
    expect(lerResultado(502, { erro: 'Tente de novo para concluir.', codigo: 'remocao_incompleta' }))
      .toEqual({ situacao: 'incompleta', mensagem: 'Tente de novo para concluir.' })
    expect(lerResultado(422, { erro: 'Há contrato aguardando assinatura.', codigo: 'regra_de_negocio' }))
      .toEqual({ situacao: 'erro', mensagem: 'Há contrato aguardando assinatura.' })
    expect(lerResultado(500, null)).toMatchObject({ situacao: 'erro' })
  })
})

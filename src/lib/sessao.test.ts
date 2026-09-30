import { describe, expect, it, vi } from 'vitest'
import { acaoAoMudarSessao, criarVigiaInatividade, ESCOPO_SAIDA_INATIVIDADE } from './sessao'

describe('acaoAoMudarSessao (cache do escopo)', () => {
  it('troca de usuário ou saída limpa o cache; a sessão inicial não mexe', () => {
    expect(acaoAoMudarSessao('SIGNED_IN', null, 'u1')).toBe('limpar_cache')
    expect(acaoAoMudarSessao('SIGNED_IN', 'u1', 'u2')).toBe('limpar_cache')
    expect(acaoAoMudarSessao('SIGNED_OUT', 'u1', null)).toBe('limpar_cache')
    expect(acaoAoMudarSessao('INITIAL_SESSION', null, 'u1')).toBe('nada')
  })

  it('2FA concluída (mesmo usuário, aal1 → aal2) recarrega o escopo: o admin não fica preso na tela de Segurança', () => {
    expect(acaoAoMudarSessao('MFA_CHALLENGE_VERIFIED', 'u1', 'u1')).toBe('recarregar_escopo')
  })

  it('token renovado, usuário atualizado ou novo login do mesmo usuário também recarregam o escopo', () => {
    for (const e of ['TOKEN_REFRESHED', 'USER_UPDATED', 'SIGNED_IN'] as const) expect(acaoAoMudarSessao(e, 'u1', 'u1')).toBe('recarregar_escopo')
  })

  it('sem usuário ou evento sem efeito no JWT: nada', () => {
    expect(acaoAoMudarSessao('PASSWORD_RECOVERY', 'u1', 'u1')).toBe('nada')
    expect(acaoAoMudarSessao('TOKEN_REFRESHED', null, null)).toBe('nada')
  })
})

/** Armazenamento em memória com a interface do localStorage. */
function memoria() {
  const m = new Map<string, string>()
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
  }
}

describe('criarVigiaInatividade (H1)', () => {
  const HORA = 3_600_000
  const chave = 'arken:atividade:s1'

  function montar(inicio = 1_000_000, armazenamento: ReturnType<typeof memoria> | null = memoria()) {
    let agora = inicio
    const aoExpirar = vi.fn()
    const vigia = criarVigiaInatividade({ chave, limiteMs: 8 * HORA, armazenamento, agora: () => agora, aoExpirar })
    return { vigia, aoExpirar, armazenamento, avancar: (ms: number) => { agora += ms }, agora: () => agora }
  }

  it('expira depois do limite sem uso, uma vez só, e encerra SÓ esta sessão (signOut local, não global)', () => {
    const t = montar()
    t.avancar(8 * HORA - 1)
    t.vigia.verificar()
    expect(t.aoExpirar).not.toHaveBeenCalled()
    t.avancar(1)
    t.vigia.verificar()
    t.vigia.verificar()
    expect(t.aoExpirar).toHaveBeenCalledTimes(1)
    expect(t.aoExpirar).toHaveBeenCalledWith('local')
    expect(ESCOPO_SAIDA_INATIVIDADE).toBe('local')
    expect(t.vigia.expirou).toBe(true)
    expect(t.armazenamento?.m.has(chave)).toBe(false)
  })

  it('atividade nesta aba adia a expiração', () => {
    const t = montar()
    t.avancar(7 * HORA)
    t.vigia.atividade()
    t.avancar(7 * HORA)
    t.vigia.verificar()
    expect(t.aoExpirar).not.toHaveBeenCalled()
    t.avancar(HORA)
    t.vigia.verificar()
    expect(t.aoExpirar).toHaveBeenCalledTimes(1)
  })

  it('atividade em outra aba (mesma sessão, pelo armazenamento) também adia', () => {
    const t = montar()
    t.avancar(7 * HORA)
    t.armazenamento!.setItem(chave, String(t.agora()))
    t.avancar(7 * HORA)
    t.vigia.verificar()
    expect(t.aoExpirar).not.toHaveBeenCalled()
  })

  it('navegador reaberto com a sessão guardada: conta desde a última atividade gravada', () => {
    const armazenamento = memoria()
    armazenamento.setItem(chave, String(1_000_000))
    const t = montar(1_000_000 + 9 * HORA, armazenamento)
    t.vigia.verificar()
    expect(t.aoExpirar).toHaveBeenCalledWith('local')
  })

  it('sem armazenamento (modo privado) vale a memória desta aba', () => {
    const t = montar(1_000_000, null)
    t.vigia.atividade()
    t.avancar(8 * HORA)
    t.vigia.verificar()
    expect(t.aoExpirar).toHaveBeenCalledTimes(1)
  })
})

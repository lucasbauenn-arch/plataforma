import { describe, expect, it } from 'vitest'
import {
  conviteDeuCerto, lerLinkSenha, MAXIMO_CONVITES, mensagemConvite, montarPedidoConvite, problemaSenha, resumirConvites,
  STATUS_CONVITE, type ResultadoConvite,
} from './convites'
// fluxo puro da Edge (sem Deno nem supabase-js): testado aqui porque o Vitest só coleta src/** e _shared/**
import {
  contaRecemCriada, convidarUm, FOLGA_RELOGIO_MS, lerPedido, MENSAGENS as MENSAGENS_EDGE, STATUS as STATUS_EDGE,
  type ContaAuth, type Dependencias, type ErroApi, type PodeConvidar,
} from '../../supabase/functions/convidar-parceiros/fluxo.ts'

const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

describe('montarPedidoConvite', () => {
  it('tira repetidos, normaliza e leva modo e origem', () => {
    expect(montarPedidoConvite([ID1, ID1.toUpperCase(), ` ${ID2} `], 'email', 'https://arkenincorporadora.com.br')).toEqual({
      parceiro_ids: [ID1, ID2], modo: 'email', origem: 'https://arkenincorporadora.com.br',
    })
  })
  it('recusa seleção vazia, grande demais ou com id inválido', () => {
    expect(() => montarPedidoConvite([], 'link', 'x')).toThrow('Selecione ao menos um parceiro.')
    const muitos = Array.from({ length: MAXIMO_CONVITES + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect(() => montarPedidoConvite(muitos, 'link', 'x')).toThrow(`no máximo ${MAXIMO_CONVITES}`)
    expect(() => montarPedidoConvite(['nao-e-uuid'], 'link', 'x')).toThrow('Seleção inválida')
  })
})

describe('resumirConvites', () => {
  const r = (status: ResultadoConvite['status']): ResultadoConvite => ({ parceiro_id: ID1, nome: 'A', email: null, status, mensagem: '' })
  it('conta os enviados e os que falharam, no modo certo', () => {
    expect(resumirConvites([r('convidado'), r('reenviado'), r('email_em_uso')], 'email')).toBe('2 convites enviados por e-mail; 1 não enviado.')
    expect(resumirConvites([r('convidado')], 'link')).toBe('1 link gerado.')
    expect(resumirConvites([r('erro'), r('ja_ativo')], 'link')).toBe('2 não enviados.')
    expect(resumirConvites([], 'email')).toBe('Nenhum convite enviado.')
  })
  it('só convidado e reenviado contam como sucesso', () => {
    expect(conviteDeuCerto('convidado')).toBe(true)
    expect(conviteDeuCerto('reenviado')).toBe(true)
    expect(conviteDeuCerto('ja_ativo')).toBe(false)
    expect(conviteDeuCerto('modo_nao_permitido')).toBe(false)
  })
})

describe('mensagemConvite', () => {
  it('usa o primeiro nome e inclui o link', () => {
    const m = mensagemConvite('Maria Souza', 'https://x/y')
    expect(m.startsWith('Olá, Maria!')).toBe(true)
    expect(m).toContain('https://x/y')
    expect(m).toContain('24 h')
  })
  it('sem nome', () => expect(mensagemConvite('  ', 'L').startsWith('Olá!')).toBe(true))
  it('nome nulo', () => expect(mensagemConvite(null, 'L').startsWith('Olá!')).toBe(true))
})

describe('lerLinkSenha', () => {
  const hash = 'a'.repeat(56)
  it('lê token_hash e type sem consumir nada', () => {
    expect(lerLinkSenha(`?token_hash=${hash}&type=invite`, ['invite', 'recovery'])).toEqual({ tokenHash: hash, tipo: 'invite' })
    expect(lerLinkSenha(`?type=recovery&token_hash=pkce_${hash}`, ['recovery'])).toEqual({ tokenHash: `pkce_${hash}`, tipo: 'recovery' })
  })
  it('recusa tipo não aceito pela página', () => {
    expect(lerLinkSenha(`?token_hash=${hash}&type=invite`, ['recovery'])).toBeNull()
    expect(lerLinkSenha(`?token_hash=${hash}&type=signup`, ['invite', 'recovery'])).toBeNull()
  })
  it('recusa token ausente, curto ou com caracteres estranhos', () => {
    expect(lerLinkSenha('?type=invite', ['invite'])).toBeNull()
    expect(lerLinkSenha('?token_hash=abc&type=invite', ['invite'])).toBeNull()
    expect(lerLinkSenha(`?token_hash=${hash}<script>&type=invite`, ['invite'])).toBeNull()
    expect(lerLinkSenha('', ['invite'])).toBeNull()
  })
})

describe('problemaSenha', () => {
  it('exige 8 caracteres, letras e números e a confirmação igual', () => {
    expect(problemaSenha('abc12', 'abc12')).toBe('Use pelo menos 8 caracteres.')
    expect(problemaSenha('abcdefgh', 'abcdefgh')).toBe('Use letras e números.')
    expect(problemaSenha('12345678', '12345678')).toBe('Use letras e números.')
    expect(problemaSenha('senha1234', 'senha12345')).toBe('As senhas não conferem.')
    expect(problemaSenha('x'.repeat(70) + '123', 'x'.repeat(70) + '123')).toBe('Use no máximo 72 caracteres.')
    expect(problemaSenha('senha1234', 'senha1234')).toBeNull()
  })
})

// ---------- Edge convidar-parceiros: fluxo puro (supabase/functions/convidar-parceiros/fluxo.ts) ----------
// Dublê do mundo: Auth (contas por e-mail), vínculos parceiro ↔ conta, auditoria e e-mails enviados. [WP1R-02]

type ContaSim = ContaAuth & { email: string }
interface Mundo {
  pode: { data: PodeConvidar | null; error: ErroApi }
  contas: Map<string, ContaSim>
  vinculos: Map<string, string>
  chamadas: string[]
  emails: string[]
  registros: string[]
  erros: string[]
  relogio: number
  /** Resposta do vínculo: 'ok' grava; um erro não grava; 'grava_e_falha' grava, mas a resposta se perde. */
  vinculo: 'ok' | 'grava_e_falha' | ErroApi
  falhaRegistrar: ErroApi
  falhaEnviar: ErroApi
  falhaApagar: ErroApi
}

const PARC = '33333333-3333-4333-8333-333333333333'
const AGORA = Date.parse('2026-09-29T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

function mundo(pode: Partial<PodeConvidar> | { erro: ErroApi }, extra: Partial<Mundo> = {}): Mundo {
  const base: PodeConvidar = { pode: true, situacao: 'novo', email: 'novo@x.test', nome: 'Nova Pessoa', modo_link: true, profile_id: null }
  return {
    pode: 'erro' in pode ? { data: null, error: pode.erro } : { data: { ...base, ...pode }, error: null },
    contas: new Map(), vinculos: new Map(), chamadas: [], emails: [], registros: [], erros: [], relogio: AGORA,
    vinculo: 'ok', falhaRegistrar: null, falhaEnviar: null, falhaApagar: null, ...extra,
  }
}

let seq = 0
function deps(m: Mundo): Dependencias {
  const porEmail = (email: string) => [...m.contas.values()].find((c) => c.email === email) ?? null
  return {
    podeConvidar: async () => { m.chamadas.push('pode'); return m.pode },
    gerarConvite: async (email) => {
      m.chamadas.push('gerar')
      let c = porEmail(email)
      if (c?.email_confirmed_at) return { conta: null, tokenHash: null, error: { code: 'email_exists', message: 'already registered' } }
      if (!c) {
        c = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, email, created_at: iso(m.relogio + 500), invited_at: null, last_sign_in_at: null, email_confirmed_at: null }
        m.contas.set(c.id, c)
      }
      c.invited_at = iso(m.relogio + 500)
      return { conta: { ...c }, tokenHash: 'h'.repeat(56), error: null }
    },
    enviarConvite: async (email) => {
      m.chamadas.push('enviar')
      if (m.falhaEnviar) return { conta: null, error: m.falhaEnviar }
      const c = porEmail(email)
      if (!c) return { conta: null, error: { message: 'conta inexistente no dublê' } }
      m.emails.push(email)
      return { conta: { ...c }, error: null }
    },
    vincular: async (parceiroId, contaId) => {
      m.chamadas.push('vincular')
      if (m.vinculo === 'ok' || m.vinculo === 'grava_e_falha') m.vinculos.set(contaId, parceiroId)
      if (m.vinculo === 'ok') return { error: null }
      return { error: m.vinculo === 'grava_e_falha' ? { message: 'TypeError: fetch failed' } : m.vinculo }
    },
    registrar: async (parceiroId, modo) => {
      m.chamadas.push('registrar')
      if (m.falhaRegistrar) return { error: m.falhaRegistrar }
      m.registros.push(`${parceiroId}:${modo}`)
      return { error: null }
    },
    vinculoDaConta: async (contaId) => ({ parceiroId: m.vinculos.get(contaId) ?? null, error: null }),
    buscarConta: async (contaId) => ({ conta: m.contas.get(contaId) ?? null, error: null }),
    apagarConta: async (contaId) => {
      m.chamadas.push('apagar')
      if (m.falhaApagar) return { error: m.falhaApagar }
      m.contas.delete(contaId)
      return { error: null }
    },
    agora: () => m.relogio,
    registrarErro: (etapa) => { m.erros.push(etapa) },
  }
}

const BASE = 'https://arkenincorporadora.com.br'
const recusa = (motivo: string): ErroApi => ({ code: 'P0001', message: 'DADOS_INVALIDOS', details: JSON.stringify({ motivo }) })

describe('Edge convidar-parceiros: situações que não tocam no Auth', () => {
  it.each(['email_em_uso', 'ja_ativo', 'sem_email', 'indisponivel'] as const)('%s: nenhum link, nenhuma conta', async (situacao) => {
    const m = mundo({ situacao, pode: false })
    const r = await convidarUm(deps(m), PARC, 'link', BASE)
    expect(r.status).toBe(situacao)
    expect(r.link).toBeUndefined()
    expect(m.chamadas).toEqual(['pode'])
  })
  it('sem acesso (42501) e limite por hora (LIMITE_CONVITES) viram status próprios', async () => {
    const semAcesso = mundo({ erro: { code: '42501', message: 'Sem acesso a este registro' } })
    expect((await convidarUm(deps(semAcesso), PARC, 'email', BASE)).status).toBe('sem_permissao')
    const limite = mundo({ erro: { code: 'P0001', message: 'LIMITE_CONVITES' } })
    const r = await convidarUm(deps(limite), PARC, 'email', BASE)
    expect(r.status).toBe('limite')
    expect(r.mensagem).toMatch(/Aguarde/)
    expect(limite.chamadas).toEqual(['pode'])
  })
  it('link sem convite_por_link: só por e-mail', async () => {
    const m = mundo({ modo_link: false })
    expect((await convidarUm(deps(m), PARC, 'link', BASE)).status).toBe('modo_nao_permitido')
    expect(m.chamadas).toEqual(['pode'])
  })
  it('a mensagem de e-mail em uso não promete um vínculo que não existe', () => {
    expect(MENSAGENS_EDGE.email_em_uso).not.toMatch(/vincular/i)
    expect(MENSAGENS_EDGE.email_em_uso).toMatch(/nenhum convite/)
  })
})

describe('Edge convidar-parceiros: novo (WP1R-02)', () => {
  it('e-mail: a conta nasce sem e-mail, é vinculada e auditada, e só então o e-mail sai', async () => {
    const m = mundo({})
    const r = await convidarUm(deps(m), PARC, 'email', BASE)
    expect(r.status).toBe('convidado')
    expect(m.chamadas).toEqual(['pode', 'gerar', 'vincular', 'registrar', 'enviar'])
    expect(m.emails).toEqual(['novo@x.test'])
    expect(m.registros).toEqual([`${PARC}:email`])
    expect([...m.vinculos.values()]).toEqual([PARC])
  })
  it('link: vinculado e auditado antes de devolver o link de definir senha (nenhum e-mail)', async () => {
    const m = mundo({})
    const r = await convidarUm(deps(m), PARC, 'link', BASE)
    expect(r.status).toBe('convidado')
    expect(r.link).toBe(`${BASE}/parceiros/definir-senha?token_hash=${'h'.repeat(56)}&type=invite`)
    expect(m.chamadas).toEqual(['pode', 'gerar', 'vincular', 'registrar'])
    expect(m.emails).toEqual([])
  })
  it('vínculo recusado: a conta criada por este convite é apagada e nada é enviado (sem conta órfã)', async () => {
    for (const modo of ['email', 'link'] as const) {
      for (const motivo of ['email_diferente', 'parceiro', 'parceiro_ja_vinculado']) {
        const m = mundo({}, { vinculo: recusa(motivo) })
        const r = await convidarUm(deps(m), PARC, modo, BASE)
        expect(r.status).toBe('erro')
        expect(r.link).toBeUndefined()
        expect(r.mensagem).toMatch(/Nenhum convite foi enviado/)
        expect(m.contas.size).toBe(0)
        expect(m.emails).toEqual([])
        expect(m.registros).toEqual([])
        expect(m.chamadas).toEqual(['pode', 'gerar', 'vincular', 'apagar'])
      }
    }
  })
  it('recusa que indica conta de outra pessoa ou de outro fluxo: a conta nunca é apagada', async () => {
    for (const motivo of ['com_senha', 'ja_entrou', 'perfil_antigo', 'perfil', 'perfil_vinculado', 'nao_convidado']) {
      const m = mundo({}, { vinculo: recusa(motivo) })
      const r = await convidarUm(deps(m), PARC, 'email', BASE)
      expect(r.status).toBe('erro')
      expect(m.contas.size).toBe(1)
      expect(m.chamadas).not.toContain('apagar')
      expect(m.emails).toEqual([])
    }
  })
  it('resposta do vínculo perdida, mas o vínculo foi gravado: o convite segue', async () => {
    const m = mundo({}, { vinculo: 'grava_e_falha' })
    const r = await convidarUm(deps(m), PARC, 'email', BASE)
    expect(r.status).toBe('convidado')
    expect(m.chamadas).not.toContain('apagar')
    expect(m.emails).toEqual(['novo@x.test'])
  })
  it('falha sem resposta do banco e conta sem vínculo: apaga só se nasceu nesta chamada e nunca foi usada', async () => {
    const falha: ErroApi = { message: 'TypeError: fetch failed' }
    const nova = mundo({}, { vinculo: falha })
    await convidarUm(deps(nova), PARC, 'email', BASE)
    expect(nova.contas.size).toBe(0)

    const antiga = mundo({}, { vinculo: falha })
    antiga.contas.set('00000000-0000-4000-8000-0000000000aa', {
      id: '00000000-0000-4000-8000-0000000000aa', email: 'novo@x.test', created_at: iso(AGORA - FOLGA_RELOGIO_MS - 1000),
      invited_at: null, last_sign_in_at: null, email_confirmed_at: null,
    })
    await convidarUm(deps(antiga), PARC, 'email', BASE)
    expect(antiga.contas.size).toBe(1)
    expect(antiga.chamadas).not.toContain('apagar')
  })
  it('falha ao apagar: avisa para falar com a equipe (a conta ficou)', async () => {
    const m = mundo({}, { vinculo: recusa('email_diferente'), falhaApagar: { message: 'erro' } })
    const r = await convidarUm(deps(m), PARC, 'email', BASE)
    expect(r.mensagem).toMatch(/equipe Arken/)
    expect(m.emails).toEqual([])
  })
  it('conta que já entrou ou confirmou o e-mail nunca é apagada', () => {
    const c: ContaAuth = { id: 'x', created_at: iso(AGORA), invited_at: iso(AGORA), last_sign_in_at: null, email_confirmed_at: null }
    expect(contaRecemCriada(c, AGORA)).toBe(true)
    expect(contaRecemCriada({ ...c, last_sign_in_at: iso(AGORA) }, AGORA)).toBe(false)
    expect(contaRecemCriada({ ...c, email_confirmed_at: iso(AGORA) }, AGORA)).toBe(false)
    expect(contaRecemCriada({ ...c, invited_at: null }, AGORA)).toBe(false)
    expect(contaRecemCriada({ ...c, created_at: 'lixo' }, AGORA)).toBe(false)
  })
  it('sem auditoria, nada é entregue (nem link, nem e-mail)', async () => {
    for (const modo of ['email', 'link'] as const) {
      const m = mundo({}, { falhaRegistrar: { message: 'erro' } })
      const r = await convidarUm(deps(m), PARC, modo, BASE)
      expect(r.status).toBe('erro')
      expect(r.link).toBeUndefined()
      expect(m.emails).toEqual([])
    }
  })
  it('e-mail que falha depois do vínculo: erro com orientação para reenviar (a conta fica vinculada)', async () => {
    const m = mundo({}, { falhaEnviar: { message: 'rate limit' } })
    const r = await convidarUm(deps(m), PARC, 'email', BASE)
    expect(r.status).toBe('erro')
    expect(r.mensagem).toMatch(/reenviar/)
    expect([...m.vinculos.values()]).toEqual([PARC])
  })
  it('corrida: o Auth diz que o e-mail já tem conta confirmada → email_em_uso', async () => {
    const m = mundo({})
    m.contas.set('c', { id: 'c', email: 'novo@x.test', created_at: null, email_confirmed_at: iso(AGORA) })
    expect((await convidarUm(deps(m), PARC, 'email', BASE)).status).toBe('email_em_uso')
    expect(m.chamadas).toEqual(['pode', 'gerar'])
  })
})

describe('Edge convidar-parceiros: reenviar', () => {
  const PERFIL = '00000000-0000-4000-8000-0000000000bb'
  const comConta = (extra: Partial<Mundo> = {}) => {
    const m = mundo({ situacao: 'reenviar', profile_id: PERFIL, email: 'ja@x.test' }, extra)
    m.contas.set(PERFIL, { id: PERFIL, email: 'ja@x.test', created_at: iso(AGORA - 86_400_000), invited_at: iso(AGORA - 86_400_000) })
    m.vinculos.set(PERFIL, PARC)
    return m
  }
  it('e-mail: audita e reenvia para a MESMA conta', async () => {
    const m = comConta()
    const r = await convidarUm(deps(m), PARC, 'email', BASE)
    expect(r.status).toBe('reenviado')
    expect(m.chamadas).toEqual(['pode', 'registrar', 'enviar'])
  })
  it('link: confere que o Auth devolveu a conta vinculada antes de auditar e entregar', async () => {
    const m = comConta()
    const r = await convidarUm(deps(m), PARC, 'link', BASE)
    expect(r.status).toBe('reenviado')
    expect(r.link).toContain('type=invite')
    const outra = mundo({ situacao: 'reenviar', profile_id: PERFIL, email: 'ja@x.test' })
    const r2 = await convidarUm(deps(outra), PARC, 'link', BASE)   // o Auth cria/devolve outra conta
    expect(r2.status).toBe('erro')
    expect(outra.registros).toEqual([])
  })
})

describe('Edge convidar-parceiros: pedido e status', () => {
  it('lerPedido valida ids e modo e tira repetidos', () => {
    expect(lerPedido({ parceiro_ids: [ID1, ID1.toUpperCase()], modo: 'email', origem: ' https://x ' })).toEqual({ ok: true, valor: { ids: [ID1], modo: 'email', origem: 'https://x' } })
    expect(lerPedido({ parceiro_ids: [], modo: 'email' })).toMatchObject({ ok: false })
    expect(lerPedido({ parceiro_ids: ['x'], modo: 'email' })).toMatchObject({ ok: false, erro: 'Parceiro inválido.' })
    expect(lerPedido({ parceiro_ids: [ID1], modo: 'whatsapp' })).toMatchObject({ ok: false, erro: 'Modo de convite inválido.' })
  })
  it('o front conhece todos os status da Edge', () => {
    expect(Object.keys(STATUS_CONVITE).sort()).toEqual([...STATUS_EDGE].sort())
  })
})

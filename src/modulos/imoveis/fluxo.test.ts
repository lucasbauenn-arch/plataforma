import { describe, expect, it } from 'vitest'
import type { Escopo, StatusImovel } from '@/lib/types'
import type { StatusTransicao } from '@/modulos/config/tipos'
import {
  podeEditarDados, podeEditarFotos, podeRemoverFotos, rotuloTransicao, transicoesPermitidas, usuarioDoEscopo, valorTravado,
  type Usuario,
} from './fluxo'

// semente de status_transicoes para imóvel (migration 20260929000008, §3.8)
const linha = (de: StatusImovel, para: StatusImovel, extra: Partial<StatusTransicao> = {}): StatusTransicao => ({
  entidade: 'imovel', de, para, papeis: ['admin', 'super'], permite_criador: false, sistema: false, exige_motivo: false,
  validacoes: [], efeitos: [], ativa: true, atualizado_em: '2026-09-28T00:00:00Z', atualizado_por: null, ...extra,
})
const SEMENTE: StatusTransicao[] = [
  linha('rascunho', 'pendente', { permite_criador: true, validacoes: ['campos_obrigatorios_imovel'] }),
  linha('pendente', 'em_revisao'),
  linha('em_revisao', 'aprovado'),
  linha('em_revisao', 'rascunho', { exige_motivo: true }),
  linha('aprovado', 'no_contrato', { papeis: [], sistema: true }),
  linha('no_contrato', 'aprovado', { papeis: [], sistema: true }),
]

const CRIADOR = 'a0000000-0000-4000-8000-00000000c1a1'
const corretor: Usuario = { profileId: CRIADOR, papel: 'corretor', interno: false, aprovado: true }
const outroCorretor: Usuario = { profileId: 'a0000000-0000-4000-8000-00000000c2a1', papel: 'corretor', interno: false, aprovado: true }
const gerente: Usuario = { profileId: 'a0000000-0000-4000-8000-0000000000a1', papel: 'gerente', interno: false, aprovado: true }
const admin: Usuario = { profileId: 'a0000000-0000-4000-8000-0000000000ad', papel: 'admin', interno: true, aprovado: true }
// admin com 2FA exigida e sessão aal1: is_admin() é falso
const adminSem2fa: Usuario = { ...admin, interno: false, aprovado: false }
const bloqueado: Usuario = { ...corretor, aprovado: false }

const imovel = (status: StatusImovel, extra: { criado_por?: string; inativado_em?: string | null } = {}) =>
  ({ status, criado_por: CRIADOR, inativado_em: null, ...extra })
const destinos = (s: StatusImovel, u: Usuario, t = SEMENTE, extra = {}) =>
  transicoesPermitidas(imovel(s, extra), t, u).map((x) => x.para)

describe('usuarioDoEscopo', () => {
  const base = {
    profile_id: 'p1', papel: 'corretor', status_parceiro: 'aprovado', inativado: false, interno: false,
  } as unknown as Escopo
  it('sem escopo não pode nada', () => {
    expect(usuarioDoEscopo(null)).toEqual({ profileId: null, papel: null, interno: false, aprovado: false })
  })
  it('parceiro aprovado, bloqueado e inativado', () => {
    expect(usuarioDoEscopo(base).aprovado).toBe(true)
    expect(usuarioDoEscopo({ ...base, status_parceiro: 'bloqueado' }).aprovado).toBe(false)
    expect(usuarioDoEscopo({ ...base, inativado: true }).aprovado).toBe(false)
  })
  it('interno conta como aprovado (is_parceiro_aprovado inclui is_admin)', () => {
    const u = usuarioDoEscopo({ ...base, papel: 'admin', status_parceiro: 'pendente', interno: true } as Escopo)
    expect(u).toMatchObject({ interno: true, aprovado: true, papel: 'admin' })
  })
})

describe('edição (E4: criador em RA/PE; internos sempre; IMV-3)', () => {
  it('o criador edita em rascunho e pendente, e depois não', () => {
    expect(podeEditarDados(imovel('rascunho'), corretor)).toBe(true)
    expect(podeEditarDados(imovel('pendente'), corretor)).toBe(true)
    for (const s of ['em_revisao', 'aprovado', 'no_contrato'] as const) expect(podeEditarDados(imovel(s), corretor)).toBe(false)
  })
  it('a cadeia acima vê, mas não edita', () => {
    expect(podeEditarDados(imovel('rascunho'), gerente)).toBe(false)
    expect(podeEditarDados(imovel('rascunho'), outroCorretor)).toBe(false)
  })
  it('bloqueado não edita nem o próprio', () => {
    expect(podeEditarDados(imovel('rascunho'), bloqueado)).toBe(false)
  })
  it('interno edita em qualquer status; sem 2FA exigida não é interno', () => {
    for (const s of ['rascunho', 'pendente', 'em_revisao', 'aprovado', 'no_contrato'] as const) {
      expect(podeEditarDados(imovel(s), admin)).toBe(true)
    }
    expect(podeEditarDados(imovel('rascunho'), adminSem2fa)).toBe(false)
  })
  it('inativado fica só para leitura; o interno ainda pode retirar fotos', () => {
    const inat = imovel('rascunho', { inativado_em: '2026-09-28T00:00:00Z' })
    expect(podeEditarDados(inat, admin)).toBe(false)
    expect(podeEditarFotos(inat, corretor)).toBe(false)
    expect(podeRemoverFotos(inat, admin)).toBe(true)
    expect(podeRemoverFotos(inat, corretor)).toBe(false)
  })
  it('IMV-3: valor travado só em no_contrato', () => {
    expect(valorTravado({ status: 'no_contrato' })).toBe(true)
    expect(valorTravado({ status: 'aprovado' })).toBe(false)
  })
})

describe('transições (tabela status_transicoes)', () => {
  it('o criador só finaliza o cadastro (RA → PE, permite_criador)', () => {
    expect(destinos('rascunho', corretor)).toEqual(['pendente'])
    expect(destinos('pendente', corretor)).toEqual([])
    expect(destinos('em_revisao', corretor)).toEqual([])
  })
  it('quem não é o criador nem interno não muda nada', () => {
    for (const s of ['rascunho', 'pendente', 'em_revisao', 'aprovado'] as const) {
      expect(destinos(s, gerente)).toEqual([])
      expect(destinos(s, outroCorretor)).toEqual([])
    }
    expect(destinos('rascunho', bloqueado)).toEqual([])
  })
  it('interno: finalizar, iniciar revisão, aprovar e devolver', () => {
    expect(destinos('rascunho', admin)).toEqual(['pendente'])
    expect(destinos('pendente', admin)).toEqual(['em_revisao'])
    expect(destinos('em_revisao', admin)).toEqual(['aprovado', 'rascunho'])
    expect(destinos('em_revisao', adminSem2fa)).toEqual([])
  })
  it('AP ↔ NC é só do sistema (contrato)', () => {
    expect(destinos('aprovado', admin)).toEqual([])
    expect(destinos('no_contrato', admin)).toEqual([])
  })
  it('imóvel inativado não muda de status', () => {
    expect(destinos('rascunho', admin, SEMENTE, { inativado_em: '2026-09-28T00:00:00Z' })).toEqual([])
  })
  it('segue o que o Super configurar: linha desligada some, papel de parceiro acrescentado aparece', () => {
    const t = SEMENTE.map((x) => (x.de === 'rascunho' ? { ...x, ativa: false } : x.de === 'pendente' ? { ...x, papeis: [...x.papeis, 'corretor' as const] } : x))
    expect(destinos('rascunho', corretor, t)).toEqual([])
    expect(destinos('pendente', corretor, t)).toEqual(['em_revisao'])
    expect(destinos('pendente', bloqueado, t)).toEqual([])
    // sem permite_criador, o criador parceiro não finaliza
    const semCriador = SEMENTE.map((x) => (x.de === 'rascunho' ? { ...x, permite_criador: false } : x))
    expect(destinos('rascunho', corretor, semCriador)).toEqual([])
    expect(destinos('rascunho', admin, semCriador)).toEqual(['pendente'])
  })
  it('ignora linhas de outras entidades', () => {
    const t = [...SEMENTE, { ...linha('rascunho', 'em_revisao'), entidade: 'contrato' as const }]
    expect(destinos('rascunho', admin, t)).toEqual(['pendente'])
  })
})

describe('rótulos das ações (§7.3)', () => {
  it('nomes da tela', () => {
    expect(rotuloTransicao({ de: 'rascunho', para: 'pendente' })).toBe('Finalizar cadastro')
    expect(rotuloTransicao({ de: 'pendente', para: 'em_revisao' })).toBe('Iniciar revisão')
    expect(rotuloTransicao({ de: 'em_revisao', para: 'aprovado' })).toBe('Aprovar')
    expect(rotuloTransicao({ de: 'em_revisao', para: 'rascunho' })).toBe('Devolver com observação')
    expect(rotuloTransicao({ de: 'aprovado', para: 'no_contrato' })).toBe('Mover para No contrato')
  })
})

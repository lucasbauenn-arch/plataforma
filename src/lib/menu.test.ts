import { describe, expect, it } from 'vitest'
import {
  ACOES_REDE_PADRAO, MENU_ADMIN, MENU_PAINEL, TODAS_PERMISSOES, destinoPorPapel, filtrarMenu, internoDeReferencia, menuDoEscopo,
  permissoesDeReferencia, situacaoAcesso, temPermissao, type FatosEscopo,
} from './menu'
import type { Escopo, Papel, Permissao, TipoParceiro } from './types'

/** Monta um escopo coerente a partir dos fatos, como o `meu_escopo()` faria. */
function escopo(f: Partial<FatosEscopo> & { papel: Papel }, extra: Partial<Escopo> = {}): Escopo {
  const interno = f.interno ?? (f.papel === 'admin' || f.papel === 'super')
  const fatos: FatosEscopo = {
    status_parceiro: 'aprovado', inativado: false, super: f.papel === 'super' && interno, tipo: null, acoes: [], ...f, interno,
  }
  if (fatos.tipo && !f.acoes) fatos.acoes = ACOES_REDE_PADRAO[fatos.tipo]
  return {
    profile_id: 'u1', papel: fatos.papel, status_parceiro: fatos.status_parceiro, inativado: fatos.inativado,
    interno: fatos.interno, super: fatos.super, mfa_exigido: false, aal: 'aal1',
    parceiro_id: fatos.tipo ? 'p1' : null, tipo: fatos.tipo, imobiliaria_id: fatos.tipo ? 'i1' : null,
    gerente_id: fatos.tipo === 'corretor' ? 'g1' : fatos.tipo === 'gerente' ? 'p1' : null,
    parceiro: null, imobiliaria: null, permissoes: permissoesDeReferencia(fatos), pendencias: [], sessao_inatividade_horas: 8,
    ...extra,
  }
}

const parceiro = (tipo: TipoParceiro, extra: Partial<FatosEscopo> = {}) => escopo({ papel: tipo, tipo, ...extra })
const ids = (e: Escopo, area: 'painel' | 'admin') => menuDoEscopo(area, e).map((i) => i.id)

describe('menu da área de parceiros', () => {
  it('corretor vê o CRM, contratos, imóveis, propostas e o link; não vê Equipe', () => {
    const m = ids(parceiro('corretor'), 'painel')
    expect(m).toEqual(['empreendimentos', 'funil', 'clientes', 'tarefas', 'contratos', 'imoveis', 'propostas', 'links', 'meu-cadastro'])
    expect(m).not.toContain('equipe')
  })

  it('gerente vê Equipe e o link (A1 ligado); sem A1 perde o link', () => {
    expect(ids(parceiro('gerente'), 'painel')).toEqual(expect.arrayContaining(['equipe', 'links', 'funil']))
    const semA1 = parceiro('gerente', { acoes: ACOES_REDE_PADRAO.gerente.filter((a) => a !== 'gerente_como_corretor') })
    expect(ids(semA1, 'painel')).not.toContain('links')
  })

  it('imobiliária vê Equipe e não tem link de indicação', () => {
    const m = ids(parceiro('imobiliaria'), 'painel')
    expect(m).toContain('equipe')
    expect(m).not.toContain('links')
  })

  it('parceiro legado aprovado sem vínculo vê só empreendimentos, imóveis, propostas e o próprio cadastro', () => {
    expect(ids(escopo({ papel: 'parceiro' }), 'painel')).toEqual(['empreendimentos', 'imoveis', 'propostas', 'meu-cadastro'])
  })

  it('pendente, bloqueado, inativo e colaborador não recebem nenhuma permissão', () => {
    for (const e of [
      escopo({ papel: 'parceiro', status_parceiro: 'pendente' }),
      parceiro('corretor', { status_parceiro: 'bloqueado' }),
      parceiro('gerente', { status_parceiro: 'inativo' }),
      parceiro('corretor', { inativado: true }),
      escopo({ papel: 'colaborador' }),
      escopo({ papel: 'cliente' }),
    ]) {
      expect(e.permissoes).toEqual([])
      expect(ids(e, 'painel')).toEqual([])
      expect(ids(e, 'admin')).toEqual(['seguranca'])
    }
  })

  it('nenhum parceiro recebe permissão exclusiva de interno', () => {
    const exclusivas: Permissao[] = [
      'admin.acessar', 'relatorios.ver', 'leads.ver', 'propostas.responder', 'rede.aprovar', 'crm.duplicidades', 'crm.portal',
      'contratos.enviar_assinatura', 'imoveis.revisar', 'empreendimentos.gerenciar', 'auditoria.ver', 'migracao.ver', 'config.ver',
    ]
    for (const tipo of ['imobiliaria', 'gerente', 'corretor'] as const) {
      const e = parceiro(tipo, { acoes: Object.values(ACOES_REDE_PADRAO).flat() })
      for (const p of exclusivas) expect(e.permissoes).not.toContain(p)
    }
  })

  it('convite por link começa desligado para parceiros (só internos)', () => {
    for (const tipo of ['imobiliaria', 'gerente', 'corretor'] as const) expect(temPermissao(parceiro(tipo), 'rede.convite_por_link')).toBe(false)
    expect(temPermissao(escopo({ papel: 'admin' }), 'rede.convite_por_link')).toBe(true)
  })

  it('matriz de cadastro da §3.3', () => {
    expect(temPermissao(parceiro('imobiliaria'), 'rede.cadastrar_gerente')).toBe(true)
    expect(temPermissao(parceiro('gerente'), 'rede.cadastrar_gerente')).toBe(false)
    expect(temPermissao(parceiro('gerente'), 'rede.cadastrar_corretor')).toBe(true)
    expect(temPermissao(parceiro('corretor'), 'rede.cadastrar_corretor')).toBe(false)
    expect(temPermissao(parceiro('imobiliaria'), 'rede.transferir_corretor')).toBe(true)
    expect(temPermissao(parceiro('gerente'), 'rede.transferir_corretor')).toBe(false)
    expect(temPermissao(parceiro('gerente'), 'crm.transferir')).toBe(true)
    expect(temPermissao(parceiro('corretor'), 'crm.transferir')).toBe(false)
    for (const tipo of ['imobiliaria', 'gerente', 'corretor'] as const) expect(temPermissao(parceiro(tipo), 'crm.cadastrar')).toBe(true)
  })

  it('desligar uma ação em permissoes_rede tira a permissão correspondente', () => {
    const semContrato = parceiro('corretor', { acoes: ['cadastrar_cliente', 'analisar_documento', 'cadastrar_imovel'] })
    expect(temPermissao(semContrato, 'contratos.criar')).toBe(false)
    expect(temPermissao(semContrato, 'contratos.ver')).toBe(true)
  })
})

describe('menu do admin', () => {
  it('admin vê a operação inteira, sem Configurações', () => {
    const m = ids(escopo({ papel: 'admin' }), 'admin')
    expect(m).toEqual(expect.arrayContaining(['visao-geral', 'funil', 'portal', 'rede', 'pendentes', 'duplicidades', 'auditoria', 'migracao', 'seguranca']))
    expect(m).not.toContain('configuracoes')
    // as telas antigas substituídas não voltam ao menu: Parceiros → Rede; a lista de parceiro_clientes → CRM
    expect(MENU_ADMIN.map((i) => i.caminho)).not.toContain('/admin/parceiros')
    expect(MENU_PAINEL.map((i) => i.caminho)).not.toContain('/parceiros/painel/clientes')
  })

  it('"Clientes do portal" exige crm.portal (só internos)', () => {
    expect(MENU_ADMIN.find((i) => i.id === 'portal')).toMatchObject({ caminho: '/admin/clientes', requer: 'crm.portal' })
    for (const tipo of ['imobiliaria', 'gerente', 'corretor'] as const) expect(ids(parceiro(tipo), 'admin')).not.toContain('portal')
  })

  it('super vê Configurações', () => expect(ids(escopo({ papel: 'super' }), 'admin')).toContain('configuracoes'))

  it('interno com 2FA pendente (is_admin falso) só vê Segurança', () => {
    const e = escopo({ papel: 'super', interno: false }, { mfa_exigido: true, aal: 'aal1' })
    expect(ids(e, 'admin')).toEqual(['seguranca'])
    expect(situacaoAcesso(e)).toBe('mfa_pendente')
  })

  it('internoDeReferencia segue is_admin(): 2FA exigida só com aal2; desligado nunca é interno', () => {
    const base = { status_parceiro: 'aprovado', inativado: false, mfa_exigido: false, aal: 'aal1' } as const
    expect(internoDeReferencia({ ...base, papel: 'admin' })).toBe(true)
    expect(internoDeReferencia({ ...base, papel: 'super', mfa_exigido: true })).toBe(false)
    expect(internoDeReferencia({ ...base, papel: 'super', mfa_exigido: true, aal: 'aal2' })).toBe(true)
    expect(internoDeReferencia({ ...base, papel: 'admin', inativado: true })).toBe(false)
    expect(internoDeReferencia({ ...base, papel: 'admin', status_parceiro: 'inativo' })).toBe(false)
    for (const papel of ['colaborador', 'corretor', 'gerente', 'imobiliaria', 'parceiro', 'cliente'] as const) {
      expect(internoDeReferencia({ ...base, papel, aal: 'aal2' })).toBe(false)
    }
  })

  it('interno com 2FA exigida e sessão aal2 tem as permissões de interno (o que meu_escopo devolve)', () => {
    const fatos = { papel: 'super', status_parceiro: 'aprovado', inativado: false, mfa_exigido: true, aal: 'aal2' } as const
    const interno = internoDeReferencia(fatos)
    const e = escopo({ papel: 'super', interno }, { mfa_exigido: true, aal: 'aal2' })
    expect(e.permissoes).toContain('admin.acessar')
    expect(e.permissoes).toContain('config.ver')
    expect(situacaoAcesso(e)).toBe('liberado')
  })

  it('internos têm tudo menos o que é só de parceiro (enviar proposta, link, meu cadastro); só o Super configura', () => {
    const soDeParceiro: Permissao[] = ['propostas.criar', 'crm.links', 'meu_cadastro.editar']
    expect(escopo({ papel: 'admin' }).permissoes).toEqual(TODAS_PERMISSOES.filter((p) => p !== 'config.ver' && !soDeParceiro.includes(p)))
    expect(escopo({ papel: 'super' }).permissoes).toEqual(TODAS_PERMISSOES.filter((p) => !soDeParceiro.includes(p)))
  })
})

describe('filtrarMenu', () => {
  it('nunca mostra item cuja permissão não veio do servidor', () => {
    const todas = [...MENU_PAINEL, ...MENU_ADMIN]
    for (const p of TODAS_PERMISSOES) {
      const itens = filtrarMenu(todas, [p])
      for (const i of itens) expect(i.requer === undefined || i.requer === p).toBe(true)
    }
  })
  it('sem escopo só sobra o que não exige permissão', () => {
    expect(menuDoEscopo('painel', null)).toEqual([])
    expect(menuDoEscopo('admin', null).map((i) => i.id)).toEqual(['seguranca'])
  })
  it('todo item do menu aponta para a área certa e usa uma permissão existente', () => {
    for (const i of MENU_PAINEL) expect(i.caminho.startsWith('/parceiros/painel')).toBe(true)
    for (const i of MENU_ADMIN) expect(i.caminho.startsWith('/admin')).toBe(true)
    for (const i of [...MENU_PAINEL, ...MENU_ADMIN]) if (i.requer) expect(TODAS_PERMISSOES).toContain(i.requer)
  })
})

describe('situação de acesso e destino', () => {
  it('estados do parceiro', () => {
    expect(situacaoAcesso(escopo({ papel: 'parceiro', status_parceiro: 'pendente' }))).toBe('pendente')
    expect(situacaoAcesso(parceiro('corretor', { status_parceiro: 'bloqueado' }))).toBe('bloqueado')
    expect(situacaoAcesso(parceiro('corretor', { status_parceiro: 'inativo' }))).toBe('inativo')
    expect(situacaoAcesso(parceiro('corretor', { inativado: true }))).toBe('inativo')
    expect(situacaoAcesso(parceiro('corretor'))).toBe('liberado')
    expect(situacaoAcesso({ ...parceiro('corretor'), pendencias: ['termo'] })).toBe('termo_pendente')
    expect(situacaoAcesso({ ...parceiro('corretor'), pendencias: ['cpf', 'creci'] })).toBe('liberado')
  })
  it('colaborador e cliente não têm área liberada; internos sem 2FA exigida estão liberados', () => {
    expect(situacaoAcesso(escopo({ papel: 'colaborador' }))).toBe('nao_liberado')
    expect(situacaoAcesso(escopo({ papel: 'cliente' }))).toBe('nao_liberado')
    expect(situacaoAcesso(escopo({ papel: 'admin' }))).toBe('liberado')
    expect(situacaoAcesso(escopo({ papel: 'super' }, { mfa_exigido: true, aal: 'aal2' }))).toBe('liberado')
  })
  it('interno desligado (inativado ou status inativo) vê "Acesso encerrado", não o painel vazio', () => {
    for (const papel of ['admin', 'super'] as const) {
      const inativado = escopo({ papel, inativado: true, interno: false })
      expect(situacaoAcesso(inativado)).toBe('inativo')
      expect(situacaoAcesso(escopo({ papel, status_parceiro: 'inativo', interno: false }))).toBe('inativo')
      // mesmo com a 2FA pendente, o desligamento vem antes (não manda para Segurança)
      expect(situacaoAcesso({ ...inativado, mfa_exigido: true, aal: 'aal1' })).toBe('inativo')
    }
    expect(situacaoAcesso(escopo({ papel: 'colaborador', inativado: true }))).toBe('inativo')
  })
  it('destino depois do login', () => {
    expect(destinoPorPapel('admin')).toBe('/admin')
    expect(destinoPorPapel('super')).toBe('/admin')
    expect(destinoPorPapel('colaborador')).toBe('/admin')
    for (const p of ['imobiliaria', 'gerente', 'corretor', 'parceiro'] as const) expect(destinoPorPapel(p)).toBe('/parceiros/painel')
    expect(destinoPorPapel('cliente')).toBe('/portal-do-cliente/meus-imoveis')
  })
})

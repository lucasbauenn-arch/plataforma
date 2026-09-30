// Menu e situação de acesso derivados de `meu_escopo()`. Módulo puro (sem React nem Supabase): é usado pelos layouts,
// pelos testes (menu.test.ts) e pela simulação dos testes ponta a ponta (e2e/apoio.ts).
// O menu só esconde o que o usuário não pode usar; **nunca é a única barreira** — a RPC e a RLS recusam no servidor.

import type { AcaoRede, Escopo, Papel, Permissao, StatusParceiro, TipoParceiro } from './types'

export type AreaApp = 'painel' | 'admin'

/** Nomes dos ícones; os layouts mapeiam para lucide-react (src/components/app/IconeMenu.tsx). */
export type IconeMenu =
  | 'empreendimentos' | 'funil' | 'clientes' | 'tarefas' | 'contratos' | 'imoveis' | 'propostas' | 'equipe' | 'links'
  | 'cadastro' | 'visao_geral' | 'relatorios' | 'rede' | 'pendentes' | 'duplicidades' | 'leads' | 'auditoria'
  | 'migracao' | 'configuracoes' | 'seguranca' | 'portal'

export interface ItemMenu {
  id: string
  rotulo: string
  /** Caminho absoluto da rota. */
  caminho: string
  icone: IconeMenu
  /** Sem `requer` o item aparece para todos que entram na área. */
  requer?: Permissao
  /** Ativo só no caminho exato (NavLink `end`). */
  exato?: boolean
}

export const BASE: Record<AreaApp, string> = { painel: '/parceiros/painel', admin: '/admin' }

export const MENU_PAINEL: ItemMenu[] = [
  { id: 'empreendimentos', rotulo: 'Empreendimentos', caminho: '/parceiros/painel', icone: 'empreendimentos', requer: 'empreendimentos.ver', exato: true },
  { id: 'funil', rotulo: 'Funil', caminho: '/parceiros/painel/crm', icone: 'funil', requer: 'crm.ver', exato: true },
  { id: 'clientes', rotulo: 'Clientes', caminho: '/parceiros/painel/crm/lista', icone: 'clientes', requer: 'crm.ver' },
  { id: 'tarefas', rotulo: 'Tarefas', caminho: '/parceiros/painel/tarefas', icone: 'tarefas', requer: 'crm.ver' },
  { id: 'contratos', rotulo: 'Contratos', caminho: '/parceiros/painel/contratos', icone: 'contratos', requer: 'contratos.ver' },
  { id: 'imoveis', rotulo: 'Imóveis', caminho: '/parceiros/painel/imoveis', icone: 'imoveis', requer: 'imoveis.ver' },
  { id: 'propostas', rotulo: 'Propostas', caminho: '/parceiros/painel/propostas', icone: 'propostas', requer: 'propostas.ver' },
  { id: 'equipe', rotulo: 'Equipe', caminho: '/parceiros/painel/equipe', icone: 'equipe', requer: 'rede.ver' },
  { id: 'links', rotulo: 'Meu link', caminho: '/parceiros/painel/links', icone: 'links', requer: 'crm.links' },
  { id: 'meu-cadastro', rotulo: 'Meu cadastro', caminho: '/parceiros/painel/meu-cadastro', icone: 'cadastro', requer: 'meu_cadastro.editar' },
]

export const MENU_ADMIN: ItemMenu[] = [
  { id: 'visao-geral', rotulo: 'Visão geral', caminho: '/admin', icone: 'visao_geral', requer: 'admin.acessar', exato: true },
  { id: 'relatorios', rotulo: 'Relatórios', caminho: '/admin/relatorios', icone: 'relatorios', requer: 'relatorios.ver' },
  { id: 'funil', rotulo: 'Funil', caminho: '/admin/crm', icone: 'funil', requer: 'crm.ver', exato: true },
  { id: 'clientes', rotulo: 'Clientes', caminho: '/admin/crm/lista', icone: 'clientes', requer: 'crm.ver' },
  // a antiga "Clientes (portal)": lista do CRM filtrada por portal liberado; negócios, arquivos e acessos na aba Portal da ficha
  { id: 'portal', rotulo: 'Clientes do portal', caminho: '/admin/clientes', icone: 'portal', requer: 'crm.portal' },
  { id: 'tarefas', rotulo: 'Tarefas', caminho: '/admin/tarefas', icone: 'tarefas', requer: 'crm.ver' },
  { id: 'duplicidades', rotulo: 'Duplicidades', caminho: '/admin/duplicidades', icone: 'duplicidades', requer: 'crm.duplicidades' },
  { id: 'leads', rotulo: 'Leads do site', caminho: '/admin/leads', icone: 'leads', requer: 'leads.ver' },
  { id: 'propostas', rotulo: 'Propostas', caminho: '/admin/propostas', icone: 'propostas', requer: 'propostas.responder' },
  { id: 'contratos', rotulo: 'Contratos', caminho: '/admin/contratos', icone: 'contratos', requer: 'contratos.ver' },
  { id: 'imoveis', rotulo: 'Imóveis', caminho: '/admin/imoveis', icone: 'imoveis', requer: 'imoveis.ver' },
  { id: 'empreendimentos', rotulo: 'Empreendimentos', caminho: '/admin/empreendimentos', icone: 'empreendimentos', requer: 'empreendimentos.gerenciar' },
  { id: 'rede', rotulo: 'Rede', caminho: '/admin/rede', icone: 'rede', requer: 'rede.ver', exato: true },
  { id: 'pendentes', rotulo: 'Autocadastros', caminho: '/admin/rede/pendentes', icone: 'pendentes', requer: 'rede.aprovar' },
  { id: 'auditoria', rotulo: 'Auditoria', caminho: '/admin/auditoria', icone: 'auditoria', requer: 'auditoria.ver' },
  { id: 'migracao', rotulo: 'Migração', caminho: '/admin/migracao', icone: 'migracao', requer: 'migracao.ver' },
  { id: 'configuracoes', rotulo: 'Configurações', caminho: '/admin/configuracoes', icone: 'configuracoes', requer: 'config.ver' },
  { id: 'seguranca', rotulo: 'Segurança', caminho: '/admin/seguranca', icone: 'seguranca' },
]

export const MENUS: Record<AreaApp, ItemMenu[]> = { painel: MENU_PAINEL, admin: MENU_ADMIN }

/** Itens que as permissões liberam, na ordem do registro. */
export function filtrarMenu(itens: ItemMenu[], permissoes: readonly Permissao[]): ItemMenu[] {
  const tem = new Set(permissoes)
  return itens.filter((i) => !i.requer || tem.has(i.requer))
}

/** Menu de uma área para o escopo atual (sem escopo, só os itens sem `requer`). */
export function menuDoEscopo(area: AreaApp, escopo: Pick<Escopo, 'permissoes'> | null): ItemMenu[] {
  return filtrarMenu(MENUS[area], escopo?.permissoes ?? [])
}

export const temPermissao = (escopo: Pick<Escopo, 'permissoes'> | null | undefined, p: Permissao) =>
  !!escopo?.permissoes.includes(p)

// ---------- papéis e situação de acesso ----------

export const ehPapelInterno = (p: Papel | null | undefined) => p === 'admin' || p === 'super'
export const ehPapelParceiro = (p: Papel | null | undefined) =>
  p === 'parceiro' || p === 'corretor' || p === 'gerente' || p === 'imobiliaria'

/** Para onde cada papel vai depois do login (e quando digita a área de outro papel). */
export function destinoPorPapel(papel: Papel): string {
  if (papel === 'cliente') return '/portal-do-cliente/meus-imoveis'
  if (ehPapelParceiro(papel)) return BASE.painel
  return BASE.admin // admin, super e colaborador (este vê "acesso ainda não liberado")
}

/**
 * - `liberado`: pode usar a área (o menu decide o resto);
 * - `pendente` / `bloqueado` / `inativo`: parceiro sem acesso (tela informativa);
 * - `termo_pendente`: parceiro aprovado que precisa aceitar o termo vigente (só "Meu cadastro" abre);
 * - `mfa_pendente`: interno com 2FA exigida e sessão `aal1` (só `/admin/seguranca` abre);
 * - `nao_liberado`: colaborador (A8) ou papel sem área.
 */
export type SituacaoAcesso = 'liberado' | 'pendente' | 'bloqueado' | 'inativo' | 'termo_pendente' | 'mfa_pendente' | 'nao_liberado'

export function situacaoAcesso(e: Pick<Escopo, 'papel' | 'status_parceiro' | 'inativado' | 'mfa_exigido' | 'aal' | 'pendencias'>): SituacaoAcesso {
  // desligamento vale para todos, internos inclusive (is_admin() exige perfil não inativado): com o token ainda
  // válido (até 1 h), a tela é "Acesso encerrado", não um painel vazio
  if (e.inativado || e.status_parceiro === 'inativo') return 'inativo'
  if (ehPapelInterno(e.papel)) return e.mfa_exigido && e.aal !== 'aal2' ? 'mfa_pendente' : 'liberado'
  if (!ehPapelParceiro(e.papel)) return 'nao_liberado'
  if (e.status_parceiro === 'bloqueado') return 'bloqueado'
  if (e.status_parceiro !== 'aprovado') return 'pendente'
  if (e.pendencias.includes('termo')) return 'termo_pendente'
  return 'liberado'
}

// ---------- especificação de referência das permissões (o SQL de meu_escopo() segue esta regra) ----------

/** Semente de `permissoes_rede` (§3.3): ações ligadas por tipo de parceiro. */
export const ACOES_REDE_PADRAO: Record<TipoParceiro, AcaoRede[]> = {
  imobiliaria: [
    'cadastrar_gerente', 'cadastrar_corretor', 'cadastrar_cliente', 'editar_subordinado', 'inativar_subordinado',
    'transferir_corretor', 'transferir_cliente', 'criar_contrato', 'analisar_documento', 'cadastrar_imovel',
  ],
  gerente: [
    'cadastrar_corretor', 'cadastrar_cliente', 'editar_subordinado', 'inativar_subordinado', 'transferir_cliente',
    'gerente_como_corretor', 'criar_contrato', 'analisar_documento', 'cadastrar_imovel',
  ],
  corretor: ['cadastrar_cliente', 'criar_contrato', 'analisar_documento', 'cadastrar_imovel'],
}

/** Fatos que o SQL lê para montar `meu_escopo().permissoes`. */
export interface FatosEscopo {
  papel: Papel
  status_parceiro: StatusParceiro
  /** `profiles.inativado_em is not null`. */
  inativado: boolean
  /** `is_admin()` (já considera o `aal2` quando a 2FA é exigida). */
  interno: boolean
  /** `is_super()`. */
  super: boolean
  /** Tipo do vínculo ativo em `parceiros` (linha ativa, perfil aprovado); nulo sem vínculo. */
  tipo: TipoParceiro | null
  /** `permissoes_rede` com `permitido = true` para esse tipo. */
  acoes: readonly AcaoRede[]
}

/**
 * `is_admin()` de referência (migration 03), como `meu_escopo().interno`: papel admin/super, perfil não inativado e
 * status diferente de `inativo`; com a 2FA exigida (`mfa_exigido`), só com sessão `aal2`.
 */
export function internoDeReferencia(f: Pick<Escopo, 'papel' | 'status_parceiro' | 'inativado' | 'mfa_exigido' | 'aal'>): boolean {
  return ehPapelInterno(f.papel) && !f.inativado && f.status_parceiro !== 'inativo' && (!f.mfa_exigido || f.aal === 'aal2')
}

/** Todas as permissões, na ordem canônica. */
export const TODAS_PERMISSOES: Permissao[] = [
  'painel.acessar', 'empreendimentos.ver', 'propostas.ver', 'propostas.criar', 'imoveis.ver', 'imoveis.cadastrar',
  'crm.ver', 'crm.cadastrar', 'crm.transferir', 'crm.analisar_documento', 'crm.links', 'contratos.ver', 'contratos.criar',
  'rede.ver', 'rede.cadastrar_gerente', 'rede.cadastrar_corretor', 'rede.editar_subordinado', 'rede.inativar_subordinado',
  'rede.transferir_corretor', 'rede.convite_por_link', 'meu_cadastro.editar',
  'admin.acessar', 'relatorios.ver', 'leads.ver', 'propostas.responder', 'rede.aprovar', 'crm.duplicidades', 'crm.portal',
  'contratos.enviar_assinatura', 'imoveis.revisar', 'empreendimentos.gerenciar', 'auditoria.ver', 'migracao.ver',
  'config.ver',
]

/**
 * Regra de cada permissão, em termos dos helpers SQL da §4.1 (é a especificação de `meu_escopo()`):
 * - `aprovado` = papel de parceiro (`parceiro`/`corretor`/`gerente`/`imobiliaria`), `status_parceiro = 'aprovado'` e não inativado;
 * - `vinculo` = `aprovado` e linha ativa em `parceiros` (é o que dá escopo de CRM);
 * - `acao(x)` = `is_admin()` **ou** (`vinculo` e `permissoes_rede(x, tipo).permitido`) — igual a `tem_permissao(x)`.
 *
 * | permissão | regra |
 * |---|---|
 * | painel.acessar, empreendimentos.ver, propostas.ver, imoveis.ver | `is_admin()` ou `aprovado` (= `is_parceiro_aprovado()`) |
 * | propostas.criar | `aprovado` |
 * | crm.ver, contratos.ver | `is_admin()` ou `vinculo` |
 * | crm.cadastrar / crm.transferir / crm.analisar_documento | `acao('cadastrar_cliente' / 'transferir_cliente' / 'analisar_documento')` |
 * | crm.links | `vinculo` e (tipo `corretor`, ou tipo `gerente` com `gerente_como_corretor`) |
 * | rede.ver | `is_admin()` ou (`vinculo` e tipo `imobiliaria`/`gerente`) |
 * | rede.cadastrar_gerente … rede.convite_por_link | `acao(<mesmo nome>)` |
 * | contratos.criar / imoveis.cadastrar | `acao('criar_contrato' / 'cadastrar_imovel')` |
 * | meu_cadastro.editar | `aprovado` |
 * | admin.acessar, relatorios.ver, leads.ver, propostas.responder, rede.aprovar, crm.duplicidades, crm.portal, contratos.enviar_assinatura, imoveis.revisar, empreendimentos.gerenciar, auditoria.ver, migracao.ver | `is_admin()` |
 * | config.ver | `is_super()` |
 *
 * Referência para testes e simulação E2E; **nunca** decide acesso no app (quem decide é o servidor).
 */
export function permissoesDeReferencia(f: FatosEscopo): Permissao[] {
  const aprovado = ehPapelParceiro(f.papel) && f.status_parceiro === 'aprovado' && !f.inativado
  const vinculo = aprovado && f.tipo !== null
  const acao = (a: AcaoRede) => f.interno || (vinculo && f.acoes.includes(a))
  const regra: Record<Permissao, boolean> = {
    'painel.acessar': f.interno || aprovado,
    'empreendimentos.ver': f.interno || aprovado,
    'propostas.ver': f.interno || aprovado,
    'propostas.criar': aprovado,
    'imoveis.ver': f.interno || aprovado,
    'imoveis.cadastrar': acao('cadastrar_imovel'),
    'crm.ver': f.interno || vinculo,
    'crm.cadastrar': acao('cadastrar_cliente'),
    'crm.transferir': acao('transferir_cliente'),
    'crm.analisar_documento': acao('analisar_documento'),
    'crm.links': vinculo && (f.tipo === 'corretor' || (f.tipo === 'gerente' && f.acoes.includes('gerente_como_corretor'))),
    'contratos.ver': f.interno || vinculo,
    'contratos.criar': acao('criar_contrato'),
    'rede.ver': f.interno || (vinculo && (f.tipo === 'imobiliaria' || f.tipo === 'gerente')),
    'rede.cadastrar_gerente': acao('cadastrar_gerente'),
    'rede.cadastrar_corretor': acao('cadastrar_corretor'),
    'rede.editar_subordinado': acao('editar_subordinado'),
    'rede.inativar_subordinado': acao('inativar_subordinado'),
    'rede.transferir_corretor': acao('transferir_corretor'),
    'rede.convite_por_link': acao('convite_por_link'),
    'meu_cadastro.editar': aprovado,
    'admin.acessar': f.interno,
    'relatorios.ver': f.interno,
    'leads.ver': f.interno,
    'propostas.responder': f.interno,
    'rede.aprovar': f.interno,
    'crm.duplicidades': f.interno,
    'crm.portal': f.interno,
    'contratos.enviar_assinatura': f.interno,
    'imoveis.revisar': f.interno,
    'empreendimentos.gerenciar': f.interno,
    'auditoria.ver': f.interno,
    'migracao.ver': f.interno,
    'config.ver': f.super,
  }
  return TODAS_PERMISSOES.filter((p) => regra[p])
}

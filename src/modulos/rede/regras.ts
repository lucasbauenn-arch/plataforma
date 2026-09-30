// Regras de TELA da rede [WP1] (docs/ARQUITETURA_EXPANSAO.md §3.3, §4.4 "Rede", §7.2): que botões aparecem para quem, que
// opções de destino fazem sentido e como o formulário vira p_dados. Módulo puro (testado em regras.test.ts).
// Espelha as RPCs só para não oferecer o que o servidor recusaria: quem decide é SEMPRE o servidor (rede_*).

import { cpfValido, soDigitos } from '@/lib/format'
import type { Escopo, TipoParceiro } from '@/lib/types'
import type { ImobiliariaDados, Parceiro, ParceiroDados, ParceiroDetalhe, ParceiroEdicao } from './tipos'

type EscopoRede = Pick<Escopo, 'interno' | 'super' | 'tipo' | 'parceiro_id' | 'imobiliaria_id' | 'permissoes'>

const tem = (e: EscopoRede, p: Escopo['permissoes'][number]) => e.permissoes.includes(p)

/** Tipos que quem está logado pode cadastrar (matriz §3.3; usuários de imobiliária só internos). */
export function tiposCadastraveis(e: EscopoRede | null): TipoParceiro[] {
  if (!e) return []
  if (e.interno) return ['imobiliaria', 'gerente', 'corretor']
  const tipos: TipoParceiro[] = []
  if (e.tipo === 'imobiliaria' && tem(e, 'rede.cadastrar_gerente')) tipos.push('gerente')
  if ((e.tipo === 'imobiliaria' || e.tipo === 'gerente') && tem(e, 'rede.cadastrar_corretor')) tipos.push('corretor')
  return tipos
}

export interface AcoesParceiro {
  editar: boolean
  convidar: boolean
  transferirClientes: boolean
  transferirCorretor: boolean
  mudarImobiliaria: boolean
  regularizar: boolean
  inativar: boolean
  reativar: boolean
  bloquear: boolean
  desbloquear: boolean
}

/**
 * Ações oferecidas na tela do parceiro. Mesma matriz das RPCs:
 * - imobiliária gere gerentes e corretores da própria imobiliária; gerente, só os corretores dele; corretor, ninguém;
 * - usuários de imobiliária e a cadeia virtual da casa: só internos (e a casa nem eles editam ou inativam);
 * - mudar de imobiliária e regularizar legado: só o Super; bloquear, desbloquear e reativar: internos.
 */
export function acoesDoParceiro(e: EscopoRede | null, p: ParceiroDetalhe): AcoesParceiro {
  const nada: AcoesParceiro = {
    editar: false, convidar: false, transferirClientes: false, transferirCorretor: false, mudarImobiliaria: false,
    regularizar: false, inativar: false, reativar: false, bloquear: false, desbloquear: false,
  }
  if (!e) return nada
  const ativo = !p.inativado_em
  const mesmaImob = !!e.imobiliaria_id && p.imobiliaria.id === e.imobiliaria_id
  const meuCorretor = p.tipo === 'corretor' && !!e.parceiro_id && p.gerente?.id === e.parceiro_id
  // gere o subordinado para a ação (permissão da matriz ligada)
  const gere = (permissao: Escopo['permissoes'][number]) =>
    !p.virtual && (e.interno || (tem(e, permissao) && (
      (e.tipo === 'imobiliaria' && mesmaImob && (p.tipo === 'gerente' || p.tipo === 'corretor'))
      || (e.tipo === 'gerente' && meuCorretor))))
  const podeConvidarTipo = p.tipo === 'gerente' ? gere('rede.cadastrar_gerente') && (e.interno || e.tipo === 'imobiliaria')
    : p.tipo === 'corretor' ? gere('rede.cadastrar_corretor')
    : e.interno && !p.virtual
  const semAcessoAinda = !p.tem_login || p.convite_pendente

  return {
    editar: ativo && gere('rede.editar_subordinado'),
    convidar: ativo && !p.virtual && semAcessoAinda && podeConvidarTipo,
    transferirClientes: ativo && p.clientes_ativos > 0 && (e.interno || (tem(e, 'crm.transferir') && (
      (e.tipo === 'imobiliaria' && mesmaImob) || (e.tipo === 'gerente' && (p.id === e.parceiro_id || meuCorretor))))),
    transferirCorretor: ativo && !p.virtual && p.tipo === 'corretor'
      && (e.interno || (e.tipo === 'imobiliaria' && mesmaImob && tem(e, 'rede.transferir_corretor'))),
    mudarImobiliaria: e.super && ativo && !p.virtual && p.tipo === 'corretor',
    regularizar: e.super && ativo && !p.virtual && p.tipo === 'corretor' && p.migrado_legado && p.imobiliaria.da_casa,
    inativar: ativo && !p.virtual && (
      e.interno
      || (p.tipo === 'corretor' && gere('rede.inativar_subordinado'))
      || (p.tipo === 'gerente' && e.tipo === 'imobiliaria' && mesmaImob && tem(e, 'rede.inativar_subordinado'))),
    reativar: e.interno && !ativo,
    bloquear: e.interno && ativo && p.tem_login && p.status_parceiro !== 'bloqueado' && p.status_parceiro !== 'inativo',
    desbloquear: e.interno && ativo && p.status_parceiro === 'bloqueado',
  }
}

/** Carteira ou equipe a mover: a inativação exige destino. */
export const inativacaoPedeDestino = (p: Pick<ParceiroDetalhe, 'clientes_ativos' | 'corretores_ativos'>) =>
  p.clientes_ativos > 0 || p.corretores_ativos > 0

type OpcaoParceiro = Pick<Parceiro, 'id' | 'tipo' | 'imobiliaria_id' | 'gerente_id' | 'inativado_em'>

/**
 * Destino válido na inativação (a lista já vem limitada pela RLS ao escopo de quem chama):
 * - corretor: outro corretor ativo da mesma imobiliária, ou o gerente dele (A1);
 * - gerente: outro gerente ativo da mesma imobiliária.
 */
export function destinoDeInativacao(alvo: Pick<ParceiroDetalhe, 'id' | 'tipo' | 'imobiliaria' | 'gerente'>, o: OpcaoParceiro): boolean {
  if (o.id === alvo.id || o.inativado_em || o.imobiliaria_id !== alvo.imobiliaria.id) return false
  if (alvo.tipo === 'corretor') return o.tipo === 'corretor' || (o.tipo === 'gerente' && o.id === alvo.gerente?.id)
  if (alvo.tipo === 'gerente') return o.tipo === 'gerente'
  return false
}

/**
 * Destino de uma carteira de clientes (transferência): corretor ativo, ou gerente pelo A1. Com `imobiliariaId`, só da
 * mesma imobiliária (entre imobiliárias, só o Super — o servidor confere).
 */
export function destinoDeCarteira(o: OpcaoParceiro, excluir: string | null, imobiliariaId?: string | null): boolean {
  if (o.id === excluir || o.inativado_em || o.tipo === 'imobiliaria') return false
  return !imobiliariaId || o.imobiliaria_id === imobiliariaId
}

// ---------- formulários → p_dados ----------

/** Texto aparado; vazio vira nulo. */
const texto = (v: string | null | undefined) => (v ?? '').trim() || null
const digitos = (v: string | null | undefined) => soDigitos(v ?? '') || null

export interface ValoresParceiro {
  nome: string
  cpf: string
  creci: string
  email: string
  telefone: string
}

/** Problemas do formulário de parceiro pela regra PAR-4 (CPF para gerente e corretor; CRECI para corretor). */
export function problemasParceiro(tipo: TipoParceiro, v: ValoresParceiro): Partial<Record<keyof ValoresParceiro, string>> {
  const erros: Partial<Record<keyof ValoresParceiro, string>> = {}
  if ((v.nome ?? '').trim().length < 2) erros.nome = 'Informe o nome.'
  const cpf = soDigitos(v.cpf ?? '')
  if (cpf ? !cpfValido(cpf) : tipo !== 'imobiliaria') erros.cpf = cpf ? 'CPF inválido.' : 'Informe o CPF.'
  if (tipo === 'corretor' && !(v.creci ?? '').trim()) erros.creci = 'Informe o CRECI.'
  if ((v.creci ?? '').trim().length > 60) erros.creci = 'Máximo de 60 caracteres.'
  const email = (v.email ?? '').trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erros.email = 'E-mail inválido.'
  const tel = soDigitos(v.telefone ?? '')
  if (tel && (tel.length < 10 || tel.length > 13)) erros.telefone = 'Informe o DDD e o número.'
  return erros
}

/** p_dados de rede_cadastrar_parceiro (todas as chaves; CPF, CRECI e telefone só com o que importa). */
export function dadosNovoParceiro(v: ValoresParceiro): ParceiroDados {
  return {
    nome: v.nome.trim(),
    cpf: digitos(v.cpf),
    creci: texto(v.creci),
    email: texto(v.email)?.toLowerCase() ?? null,
    telefone: digitos(v.telefone),
  }
}

/**
 * p_dados de rede_editar_parceiro / rede_atualizar_meu_cadastro: só o que mudou. CPF só se estava vazio; e-mail só
 * sem login (é o e-mail de acesso).
 */
export function dadosEdicaoParceiro(
  atual: Pick<ParceiroDetalhe, 'nome' | 'cpf' | 'creci' | 'email' | 'telefone' | 'tem_login'>,
  v: ValoresParceiro,
): ParceiroEdicao {
  const d: ParceiroEdicao = {}
  const nome = v.nome.trim()
  if (nome !== atual.nome) d.nome = nome
  if (!atual.cpf && digitos(v.cpf)) d.cpf = digitos(v.cpf)
  if (texto(v.creci) !== (atual.creci ?? null)) d.creci = texto(v.creci)
  const email = texto(v.email)?.toLowerCase() ?? null
  if (!atual.tem_login && email !== (atual.email ?? null)) d.email = email
  if (digitos(v.telefone) !== (atual.telefone ?? null)) d.telefone = digitos(v.telefone)
  return d
}

export interface ValoresImobiliaria {
  nome: string
  razao_social: string
  cnpj: string
  creci_pj: string
  email: string
  telefone: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
}

/** p_dados de rede_cadastrar_imobiliaria / rede_editar_imobiliaria (todas as chaves; o servidor valida de novo). */
export function dadosImobiliaria(v: ValoresImobiliaria): ImobiliariaDados {
  return {
    nome: v.nome.trim(),
    razao_social: texto(v.razao_social),
    cnpj: soDigitos(v.cnpj),
    creci_pj: (v.creci_pj ?? '').trim(),
    email: texto(v.email)?.toLowerCase() ?? null,
    telefone: digitos(v.telefone),
    cep: digitos(v.cep),
    logradouro: texto(v.logradouro),
    numero: texto(v.numero),
    complemento: texto(v.complemento),
    bairro: texto(v.bairro),
    cidade: texto(v.cidade),
    uf: texto(v.uf)?.toUpperCase() ?? null,
  }
}

// ---------- transferência de clientes (WP1R-06) ----------

/** crm_listar devolve no máximo 200 por página; rede_transferir_clientes aceita até 500 ids por chamada. */
export const CARTEIRA_POR_PAGINA = 200
export const TRANSFERENCIA_POR_LOTE = 500

/** Divide os ids em lotes do tamanho aceito pela RPC (a ordem é mantida). */
export function emLotes<T>(itens: readonly T[], tamanho = TRANSFERENCIA_POR_LOTE): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho))
  return lotes
}

/** Próximo offset da carteira (paginada pelo CRM), ou `undefined` quando tudo já foi carregado. */
export function proximoOffsetCarteira(paginas: readonly { total: number; itens: readonly unknown[] }[]): number | undefined {
  const carregados = paginas.reduce((n, p) => n + p.itens.length, 0)
  const ultima = paginas[paginas.length - 1]
  if (!ultima || ultima.itens.length === 0 || carregados >= ultima.total) return undefined
  return carregados
}

/** Rótulo do "selecionar todos": deixa claro quando a lista ainda não tem a carteira inteira. */
export const rotuloTodosCarteira = (carregados: number, total: number) =>
  carregados >= total ? `Todos (${carregados})` : `Todos os ${carregados} carregados (de ${total})`

/**
 * [WP1R-04] rede_atualizar_meu_cadastro não lança quando o CPF já é de outro parceiro (para a tentativa ficar na
 * auditoria): nada muda. O front confere no detalhe relido se o CPF enviado ficou gravado.
 */
export const cpfFicouGravado = (enviado: string | null | undefined, detalhe: Pick<ParceiroDetalhe, 'cpf'> | null) =>
  !enviado || (!!detalhe && detalhe.cpf === soDigitos(enviado))

/** Termo de busca seguro para o filtro `or()` do PostgREST (sem vírgula, parênteses nem curingas). */
export const termoBusca = (v: string) => v.replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

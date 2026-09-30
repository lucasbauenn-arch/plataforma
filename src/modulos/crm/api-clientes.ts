// Apoio do front do CRM [WP2]: cadastro, ficha (Dados, Afiliados, Portal, Propostas), lista, duplicidades, leads,
// propostas e pré-cadastro público. As RPCs estão em src/lib/rpc.ts; os formatos em ./tipos.ts. Aqui ficam as chaves
// do TanStack Query, o esquema do formulário do cliente (zod), a conversão formulário → p_dados, a chamada da Edge
// pre-cadastro e a exportação CSV. O escopo é sempre decidido pelo servidor.

import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { lgpdTermoVigente } from '@/lib/rpc'
import { cnpjValido, cpfValido, mascaraCnpj, mascaraCpf, mascaraTelefone, soDigitos } from '@/lib/format'
import { INTERESSES } from '@/lib/constants'
import type { EstadoCivil, Genero, TipoPessoa } from '@/lib/types'
import type {
  ClienteDados, ClienteEdicao, ClienteFicha, CrmFiltros, DuplicidadesFiltros, LeadItem, LeadsFiltros, PreCadastroDados,
  PropostasFiltros, ResultadoDuplicidade,
} from './tipos'

// ============ chaves do TanStack Query ============

export const chavesCrm = {
  /** Prefixo de todas as listas do CRM (invalide depois de cadastrar, editar ou transferir). */
  listas: ['crm-lista'] as const,
  lista: (f: CrmFiltros, limite: number, offset: number) => ['crm-lista', f, limite, offset] as const,
  duplicidades: (f: DuplicidadesFiltros) => ['crm-duplicidades', f] as const,
  leads: (f: LeadsFiltros) => ['crm-leads', f] as const,
  propostas: (f: PropostasFiltros) => ['crm-propostas', f] as const,
  propostasTodas: ['crm-propostas'] as const,
  termoCliente: ['lgpd-termo', 'consentimento_cliente'] as const,
  linkPublico: (codigo: string) => ['rede-link-publico', codigo] as const,
}

/** Termo vigente de consentimento do cliente (N12 no cadastro interno; H4 no pré-cadastro). */
export function useTermoCliente(habilitado = true) {
  return useQuery({
    queryKey: chavesCrm.termoCliente,
    queryFn: () => lgpdTermoVigente({ p_tipo: 'consentimento_cliente' }),
    enabled: habilitado,
    staleTime: 5 * 60_000,
  })
}

// ============ textos ============

export const nomeCompleto = (nome: string, sobrenome?: string | null) => [nome, sobrenome].filter(Boolean).join(' ')

export const RESULTADOS_DUPLICIDADE: Record<ResultadoDuplicidade, string> = {
  bloqueado_exclusividade: 'Dentro da exclusividade',
  bloqueado_contrato: 'Cliente com contrato',
  bloqueado_pos_prazo: 'Exclusividade vencida',
  mesmo_dono: 'Mesmo dono',
}

/** Resposta genérica da A2 (sem dono nem data, §4.5). */
export const TEXTO_INDISPONIVEL =
  'Este CPF/CNPJ não está disponível para cadastro. Por segurança, não informamos a situação do documento. Se precisar de ajuda, fale com a equipe Arken.'

// ============ formulário do cliente ============

/** Valores do formulário (textos com máscara; listas de contato separadas por vírgula). */
export interface ValoresCliente {
  tipo_pessoa: TipoPessoa
  nome: string
  sobrenome: string
  /** CPF (PF) ou CNPJ (PJ), com ou sem máscara. */
  documento: string
  rg: string
  data_nascimento: string
  genero: Genero | ''
  estado_civil: EstadoCivil | ''
  nacionalidade: string
  email: string
  emails_adicionais: string
  telefone: string
  telefones_adicionais: string
  horario_contato: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  pais: string
  interesses: string[]
  /** Declaração de consentimento (N12): obrigatória no cadastro interno. */
  declaracao: boolean
}

export const VALORES_VAZIOS: ValoresCliente = {
  tipo_pessoa: 'fisica', nome: '', sobrenome: '', documento: '', rg: '', data_nascimento: '', genero: '', estado_civil: '',
  nacionalidade: '', email: '', emails_adicionais: '', telefone: '', telefones_adicionais: '', horario_contato: '', cep: '',
  logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', pais: 'Brasil', interesses: [], declaracao: false,
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const listaTexto = (v: string) => v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
const OPCOES_INTERESSE = new Set(INTERESSES.flatMap((g) => g.opcoes))

/**
 * CPF/CNPJ obrigatório no formulário? No cadastro, sempre. Na edição, só quando o cliente JÁ TEM documento e quem edita
 * pode alterá-lo (o servidor não deixa apagar um documento). Cliente sem documento (ex.: migrado com CPF inválido)
 * continua editável sem informar um: o DV só é conferido se o campo for preenchido.
 */
export function documentoObrigatorio(modo: 'cadastro' | 'edicao', podeEditarDocumento: boolean, documentoInicial: string | null | undefined) {
  return modo === 'cadastro' || (podeEditarDocumento && soDigitos(documentoInicial ?? '').length > 0)
}

/**
 * Esquema do formulário do cliente. `exigirDeclaracao` = cadastro interno (N12); `documentoObrigatorio` = ver
 * documentoObrigatorio(). Mensagens em pt-BR; o servidor valida tudo de novo.
 */
export function esquemaCliente(o: { exigirDeclaracao: boolean; documentoObrigatorio: boolean; interessesAceitos?: string[] }) {
  const aceitos = new Set([...OPCOES_INTERESSE, ...(o.interessesAceitos ?? [])])
  return z.object({
    tipo_pessoa: z.enum(['fisica', 'juridica']),
    nome: z.string().trim().min(2, 'Informe o nome').max(200, 'Nome muito longo'),
    sobrenome: z.string().trim().max(200, 'Sobrenome muito longo'),
    documento: z.string(),
    rg: z.string().trim().max(30, 'RG muito longo'),
    data_nascimento: z.string().refine((v) => {
      if (!v) return true
      const d = new Date(`${v}T12:00:00`)
      return !Number.isNaN(d.getTime()) && v >= '1900-01-01' && d <= new Date()
    }, 'Data inválida'),
    genero: z.enum(['', 'masculino', 'feminino', 'outros']),
    estado_civil: z.enum(['', 'solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel']),
    nacionalidade: z.string().trim().max(60, 'Muito longo'),
    email: z.string().trim().max(200, 'E-mail muito longo').refine((v) => !v || EMAIL.test(v), 'E-mail inválido'),
    emails_adicionais: z.string().refine((v) => listaTexto(v).length <= 10 && listaTexto(v).every((e) => EMAIL.test(e)),
      'Use e-mails válidos separados por vírgula (até 10)'),
    telefone: z.string().refine((v) => !soDigitos(v) || /^\d{10,11}$/.test(soDigitos(v)), 'Telefone com DDD (10 ou 11 dígitos)'),
    telefones_adicionais: z.string().refine((v) => listaTexto(v).length <= 10 && listaTexto(v).every((t) => /^\d{10,11}$/.test(soDigitos(t))),
      'Use telefones com DDD separados por vírgula (até 10)'),
    horario_contato: z.string().trim().max(100, 'Muito longo'),
    cep: z.string().refine((v) => !soDigitos(v) || soDigitos(v).length === 8, 'CEP com 8 dígitos'),
    logradouro: z.string().trim().max(200, 'Muito longo'),
    numero: z.string().trim().max(20, 'Muito longo'),
    complemento: z.string().trim().max(100, 'Muito longo'),
    bairro: z.string().trim().max(100, 'Muito longo'),
    cidade: z.string().trim().max(100, 'Muito longo'),
    uf: z.string(),
    pais: z.string().trim().min(2, 'Informe o país').max(60, 'Muito longo'),
    interesses: z.array(z.string()).max(40).refine((l) => l.every((i) => aceitos.has(i)), 'Interesse inválido'),
    declaracao: z.boolean(),
  }).superRefine((v, ctx) => {
    const d = soDigitos(v.documento)
    if (v.tipo_pessoa === 'fisica') {
      if (d ? !cpfValido(d) : o.documentoObrigatorio) ctx.addIssue({ code: 'custom', path: ['documento'], message: 'CPF inválido' })
    } else if (d ? !cnpjValido(d) : o.documentoObrigatorio) {
      ctx.addIssue({ code: 'custom', path: ['documento'], message: 'CNPJ inválido' })
    }
    if (o.exigirDeclaracao && !v.declaracao) {
      ctx.addIssue({ code: 'custom', path: ['declaracao'], message: 'Confirme o consentimento do cliente para continuar' })
    }
  })
}

const vazioNulo = (v: string) => (v.trim() ? v.trim() : null)

/** Formulário → `p_dados` de crm_cadastrar_cliente / leads_converter (só dígitos em documento, CEP e telefones). */
export function paraClienteDados(v: ValoresCliente): ClienteDados {
  const pf = v.tipo_pessoa === 'fisica'
  const doc = soDigitos(v.documento) || null
  return {
    tipo_pessoa: v.tipo_pessoa,
    nome: v.nome.trim(),
    sobrenome: pf ? vazioNulo(v.sobrenome) : null,
    cpf: pf ? doc : null,
    cnpj: pf ? null : doc,
    rg: pf ? vazioNulo(v.rg) : null,
    data_nascimento: pf ? vazioNulo(v.data_nascimento) : null,
    genero: pf && v.genero ? v.genero : null,
    estado_civil: pf && v.estado_civil ? v.estado_civil : null,
    nacionalidade: pf ? vazioNulo(v.nacionalidade) : null,
    email: vazioNulo(v.email)?.toLowerCase() ?? null,
    emails_adicionais: listaTexto(v.emails_adicionais).map((e) => e.toLowerCase()),
    telefone: soDigitos(v.telefone) || null,
    telefones_adicionais: listaTexto(v.telefones_adicionais).map(soDigitos),
    horario_contato: vazioNulo(v.horario_contato),
    cep: soDigitos(v.cep) || null,
    logradouro: vazioNulo(v.logradouro),
    numero: vazioNulo(v.numero),
    complemento: vazioNulo(v.complemento),
    bairro: vazioNulo(v.bairro),
    cidade: vazioNulo(v.cidade),
    uf: vazioNulo(v.uf),
    pais: vazioNulo(v.pais) ?? 'Brasil',
    interesses: [...new Set(v.interesses)],
  }
}

/** Ficha → valores do formulário (edição). */
export function valoresDaFicha(c: ClienteFicha): ValoresCliente {
  const doc = c.tipo_pessoa === 'fisica' ? c.cpf : c.cnpj
  return {
    tipo_pessoa: c.tipo_pessoa,
    nome: c.nome,
    sobrenome: c.sobrenome ?? '',
    documento: doc ? (c.tipo_pessoa === 'fisica' ? mascaraCpf(doc) : mascaraCnpj(doc)) : '',
    rg: c.rg ?? '',
    data_nascimento: c.data_nascimento ?? '',
    genero: c.genero ?? '',
    estado_civil: c.estado_civil ?? '',
    nacionalidade: c.nacionalidade ?? '',
    email: c.email ?? '',
    emails_adicionais: c.emails_adicionais.join(', '),
    telefone: c.telefone ? mascaraTelefone(c.telefone) : '',
    telefones_adicionais: c.telefones_adicionais.map(mascaraTelefone).join(', '),
    horario_contato: c.horario_contato ?? '',
    cep: c.cep ?? '',
    logradouro: c.logradouro ?? '',
    numero: c.numero ?? '',
    complemento: c.complemento ?? '',
    bairro: c.bairro ?? '',
    cidade: c.cidade ?? '',
    uf: c.uf ?? '',
    pais: c.pais || 'Brasil',
    interesses: c.interesses,
    declaracao: false,
  }
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Edição: só as chaves que mudaram em relação à ficha (crm_editar_cliente muda só as enviadas). O documento só vai
 * quando `podeDocumento` (vazio ou interno) e mudou.
 */
export function paraEdicao(v: ValoresCliente, original: ClienteFicha, podeDocumento: boolean): ClienteEdicao {
  const novo = paraClienteDados({ ...v, tipo_pessoa: original.tipo_pessoa })
  const edicao: Record<string, unknown> = {}
  const chaves = Object.keys(novo).filter((k) => k !== 'tipo_pessoa') as (keyof ClienteEdicao)[]
  for (const k of chaves) {
    if (k === 'cpf' || k === 'cnpj') continue
    const antes = original[k as keyof ClienteFicha]
    const mudou = k === 'interesses'
      ? !igual([...(novo.interesses ?? [])].sort(), [...original.interesses].sort())
      : !igual(novo[k], antes)
    if (mudou) edicao[k] = novo[k]
  }
  const campoDoc = original.tipo_pessoa === 'fisica' ? 'cpf' : 'cnpj'
  if (podeDocumento && novo[campoDoc] && !igual(novo[campoDoc], original[campoDoc])) edicao[campoDoc] = novo[campoDoc]
  return edicao as ClienteEdicao
}

/**
 * Resultado de uma edição relida do servidor (sem cache). O servidor NÃO grava um CPF/CNPJ que já exista em outro
 * cliente (A2: a tentativa fica registrada, sem erro, para a edição não virar oráculo de CPF): o documento pedido é
 * recusado quando a ficha relida não o tem. `outrosCampos` = quantas outras chaves foram enviadas (e gravadas).
 */
export function avaliarEdicao(edicao: ClienteEdicao, tipo: TipoPessoa, fichaNova: ClienteFicha | null) {
  const campoDoc = tipo === 'fisica' ? 'cpf' : 'cnpj'
  const pedido = edicao[campoDoc]
  return {
    documentoRecusado: Boolean(pedido) && fichaNova !== null && fichaNova[campoDoc] !== pedido,
    outrosCampos: Object.keys(edicao).filter((k) => k !== campoDoc).length,
  }
}

/** Campo do formulário que corresponde a um nome de campo devolvido pelo servidor em DADOS_INVALIDOS. */
export function campoDoFormulario(campo: string): keyof ValoresCliente | null {
  if (campo === 'cpf' || campo === 'cnpj') return 'documento'
  return campo in VALORES_VAZIOS ? (campo as keyof ValoresCliente) : null
}

// ============ pré-cadastro público (Edge pre-cadastro, §6.1) ============

export interface CorpoPreCadastro extends PreCadastroDados {
  codigo: string
  termo_id: string
  captcha: string
}

/**
 * Erro da Edge com o status HTTP (404 link inválido, 409 termo desatualizado, 422 dados, 429 limite por IP ou do
 * link, 403 Turnstile, 503 indisponível) e o `codigo` da Edge, quando houver.
 */
export class ErroPreCadastro extends Error {
  readonly status: number
  readonly campos: string[]
  readonly codigo: string | null
  constructor(status: number, mensagem: string, campos: string[] = [], codigo: string | null = null) {
    super(mensagem)
    this.name = 'ErroPreCadastro'
    this.status = status
    this.campos = campos
    this.codigo = codigo
  }
}

/** O termo mudou com a página aberta (409) ou deixou de estar disponível (503): a página relê o termo vigente. */
export const deveRelerTermo = (e: ErroPreCadastro) => e.status === 409 || e.status === 503 || e.codigo === 'termo_desatualizado'

const MENSAGENS_PRE_CADASTRO: Record<number, string> = {
  403: 'Não conseguimos confirmar que você não é um robô. Recarregue a página e tente de novo.',
  404: 'Este link de indicação não é válido ou foi desativado.',
  409: 'O termo de consentimento foi atualizado. Leia a nova versão e aceite para continuar.',
  422: 'Confira os dados informados e tente de novo.',
  429: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  503: 'O pré-cadastro está temporariamente indisponível. Tente de novo mais tarde.',
}

/**
 * Envia o pré-cadastro. Sucesso é sempre o mesmo (200 {ok:true}), tenha o cadastro sido criado ou não (o CPF pode já
 * existir: a resposta não revela). Falha → `ErroPreCadastro` com a mensagem da Edge.
 */
export async function enviarPreCadastro(corpo: CorpoPreCadastro): Promise<void> {
  let resposta
  try {
    resposta = await supabase.functions.invoke<{ ok?: boolean }>('pre-cadastro', { body: corpo })
  } catch {
    throw new ErroPreCadastro(0, 'Sem conexão com o servidor. Verifique a internet e tente de novo.')
  }
  const { data, error } = resposta
  if (!error && data?.ok) return
  const contexto = (error as { context?: Response } | null)?.context
  const status = contexto && typeof contexto.status === 'number' ? contexto.status : 0
  let corpoErro: { erro?: unknown; codigo?: unknown; detalhes?: { campos?: unknown } } | null = null
  if (contexto && typeof contexto.json === 'function') corpoErro = await contexto.json().catch(() => null)
  const campos = Array.isArray(corpoErro?.detalhes?.campos) ? corpoErro.detalhes.campos.filter((c): c is string => typeof c === 'string') : []
  const mensagem = typeof corpoErro?.erro === 'string' && corpoErro.erro ? corpoErro.erro
    : MENSAGENS_PRE_CADASTRO[status] ?? 'Não foi possível enviar agora. Tente de novo.'
  const codigo = typeof corpoErro?.codigo === 'string' ? corpoErro.codigo : null
  throw new ErroPreCadastro(status, mensagem, campos, codigo)
}

// ============ exportação CSV (leads) ============

/** Célula CSV segura: aspas escapadas e fórmula neutralizada (CSV injection: =, +, -, @, tab, CR). */
export function celulaCsv(v: string | number | null | undefined): string {
  let t = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return `"${t.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
}

export function csvDeLeads(itens: LeadItem[]): string {
  const cab = ['Data', 'Nome', 'Telefone', 'E-mail', 'Empreendimento', 'Mensagem', 'Status', 'Origem']
  const status = { novo: 'Novo', convertido: 'Convertido', descartado: 'Descartado' } as const
  const linhas = itens.map((l) => [
    new Date(l.criado_em).toLocaleDateString('pt-BR'), l.nome, l.telefone ?? '', l.email ?? '', l.empreendimento?.nome ?? '',
    l.mensagem ?? '', status[l.status], l.origem ?? '',
  ])
  return [cab, ...linhas].map((r) => r.map(celulaCsv).join(';')).join('\n')
}

/** Baixa um texto como arquivo CSV (com BOM para o Excel abrir em UTF-8). */
export function baixarCsv(nomeArquivo: string, csv: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = nomeArquivo
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

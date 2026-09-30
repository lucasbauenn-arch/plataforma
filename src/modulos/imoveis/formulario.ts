// Formulário do imóvel [WP5] (docs/ARQUITETURA_EXPANSAO.md §3.7, §4.2, §7.3; docs_new/modulo-imobiliario.md).
// Módulo puro (sem React nem Supabase), testado em formulario.test.ts.
// - O rascunho pode ficar incompleto: aqui só se valida formato e limites (os mesmos CHECKs de public.imoveis).
// - IMV-2 (campos obrigatórios) é do servidor, na saída do rascunho (`imovel_mudar_status` → CAMPOS_OBRIGATORIOS);
//   `camposFaltando` só antecipa a mesma lista na tela, na mesma ordem de `_imovel_campos_faltando()`.
// - Fora do rascunho (PE, RE, AP, NC) nenhum campo do IMV-2 pode ficar vazio (gatilho `imoveis_campos_obrigatorios`):
//   `esquemaImovelPara(status)` recusa o salvamento antes, campo a campo.
// - Só vão para o banco as colunas com grant (`ImovelDados`) e, na edição, só as que mudaram.

import { z } from 'zod'
import { UFS } from '@/lib/constants'
import { soDigitos } from '@/lib/format'
import type { StatusImovel } from '@/lib/types'
import type { AdicionalImovel, CampoObrigatorioImovel, Imovel, ImovelDados } from './tipos'

export const ADICIONAIS = [
  'churrasqueira', 'ar_condicionado', 'perto_metro', 'perto_parque', 'perto_onibus', 'piscina', 'aceita_pet',
] as const satisfies readonly AdicionalImovel[]

/** IMV-2, na ordem do formulário (igual a `_imovel_campos_faltando()` da migration 09). */
export const CAMPOS_OBRIGATORIOS: readonly CampoObrigatorioImovel[] = [
  'nome', 'tipo', 'cep', 'logradouro', 'numero', 'cidade', 'uf', 'valor',
]

/** Limites de `numeric(14,2)` e `numeric(10,2)`. */
export const VALOR_MAXIMO = 999_999_999_999.99
export const AREA_MAXIMA = 99_999_999.99

const texto = (max: number) => z.string().max(max, `Máximo de ${max} caracteres`)

/** Número decimal digitado ("120", "120,5", "120.50"); vazio = não informado. Sem separador de milhar. */
const RE_DECIMAL = /^\d{1,8}([.,]\d{1,2})?$/
export function lerDecimal(v: string): number | null {
  const t = v.trim()
  if (t === '' || !RE_DECIMAL.test(t)) return null
  return Number(t.replace(',', '.'))
}
const decimal = (rotulo: string) => z.string().refine((v) => {
  const t = v.trim()
  if (t === '') return true
  const n = lerDecimal(t)
  return n != null && n > 0 && n <= AREA_MAXIMA
}, `${rotulo}: use um número maior que zero, com até 2 casas (ex.: 120,5)`)

export function lerInteiro(v: string): number | null {
  const t = v.trim()
  return /^\d{1,4}$/.test(t) ? Number(t) : null
}
const inteiro = (max: number) => z.string().refine((v) => {
  const t = v.trim()
  if (t === '') return true
  const n = lerInteiro(t)
  return n != null && n <= max
}, `Use um número inteiro de 0 a ${max}`)

export const esquemaImovel = z.object({
  nome: texto(200),
  matricula: texto(100),
  tipo: z.string(),
  descricao: texto(10000),
  cep: z.string().refine((v) => v === '' || /^\d{8}$/.test(v), 'O CEP tem 8 dígitos'),
  pais: z.string().trim().min(2, 'Informe o país').max(60, 'Máximo de 60 caracteres'),
  uf: z.string().refine((v) => v === '' || (UFS as readonly string[]).includes(v), 'Estado inválido'),
  cidade: texto(100),
  bairro: texto(100),
  logradouro: texto(200),
  numero: texto(20),
  complemento: texto(100),
  valor: z.number().positive('O valor deve ser maior que zero').max(VALOR_MAXIMO, 'Valor acima do limite').nullable(),
  area_total: decimal('Área total'),
  area_construida: decimal('Área construída'),
  idade_anos: inteiro(500),
  andar: texto(20),
  quartos: inteiro(100),
  banheiros: inteiro(100),
  suites: inteiro(100),
  vagas: inteiro(1000),
  adicionais: z.array(z.enum(ADICIONAIS)),
})

export type FormImovel = z.infer<typeof esquemaImovel>

export function formVazio(): FormImovel {
  return {
    nome: '', matricula: '', tipo: '', descricao: '', cep: '', pais: 'Brasil', uf: '', cidade: '', bairro: '',
    logradouro: '', numero: '', complemento: '', valor: null, area_total: '', area_construida: '', idade_anos: '',
    andar: '', quartos: '', banheiros: '', suites: '', vagas: '', adicionais: [],
  }
}

const txt = (v: string | null | undefined) => v ?? ''
const num = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))

export function formDoImovel(i: Imovel): FormImovel {
  return {
    nome: txt(i.nome), matricula: txt(i.matricula), tipo: txt(i.tipo), descricao: txt(i.descricao), cep: txt(i.cep),
    pais: i.pais || 'Brasil', uf: txt(i.uf), cidade: txt(i.cidade), bairro: txt(i.bairro), logradouro: txt(i.logradouro),
    numero: txt(i.numero), complemento: txt(i.complemento), valor: i.valor == null ? null : Number(i.valor),
    area_total: num(i.area_total), area_construida: num(i.area_construida), idade_anos: num(i.idade_anos),
    andar: txt(i.andar), quartos: num(i.quartos), banheiros: num(i.banheiros), suites: num(i.suites), vagas: num(i.vagas),
    adicionais: ADICIONAIS.filter((a) => (i.adicionais ?? []).includes(a)),
  }
}

// o completo exato precisa ser o mesmo tipo do banco (AdicionalImovel ⊆ ADICIONAIS e vice-versa)
type Mesmo<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _adicionaisCompletos: Mesmo<(typeof ADICIONAIS)[number], AdicionalImovel> = true
void _adicionaisCompletos

/** Texto aparado; vazio vira nulo. */
const limpo = (v: string) => {
  const t = v.trim()
  return t === '' ? null : t
}

/** Formulário → colunas com grant (todas). `valor` com 2 casas; CEP só dígitos; UF em maiúsculas. */
export function dadosDoForm(f: FormImovel): ImovelDados {
  const cep = soDigitos(f.cep)
  return {
    nome: limpo(f.nome),
    matricula: limpo(f.matricula),
    tipo: limpo(f.tipo),
    descricao: limpo(f.descricao),
    cep: cep.length === 8 ? cep : null,
    pais: f.pais.trim() || 'Brasil',
    uf: limpo(f.uf)?.toUpperCase() ?? null,
    cidade: limpo(f.cidade),
    bairro: limpo(f.bairro),
    logradouro: limpo(f.logradouro),
    numero: limpo(f.numero),
    complemento: limpo(f.complemento),
    valor: f.valor == null ? null : Math.round(f.valor * 100) / 100,
    area_total: lerDecimal(f.area_total),
    area_construida: lerDecimal(f.area_construida),
    idade_anos: lerInteiro(f.idade_anos),
    andar: limpo(f.andar),
    quartos: lerInteiro(f.quartos),
    banheiros: lerInteiro(f.banheiros),
    suites: lerInteiro(f.suites),
    vagas: lerInteiro(f.vagas),
    adicionais: ADICIONAIS.filter((a) => f.adicionais.includes(a)),
  }
}

/** Colunas com grant, lidas do registro (para comparar com o formulário). */
export function dadosDoImovel(i: Imovel): ImovelDados {
  return dadosDoForm(formDoImovel(i))
}

const igual = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, k) => x === b[k]) : a === b

/**
 * Só as colunas que mudaram (o UPDATE leva o mínimo: a auditoria registra só esses nomes e o valor travado em
 * `no_contrato` nunca é reenviado).
 */
export function diferencas(antes: ImovelDados, depois: ImovelDados): ImovelDados {
  const saida: Record<string, unknown> = {}
  for (const k of Object.keys(depois) as (keyof ImovelDados)[]) {
    if (!igual(antes[k], depois[k])) saida[k] = depois[k]
  }
  return saida as ImovelDados
}

/** IMV-2 no navegador (só para antecipar a lista; quem decide é o servidor). */
export function camposFaltando(d: ImovelDados): CampoObrigatorioImovel[] {
  const vazio = (v: string | null | undefined) => v == null || v.trim() === ''
  const falta: Record<CampoObrigatorioImovel, boolean> = {
    nome: vazio(d.nome), tipo: vazio(d.tipo), cep: vazio(d.cep), logradouro: vazio(d.logradouro), numero: vazio(d.numero),
    cidade: vazio(d.cidade), uf: vazio(d.uf), valor: d.valor == null || d.valor <= 0,
  }
  return CAMPOS_OBRIGATORIOS.filter((c) => falta[c])
}

/** Campo do servidor (`detalhe.campos`) que existe no formulário. */
export const ehCampoObrigatorio = (c: string): c is CampoObrigatorioImovel =>
  (CAMPOS_OBRIGATORIOS as readonly string[]).includes(c)

/** Mensagem do campo do IMV-2 vazio: no rascunho (ao finalizar) e depois dele (ao salvar). */
export const MSG_FALTA_FINALIZAR = 'Obrigatório para finalizar o cadastro'
export const MSG_FALTA_FINALIZADO = 'Obrigatório: o cadastro já foi finalizado'

/** Mensagem do campo do IMV-2 vazio conforme o status do imóvel (o cadastro novo é rascunho). */
export const mensagemFalta = (status: StatusImovel) => (status === 'rascunho' ? MSG_FALTA_FINALIZAR : MSG_FALTA_FINALIZADO)

/**
 * Esquema do formulário conforme o status. No rascunho (e no cadastro novo), só formato e limites. Fora dele, os campos
 * do IMV-2 também não podem ficar vazios: o gatilho `imoveis_campos_obrigatorios` recusaria o UPDATE, e aqui o aviso
 * sai antes, em cada campo.
 */
export function esquemaImovelPara(status: StatusImovel) {
  return status === 'rascunho' ? esquemaImovel : esquemaFinalizado
}

const esquemaFinalizado = esquemaImovel.superRefine((f, ctx) => {
  for (const campo of camposFaltando(dadosDoForm(f))) {
    ctx.addIssue({ code: 'custom', path: [campo], message: MSG_FALTA_FINALIZADO })
  }
})

// ---------- busca da lista ----------

/** Busca da lista: "#0000012" ou "12" procura também pelo código; o resto procura no nome. */
export function interpretarBusca(texto: string): { codigo: number | null; nome: string | null } {
  const t = texto.trim().slice(0, 100)
  if (t === '') return { codigo: null, nome: null }
  const m = /^#?\s*0*(\d{1,12})$/.exec(t)
  const codigo = m ? Number(m[1]) : null
  return { codigo: codigo != null && Number.isSafeInteger(codigo) ? codigo : null, nome: t.replace(/^#\s*/, '') }
}

/** Padrão para `ilike` (curingas do usuário viram literais). */
export const padraoIlike = (t: string) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

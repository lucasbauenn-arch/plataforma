// Configurações gerais (configuracao_geral, §3.9): campos da tela, validação e o que mandar para `config_atualizar`.
// Módulo puro (testado em configuracao.test.ts). O servidor confere de novo (lista de colunas e checks da tabela).

import type { ConfigAtualizacao, ConfiguracaoGeral } from '@/modulos/config/tipos'
import { cnpjValido, soDigitos } from '@/lib/format'

type ChaveEditavel = keyof ConfigAtualizacao

export type TipoCampo = 'inteiro' | 'booleano' | 'texto' | 'cnpj' | 'lista' | 'megabytes'

export interface CampoConfig {
  chave: ChaveEditavel
  rotulo: string
  grupo: 'CRM' | 'Contratos' | 'Imóveis' | 'Segurança'
  tipo: TipoCampo
  /** Limites da tabela (inclusive). Em `megabytes`, em MB. */
  min?: number
  max?: number
  /** Pode ficar vazio (nulo). */
  opcional?: boolean
  ajuda?: string
}

export const CAMPOS_CONFIG: CampoConfig[] = [
  { chave: 'exclusividade_dias', rotulo: 'Exclusividade sem atividade (dias)', grupo: 'CRM', tipo: 'inteiro', min: 1, max: 3650 },
  { chave: 'duplicidade_bloqueios_hora', rotulo: 'Tentativas com documento já cadastrado por hora', grupo: 'CRM', tipo: 'inteiro', min: 1, max: 1000, ajuda: 'Acima disso, o cadastro é bloqueado por uma hora.' },
  { chave: 'documentos_basicos', rotulo: 'Documentos básicos (um por linha)', grupo: 'CRM', tipo: 'lista', ajuda: 'Solicitados automaticamente quando o cliente entra em Documentação.' },
  { chave: 'documento_max_bytes', rotulo: 'Tamanho máximo de documento (MB)', grupo: 'CRM', tipo: 'megabytes', min: 1, max: 5 },
  { chave: 'portal_libera_pre_cadastro', rotulo: 'Liberar o portal para quem fez pré-cadastro pelo link', grupo: 'CRM', tipo: 'booleano' },
  { chave: 'vendedora_razao_social', rotulo: 'Razão social da vendedora', grupo: 'Contratos', tipo: 'texto', opcional: true, min: 2, max: 200 },
  { chave: 'vendedora_cnpj', rotulo: 'CNPJ da vendedora', grupo: 'Contratos', tipo: 'cnpj', opcional: true },
  { chave: 'vendedora_endereco', rotulo: 'Endereço da vendedora', grupo: 'Contratos', tipo: 'texto', opcional: true, min: 5, max: 500 },
  { chave: 'prazo_assinatura_dias', rotulo: 'Prazo para assinatura (dias)', grupo: 'Contratos', tipo: 'inteiro', opcional: true, min: 1, max: 365, ajuda: 'Vazio: sem prazo (o status "expirado" só vem do D4Sign).' },
  { chave: 'imovel_fotos_max', rotulo: 'Fotos por imóvel', grupo: 'Imóveis', tipo: 'inteiro', min: 1, max: 100 },
  { chave: 'imovel_foto_max_bytes', rotulo: 'Tamanho máximo de foto (MB)', grupo: 'Imóveis', tipo: 'megabytes', min: 1, max: 5 },
  { chave: 'exigir_mfa_interno', rotulo: 'Exigir verificação em duas etapas da equipe interna', grupo: 'Segurança', tipo: 'booleano', ajuda: 'Só ligue depois de todos os internos cadastrarem o autenticador (menu Segurança).' },
  { chave: 'sessao_inatividade_horas', rotulo: 'Encerrar a sessão após inatividade (horas)', grupo: 'Segurança', tipo: 'inteiro', min: 1, max: 72 },
  { chave: 'retencao_acesso_meses', rotulo: 'Retenção dos registros de acesso (meses)', grupo: 'Segurança', tipo: 'inteiro', min: 6, max: 120 },
  { chave: 'retencao_operacao_meses', rotulo: 'Retenção dos demais registros (meses)', grupo: 'Segurança', tipo: 'inteiro', min: 6, max: 240 },
  { chave: 'download_ttl_segundos', rotulo: 'Validade do link de download (segundos)', grupo: 'Segurança', tipo: 'inteiro', min: 10, max: 3600 },
]

export const GRUPOS_CONFIG = ['CRM', 'Contratos', 'Imóveis', 'Segurança'] as const

/** Valores do formulário: tudo texto, menos os booleanos. */
export type FormConfig = Record<ChaveEditavel, string | boolean>

const MB = 1024 * 1024

export function formDaConfig(c: ConfiguracaoGeral): FormConfig {
  const f = {} as FormConfig
  for (const campo of CAMPOS_CONFIG) {
    const v = c[campo.chave]
    if (campo.tipo === 'booleano') f[campo.chave] = !!v
    else if (campo.tipo === 'lista') f[campo.chave] = (v as string[]).join('\n')
    else if (campo.tipo === 'megabytes') f[campo.chave] = String(Math.round(((v as number) / MB) * 100) / 100)
    else if (campo.tipo === 'cnpj') f[campo.chave] = v ? String(v).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : ''
    else f[campo.chave] = v == null ? '' : String(v)
  }
  return f
}

type Convertido = { ok: true; valor: unknown } | { ok: false; erro: string }

function converter(campo: CampoConfig, bruto: string | boolean): Convertido {
  if (campo.tipo === 'booleano') return { ok: true, valor: !!bruto }
  const t = String(bruto ?? '').trim()
  if (!t) return campo.opcional ? { ok: true, valor: null } : { ok: false, erro: 'Obrigatório' }
  switch (campo.tipo) {
    case 'inteiro': {
      if (!/^\d+$/.test(t)) return { ok: false, erro: 'Use um número inteiro' }
      const n = Number(t)
      if ((campo.min != null && n < campo.min) || (campo.max != null && n > campo.max)) return { ok: false, erro: `Entre ${campo.min} e ${campo.max}` }
      return { ok: true, valor: n }
    }
    case 'megabytes': {
      const n = Number(t.replace(',', '.'))
      if (!Number.isFinite(n) || n <= 0) return { ok: false, erro: 'Informe o tamanho em MB' }
      if ((campo.min != null && n < campo.min) || (campo.max != null && n > campo.max)) return { ok: false, erro: `Entre ${campo.min} e ${campo.max} MB` }
      return { ok: true, valor: Math.round(n * MB) }
    }
    case 'cnpj': {
      const d = soDigitos(t)
      if (d.length !== 14 || !cnpjValido(d)) return { ok: false, erro: 'CNPJ inválido' }
      return { ok: true, valor: d }
    }
    case 'texto': {
      if ((campo.min != null && t.length < campo.min) || (campo.max != null && t.length > campo.max)) return { ok: false, erro: `Entre ${campo.min} e ${campo.max} caracteres` }
      return { ok: true, valor: t }
    }
    case 'lista': {
      const itens = t.split('\n').map((x) => x.trim()).filter(Boolean)
      if (itens.length < 1 || itens.length > 20) return { ok: false, erro: 'De 1 a 20 documentos' }
      if (itens.some((x) => x.length < 2 || x.length > 120)) return { ok: false, erro: 'Cada nome com 2 a 120 caracteres' }
      if (new Set(itens.map((x) => x.toLowerCase())).size !== itens.length) return { ok: false, erro: 'Há documentos repetidos' }
      return { ok: true, valor: itens }
    }
  }
  return { ok: false, erro: 'Valor inválido' }
}

const iguais = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Converte e valida o formulário; devolve só as chaves que mudaram em relação à configuração atual (o que vai para
 * `config_atualizar`) ou os erros por campo.
 */
export function mudancasDaConfig(atual: ConfiguracaoGeral, form: FormConfig):
  { ok: true; mudancas: ConfigAtualizacao } | { ok: false; erros: Partial<Record<ChaveEditavel, string>> } {
  const erros: Partial<Record<ChaveEditavel, string>> = {}
  const mudancas: Record<string, unknown> = {}
  for (const campo of CAMPOS_CONFIG) {
    const r = converter(campo, form[campo.chave])
    if (!r.ok) { erros[campo.chave] = r.erro; continue }
    if (!iguais(r.valor, atual[campo.chave])) mudancas[campo.chave] = r.valor
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, mudancas: mudancas as ConfigAtualizacao }
}

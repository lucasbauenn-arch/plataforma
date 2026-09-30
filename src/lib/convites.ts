// Convites da rede de parceiros (docs/ARQUITETURA_EXPANSAO.md §6.2): o pedido e a resposta da Edge
// `convidar-parceiros` (só a versão nova, §10.1), os textos do resultado, a mensagem de WhatsApp e a leitura do link
// de definição de senha. Módulo puro (sem React nem Supabase), testado em convites.test.ts.
// Quem pode convidar quem é decidido pelo servidor (RPC rede_pode_convidar com o JWT de quem pede).

import type { Uuid } from './types'

export type ModoConvite = 'email' | 'link'

/**
 * Situação de cada parceiro no resultado da Edge (a mesma lista de `STATUS` em
 * supabase/functions/convidar-parceiros/fluxo.ts; convites.test.ts confere). `limite`: muitas respostas "email_em_uso"
 * na última hora para quem convida (o banco recusa novas consultas até a hora passar).
 */
export type StatusConvite =
  | 'convidado' | 'reenviado' | 'email_em_uso' | 'ja_ativo' | 'sem_email' | 'indisponivel'
  | 'sem_permissao' | 'modo_nao_permitido' | 'limite' | 'erro'

/** Corpo do POST para a Edge `convidar-parceiros`. */
export interface PedidoConvite {
  parceiro_ids: Uuid[]
  modo: ModoConvite
  /** Origem do site aberto (o servidor só aceita as da lista do CORS). */
  origem: string
}

/** Item de `{ resultados }` devolvido pela Edge. `link` só no modo "link" e só quando o convite foi gerado. */
export interface ResultadoConvite {
  parceiro_id: Uuid
  nome: string | null
  email: string | null
  status: StatusConvite
  mensagem: string
  link?: string
}

/** Limite da Edge por chamada. */
export const MAXIMO_CONVITES = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Monta o pedido (sem repetidos). Lança erro com texto em pt-BR se a seleção for vazia, grande demais ou inválida. */
export function montarPedidoConvite(ids: readonly string[], modo: ModoConvite, origem: string): PedidoConvite {
  const unicos = [...new Set(ids.map((i) => i.trim().toLowerCase()).filter(Boolean))]
  if (unicos.length === 0) throw new Error('Selecione ao menos um parceiro.')
  if (unicos.length > MAXIMO_CONVITES) throw new Error(`Convide no máximo ${MAXIMO_CONVITES} parceiros por vez.`)
  if (!unicos.every((i) => UUID.test(i))) throw new Error('Seleção inválida. Recarregue a página e tente de novo.')
  return { parceiro_ids: unicos, modo, origem }
}

type Tom = 'ok' | 'alerta' | 'erro' | 'neutro'

export const STATUS_CONVITE: Record<StatusConvite, { rotulo: string; tom: Tom }> = {
  convidado: { rotulo: 'Convite gerado', tom: 'ok' },
  reenviado: { rotulo: 'Convite reenviado', tom: 'ok' },
  email_em_uso: { rotulo: 'E-mail já tem conta', tom: 'alerta' },
  ja_ativo: { rotulo: 'Já tem acesso', tom: 'neutro' },
  sem_email: { rotulo: 'Sem e-mail', tom: 'alerta' },
  indisponivel: { rotulo: 'Indisponível', tom: 'neutro' },
  sem_permissao: { rotulo: 'Sem acesso', tom: 'erro' },
  modo_nao_permitido: { rotulo: 'Só por e-mail', tom: 'alerta' },
  limite: { rotulo: 'Aguarde', tom: 'alerta' },
  erro: { rotulo: 'Erro', tom: 'erro' },
}

export const conviteDeuCerto = (s: StatusConvite) => s === 'convidado' || s === 'reenviado'

/** Resumo para o toast: "3 convites enviados por e-mail; 1 não enviado." */
export function resumirConvites(resultados: readonly ResultadoConvite[], modo: ModoConvite): string {
  const ok = resultados.filter((r) => conviteDeuCerto(r.status)).length
  const falhas = resultados.length - ok
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
  const partes: string[] = []
  if (ok > 0) {
    partes.push(modo === 'email'
      ? plural(ok, 'convite enviado por e-mail', 'convites enviados por e-mail')
      : plural(ok, 'link gerado', 'links gerados'))
  }
  if (falhas > 0) partes.push(plural(falhas, 'não enviado', 'não enviados'))
  return partes.length ? `${partes.join('; ')}.` : 'Nenhum convite enviado.'
}

/** Mensagem para o WhatsApp com o link de definição de senha (vale 24 h e é de uso único). */
export const mensagemConvite = (nome: string | null | undefined, link: string) => {
  const primeiro = (nome ?? '').trim().split(/\s+/)[0]
  return `Olá${primeiro ? `, ${primeiro}` : ''}! Você foi cadastrado(a) na rede de parceiros da Arken Incorporadora. ` +
    `Defina sua senha por este link (vale 24 h e só pode ser usado uma vez): ${link}`
}

// ---------- link de definição de senha (/parceiros/definir-senha e /parceiros/nova-senha) ----------

export type TipoLinkSenha = 'invite' | 'recovery'

/** O token do Supabase é o hash do convite (hexadecimal), às vezes com prefixo `pkce_`. Nada além disso é aceito. */
const TOKEN_HASH = /^[A-Za-z0-9_-]{16,256}$/

/**
 * Lê `?token_hash=…&type=…` da URL SEM consumir o token (a página só chama verifyOtp no clique em "Continuar").
 * `aceitos` limita o tipo (a página de convite aceita convite e recuperação; a de nova senha, só recuperação).
 */
export function lerLinkSenha(busca: string, aceitos: readonly TipoLinkSenha[]): { tokenHash: string; tipo: TipoLinkSenha } | null {
  const p = new URLSearchParams(busca)
  const tokenHash = p.get('token_hash')?.trim() ?? ''
  const tipo = p.get('type')?.trim() as TipoLinkSenha | undefined
  if (!TOKEN_HASH.test(tokenHash) || !tipo || !aceitos.includes(tipo)) return null
  return { tokenHash, tipo }
}

/** Regras da nova senha (o Auth exige no mínimo 8, `minimum_password_length`). */
export function problemaSenha(senha: string, confirmacao: string): string | null {
  if (senha.length < 8) return 'Use pelo menos 8 caracteres.'
  if (senha.length > 72) return 'Use no máximo 72 caracteres.'
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'Use letras e números.'
  if (senha !== confirmacao) return 'As senhas não conferem.'
  return null
}

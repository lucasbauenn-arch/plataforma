// Anonimização a pedido do titular (docs/ARQUITETURA_EXPANSAO.md §5.5): validação do pedido e leitura da resposta da
// Edge `lgpd-anonimizar`. Módulo puro (testado em lgpd.test.ts); o banco confere tudo de novo com o JWT do Super.

import { z } from 'zod'

/** Mesmo formato aceito pela RPC lgpd_anonimizar_cliente. */
export const PROTOCOLO = /^[A-Za-z0-9][A-Za-z0-9._/#-]{2,59}$/
export const PALAVRA_CONFIRMACAO = 'ANONIMIZAR'
export const EDGE_ANONIMIZAR = 'lgpd-anonimizar'

export const esquemaAnonimizacao = z.object({
  protocolo: z.string().trim().regex(PROTOCOLO, 'Protocolo com 3 a 60 caracteres: letras, números, ponto, barra, # ou hífen'),
  // `: boolean` explícito: sem ele o TS infere um predicado de tipo e o formulário passaria a exigir o literal
  confirmacao: z.string().trim().refine((v): boolean => v === PALAVRA_CONFIRMACAO, `Digite ${PALAVRA_CONFIRMACAO} para confirmar`),
})
export type FormAnonimizacao = z.infer<typeof esquemaAnonimizacao>

export const idCliente = z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'ID de cliente inválido')

export type ResultadoAnonimizacao =
  | { situacao: 'concluida'; arquivos: number; usuarioRemovido: boolean }
  | { situacao: 'incompleta'; mensagem: string }
  | { situacao: 'erro'; mensagem: string }

/** Interpreta a resposta da Edge (status HTTP + corpo `{ok,…}` ou `{erro, codigo, detalhes}`). */
export function lerResultado(status: number, corpo: unknown): ResultadoAnonimizacao {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  if (status === 200 && c.ok === true) {
    return { situacao: 'concluida', arquivos: typeof c.arquivos_apagados === 'number' ? c.arquivos_apagados : 0, usuarioRemovido: c.usuario_removido === true }
  }
  const mensagem = typeof c.erro === 'string' && c.erro ? c.erro : 'Não foi possível anonimizar agora. Tente de novo.'
  if (status === 502 && c.codigo === 'remocao_incompleta') return { situacao: 'incompleta', mensagem }
  return { situacao: 'erro', mensagem }
}

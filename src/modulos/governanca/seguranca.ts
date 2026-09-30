// Situação da verificação em duas etapas (TOTP do Supabase, H5). Módulo puro: a tela de Segurança decide o que mostrar
// a partir dos fatores do usuário e do nível (aal) da sessão atual.

export interface FatorResumo { id: string; factor_type: string; status: string; friendly_name?: string | null; created_at?: string }

export type EtapaMfa =
  /** nenhum autenticador confirmado: cadastrar */
  | 'cadastrar'
  /** autenticador confirmado, mas esta sessão ainda é aal1: informar o código agora */
  | 'confirmar_sessao'
  /** sessão aal2: tudo certo */
  | 'ativa'

export function etapaMfa(fatores: readonly FatorResumo[], aal: string | null | undefined): EtapaMfa {
  const confirmados = fatores.filter((f) => f.factor_type === 'totp' && f.status === 'verified')
  if (confirmados.length === 0) return 'cadastrar'
  return aal === 'aal2' ? 'ativa' : 'confirmar_sessao'
}

/** Fatores TOTP ainda não confirmados (sobras de um cadastro interrompido): removidos antes de começar outro. */
export const fatoresPendentes = (fatores: readonly FatorResumo[]) =>
  fatores.filter((f) => f.factor_type === 'totp' && f.status !== 'verified')

/** Código de 6 dígitos do aplicativo autenticador (espaços ignorados). */
export const codigoTotp = (v: string) => v.replace(/\s/g, '')
export const codigoTotpValido = (v: string) => /^\d{6}$/.test(codigoTotp(v))

/**
 * Pode remover um autenticador? Só com a sessão em aal2 (o Auth exige) e sem deixar o interno sem nenhum quando a 2FA
 * é obrigatória (ele perderia o acesso na próxima renovação do token).
 */
export function podeRemover(fatores: readonly FatorResumo[], aal: string | null | undefined, exigida: boolean): boolean {
  const confirmados = fatores.filter((f) => f.factor_type === 'totp' && f.status === 'verified')
  if (aal !== 'aal2') return false
  return !(exigida && confirmados.length <= 1)
}

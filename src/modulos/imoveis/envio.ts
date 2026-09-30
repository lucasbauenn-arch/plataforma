// Envio de fotos do imóvel [WP5]: regras puras (sem React nem Supabase), testadas em envio.test.ts.
// - planejarEnvio: o que vai para o bucket a partir dos arquivos escolhidos (tipo e tamanho do original, vagas até
//   `imovel_fotos_max`). O servidor confere de novo o limite, o tamanho e o tipo REAIS em `imovel_foto_registrar`.
// - erroDoStorage: erros da API do Storage (em inglês, com status HTTP) → ErroRpc com mensagem em pt-BR.
// - mensagemDoEnvio: texto do toast para qualquer falha no envio (redução, upload ou registro).

import { ErroRpc, MENSAGENS, mensagemErro, traduzirErro } from '@/lib/erros'
import { ErroImagem, validarArquivo } from './imagem'

export interface ArquivoEscolhido { name: string; type: string; size: number }

export interface PlanoEnvio<A extends ArquivoEscolhido> {
  /** Na ordem escolhida, até o número de vagas. */
  enviar: A[]
  /** Recusados antes do envio (tipo, vazio ou grande demais), com a mensagem para a pessoa. */
  recusados: { arquivo: A; motivo: string }[]
  /** Válidos que não couberam no limite de fotos. */
  excedentes: number
}

export function planejarEnvio<A extends ArquivoEscolhido>(arquivos: readonly A[], vagas: number): PlanoEnvio<A> {
  const validos: A[] = []
  const recusados: { arquivo: A; motivo: string }[] = []
  for (const a of arquivos) {
    const motivo = validarArquivo(a)
    if (motivo) recusados.push({ arquivo: a, motivo })
    else validos.push(a)
  }
  const n = Math.max(0, Math.floor(vagas))
  return { enviar: validos.slice(0, n), recusados, excedentes: Math.max(0, validos.length - n) }
}

/** Vagas até o limite configurado (nunca negativo). */
export const vagasDeFotos = (quantidade: number, maximo: number) => Math.max(0, maximo - quantidade)

interface ErroStorageBruto { status?: unknown; statusCode?: unknown; message?: unknown; code?: unknown; error?: unknown }

/**
 * Erro do `supabase.storage` → ErroRpc. 401 = sessão; 403 ou RLS = sem acesso (política `pode_editar_imovel`);
 * 413, tamanho ou tipo recusado pelo bucket (5 MB; jpeg/png/webp) = arquivo inválido; o resto segue `traduzirErro`.
 */
export function erroDoStorage(e: unknown): ErroRpc {
  if (e instanceof ErroRpc) return e
  const b: ErroStorageBruto = e && typeof e === 'object' ? (e as ErroStorageBruto) : {}
  const status = Number(b.status ?? b.statusCode)
  const texto = [b.message, b.code, b.error].filter((x) => typeof x === 'string').join(' ')
  if (status === 401) return new ErroRpc('SESSAO_EXPIRADA', MENSAGENS.SESSAO_EXPIRADA, { sqlstate: '401' })
  if (status === 403 || /row-level security|unauthori[sz]ed|access denied|not allowed/i.test(texto)) {
    return new ErroRpc('SEM_ACESSO', MENSAGENS.SEM_ACESSO, { sqlstate: '42501' })
  }
  if (status === 413 || status === 415 || /too large|maximum allowed size|entitytoolarge|mime|invalid_?mime|content type/i.test(texto)) {
    return new ErroRpc('ARQUIVO_INVALIDO', MENSAGENS.ARQUIVO_INVALIDO)
  }
  return traduzirErro(e)
}

/** Mensagem do toast: a da redução no navegador vem pronta; as do servidor passam pela tradução. */
export const mensagemDoEnvio = (e: unknown) => (e instanceof ErroImagem ? e.message : mensagemErro(e))

/** Falha que não adianta repetir com as fotos seguintes (limite, acesso ou sessão). */
export function interrompeEnvio(e: unknown): boolean {
  if (e instanceof ErroImagem) return false
  const c = traduzirErro(e).codigo
  return c === 'LIMITE_FOTOS' || c === 'SEM_ACESSO' || c === 'SESSAO_EXPIRADA'
}

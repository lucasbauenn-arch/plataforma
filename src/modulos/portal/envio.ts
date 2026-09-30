// Envio de documento pelo portal (docs/ARQUITETURA_EXPANSAO.md §3.10, §4.3, N1): o titular só ENVIA. O arquivo vai
// para `crm-documentos/<cliente_id>/<documento_id>/<uuid>.<ext>` (política de INSERT pode_enviar_documento) e depois
// `crm_documento_registrar_envio` confere no servidor o tamanho e o tipo REAIS e leva a solicitação para análise.
// Módulo puro (testado em envio.test.ts): aqui só evitamos subir o que o servidor recusaria.

import { FORMATOS_DOCUMENTO } from '@/lib/constants'
import type { FormatoDocumento } from '@/lib/types'

/** Limite do bucket (o limite configurado pelo Super, igual ou menor, é conferido no servidor). */
export const MAX_BYTES_DOCUMENTO = 5 * 1024 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ArquivoEscolhido { name: string; size: number; type: string }

export type Validacao = { ok: true; extensao: string; mime: string } | { ok: false; erro: string }

/** `accept` do `<input type="file">` para os formatos da solicitação. */
export function aceitarDe(formatos: readonly FormatoDocumento[]): string {
  return formatos.flatMap((f) => [...FORMATOS_DOCUMENTO[f].extensoes.map((e) => `.${e}`), ...FORMATOS_DOCUMENTO[f].mimes]).join(',')
}

/** Formatos em texto ("PDF, JPEG ou PNG"). */
export function rotuloFormatos(formatos: readonly FormatoDocumento[]): string {
  const r = formatos.map((f) => FORMATOS_DOCUMENTO[f].rotulo)
  return r.length <= 1 ? (r[0] ?? '') : `${r.slice(0, -1).join(', ')} ou ${r[r.length - 1]}`
}

/**
 * Limite efetivo de envio: o configurado pelo Super (`portal_documentos().max_bytes`), nunca acima do limite do
 * bucket; valor ausente ou inválido cai no limite do bucket (o servidor confere de novo no registro do envio).
 */
export function limiteEnvio(maxBytesConfigurado: number | null | undefined): number {
  return typeof maxBytesConfigurado === 'number' && Number.isFinite(maxBytesConfigurado) && maxBytesConfigurado > 0
    ? Math.min(Math.floor(maxBytesConfigurado), MAX_BYTES_DOCUMENTO)
    : MAX_BYTES_DOCUMENTO
}

/** Tamanho legível para a mensagem de limite ("5 MB", "1,5 MB", "500 KB"). */
export function tamanhoLegivel(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${Number.isInteger(mb) ? mb : mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.floor(bytes / 1024))} KB`
}

/** Confere extensão, tipo e tamanho contra os formatos aceitos pela solicitação. */
export function validarArquivo(a: ArquivoEscolhido, formatos: readonly FormatoDocumento[], maxBytes = MAX_BYTES_DOCUMENTO): Validacao {
  if (!a.size) return { ok: false, erro: 'O arquivo está vazio.' }
  if (a.size > maxBytes) return { ok: false, erro: `O arquivo passa de ${tamanhoLegivel(maxBytes)}.` }
  const extensao = (a.name.split('.').pop() ?? '').toLowerCase()
  const formato = formatos.find((f) => FORMATOS_DOCUMENTO[f].extensoes.includes(extensao))
  if (!formato || a.name.indexOf('.') < 0) return { ok: false, erro: `Formato não aceito. Envie ${rotuloFormatos(formatos)}.` }
  const mimes = FORMATOS_DOCUMENTO[formato].mimes
  // alguns navegadores não informam o tipo (vazio): o servidor confere o tipo real de qualquer forma
  if (a.type && !mimes.includes(a.type)) return { ok: false, erro: `Formato não aceito. Envie ${rotuloFormatos(formatos)}.` }
  const mime = a.type || (extensao === 'jpg' ? 'image/jpeg' : mimes[0])
  return { ok: true, extensao: extensao === 'jpeg' ? 'jpg' : extensao, mime }
}

/** Caminho no bucket, sem dado pessoal no nome. */
export function caminhoEnvio(clienteId: string, documentoId: string, arquivoId: string, extensao: string): string {
  if (!UUID.test(clienteId) || !UUID.test(documentoId) || !UUID.test(arquivoId)) throw new Error('Identificador inválido')
  if (!/^(jpg|jpeg|png|pdf|doc|docx|xls|xlsx|csv)$/.test(extensao)) throw new Error('Extensão inválida')
  return `${clienteId.toLowerCase()}/${documentoId.toLowerCase()}/${arquivoId.toLowerCase()}.${extensao}`
}

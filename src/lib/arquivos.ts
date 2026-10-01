/** Tipos que o navegador mostra direto (imagem e PDF); os demais (DOC/DOCX) só baixando. */
export function podeVisualizar(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf'
}

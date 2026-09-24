import { supabase } from './supabase'

/** Converte um caminho do bucket 'empreendimentos' (ex.: wp/2025/10/foto.jpg) em URL pública. */
export function midiaUrl(caminho: string | null | undefined): string | null {
  if (!caminho) return null
  if (/^https?:\/\//.test(caminho)) return caminho
  return supabase.storage.from('empreendimentos').getPublicUrl(caminho).data.publicUrl
}

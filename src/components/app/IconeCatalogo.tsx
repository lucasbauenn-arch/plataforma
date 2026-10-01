import type { ReactNode } from 'react'
import clsx from 'clsx'
import { itemDoCatalogo, type TipoCatalogo } from './catalogoIcones'
import { IconeTingido } from './IconeTingido'

/**
 * Ícone de um item de lazer ou de uma proximidade, na cor da marca: o do catálogo (`icone_catalogo`) quando houver;
 * senão a imagem antiga do Storage (`imagem`, tingida por máscara); senão `padrao` (ou nada).
 */
export function IconeCatalogo({ tipo, chave, imagem, tamanho = 20, padrao = null, className }: {
  tipo: TipoCatalogo
  chave: string | null | undefined
  imagem?: string | null
  tamanho?: number
  padrao?: ReactNode
  className?: string
}) {
  const item = itemDoCatalogo(tipo, chave)
  if (item) return <item.Icone size={tamanho} aria-hidden data-icone-catalogo={item.chave} className={clsx('shrink-0 text-bronze', className)} />
  if (imagem) return <IconeTingido caminho={imagem} tamanho={tamanho} className={className} />
  return <>{padrao}</>
}

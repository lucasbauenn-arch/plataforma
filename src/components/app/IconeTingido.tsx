import clsx from 'clsx'
import { midiaUrl } from '@/lib/midia'

/**
 * Ícone monocromático do Storage (PNG/WebP com transparência ou SVG, vindos do WordPress em vermelho) pintado na cor da
 * marca sem editar o arquivo: a imagem vira máscara (`mask-image`, pelo canal alfa) de um bloco `bg-bronze`.
 * A imagem de máscara é buscada com CORS; o Storage público do Supabase responde `Access-Control-Allow-Origin: *`.
 */
export function IconeTingido({ caminho, tamanho = 40, className }: { caminho: string | null | undefined; tamanho?: number; className?: string }) {
  const url = midiaUrl(caminho)
  if (!url) return null
  // JSON.stringify escapa aspas e barras: a URL vira uma string CSS válida
  const mascara = `url(${JSON.stringify(url)})`
  return (
    <span
      aria-hidden data-icone-tingido={caminho}
      className={clsx('inline-block shrink-0 bg-bronze', className)}
      style={{
        width: tamanho, height: tamanho,
        maskImage: mascara, WebkitMaskImage: mascara,
        maskSize: 'contain', WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center', WebkitMaskPosition: 'center',
      }}
    />
  )
}

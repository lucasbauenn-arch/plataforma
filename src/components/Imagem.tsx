import { Building2 } from 'lucide-react'
import { midiaUrl } from '@/lib/midia'

export function Imagem({ src, alt, className = '' }: { src: string | null | undefined; alt: string; className?: string }) {
  const url = midiaUrl(src)
  if (!url) {
    return (
      <div className={`grid place-items-center bg-sand text-muted ${className}`} role="img" aria-label={alt}>
        <Building2 size={40} strokeWidth={1.2} />
      </div>
    )
  }
  return <img src={url} alt={alt} loading="lazy" className={className} />
}

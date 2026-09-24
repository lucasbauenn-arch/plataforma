import { MessageCircle } from 'lucide-react'
import { EMPRESA } from '@/lib/constants'
import { waLink } from '@/lib/format'

export function WhatsappFlutuante() {
  return (
    <a
      href={waLink(EMPRESA.whatsapp, 'Olá! Vim pelo site da Arken e gostaria de mais informações.')}
      target="_blank" rel="noreferrer" aria-label="Falar no WhatsApp"
      className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105"
    >
      <MessageCircle size={26} />
    </a>
  )
}

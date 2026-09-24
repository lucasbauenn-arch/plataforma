import { Link } from 'react-router-dom'
import { Mail, Phone, MapPin } from 'lucide-react'
import { Instagram, Facebook, Youtube } from './IconesSociais'
import { Logo } from './Logo'
import { EMPRESA } from '@/lib/constants'

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink text-stone/80">
      <div className="container-x grid gap-12 py-16 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-6 max-w-sm text-sm leading-relaxed">
            Incorporação e construção residencial em São Paulo — do projeto estrutural à entrega das chaves.
          </p>
          <p className="mt-6 flex max-w-sm gap-2 text-sm"><MapPin size={16} className="mt-0.5 shrink-0 text-bronze" />{EMPRESA.endereco}</p>
        </div>
        <div>
          <p className="eyebrow mb-4">A empresa</p>
          <ul className="space-y-2.5 text-sm">
            <li><Link to="/quem-somos" className="hover:text-white">Quem somos</Link></li>
            <li><Link to="/portfolio" className="hover:text-white">Portfólio</Link></li>
            <li><Link to="/parceiros" className="hover:text-white">Parceiros</Link></li>
            <li><Link to="/portal-do-cliente" className="hover:text-white">Portal do cliente</Link></li>
          </ul>
        </div>
        <div>
          <p className="eyebrow mb-4">Vendas</p>
          <ul className="space-y-2.5 text-sm">
            <li className="flex items-center gap-2"><Phone size={15} /> {EMPRESA.telefone}</li>
            <li className="flex items-center gap-2"><Mail size={15} /> <a href={`mailto:${EMPRESA.email}`} className="hover:text-white">{EMPRESA.email}</a></li>
          </ul>
          <div className="mt-6 flex gap-3">
            {[{ h: EMPRESA.instagram, I: Instagram, l: 'Instagram' }, { h: EMPRESA.facebook, I: Facebook, l: 'Facebook' }, { h: EMPRESA.youtube, I: Youtube, l: 'YouTube' }].map(({ h, I, l }) => (
              <a key={l} href={h} target="_blank" rel="noreferrer" aria-label={l} className="grid h-10 w-10 place-items-center border border-white/15 hover:border-bronze hover:text-bronze">
                <I size={17} />
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-x flex flex-col gap-3 py-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Arken Incorporadora. Todos os direitos reservados.</p>
          <div className="flex gap-5">
            <Link to="/termos-de-uso" className="hover:text-white">Termos de uso</Link>
            <Link to="/politica-de-privacidade" className="hover:text-white">Privacidade</Link>
            <Link to="/politica-de-cookies" className="hover:text-white">Cookies</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}

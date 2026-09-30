import { Mail, MessageCircle, Phone, UserCheck } from 'lucide-react'
import { EMPRESA } from '@/lib/constants'
import { mascaraTelefone, waLink, whatsappBR } from '@/lib/format'
import type { PortalMeuCorretor } from '../tipos'

/** "Seu corretor" (portal_meu_corretor). Na Carteira Arken (virtual), mostra o contato da empresa. */
export function MeuCorretor({ c }: { c: PortalMeuCorretor }) {
  const nome = c.virtual ? EMPRESA.nome : c.nome
  const telefone = c.virtual ? EMPRESA.telefone : c.telefone
  const email = c.virtual ? EMPRESA.email : c.email
  const wa = c.virtual ? EMPRESA.whatsapp : whatsappBR(c.telefone)
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="portal-corretor">
      <h2 id="portal-corretor" className="flex items-center gap-2 font-semibold"><UserCheck size={18} className="text-bronze" aria-hidden /> Seu atendimento</h2>
      <p className="mt-4 text-lg">{nome}</p>
      <p className="text-sm text-muted">
        {c.virtual ? 'Equipe de atendimento' : ['Corretor', c.creci && `CRECI ${c.creci}`, c.imobiliaria_nome].filter(Boolean).join(' · ')}
      </p>
      <ul className="mt-4 grid gap-2 text-sm">
        {wa && (
          <li>
            <a className="inline-flex items-center gap-2 font-semibold text-bronze" target="_blank" rel="noreferrer"
              href={waLink(wa, 'Olá! Sou cliente da Arken e vim pelo Portal do Cliente.')}>
              <MessageCircle size={15} aria-hidden /> WhatsApp
            </a>
          </li>
        )}
        {telefone && <li className="flex items-center gap-2"><Phone size={15} className="text-muted" aria-hidden /> {c.virtual ? telefone : mascaraTelefone(telefone)}</li>}
        {email && <li className="flex items-center gap-2 break-all"><Mail size={15} className="text-muted" aria-hidden /> <a href={`mailto:${email}`} className="hover:underline">{email}</a></li>}
      </ul>
    </section>
  )
}

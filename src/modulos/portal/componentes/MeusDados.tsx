import { UserRound } from 'lucide-react'
import { mascaraCpf, mascaraTelefone } from '@/lib/format'
import type { PortalMeusDados } from '../tipos'

const cep = (v: string | null) => (v ? v.replace(/^(\d{5})(\d{3})$/, '$1-$2') : null)

/** "Meus dados" (portal_meus_dados): só leitura; para corrigir, o titular fala com o corretor ou a equipe. */
export function MeusDados({ d }: { d: PortalMeusDados }) {
  const endereco = [
    [d.logradouro, d.numero].filter(Boolean).join(', '),
    d.complemento, d.bairro, [d.cidade, d.uf].filter(Boolean).join(' – '), cep(d.cep),
  ].filter(Boolean).join(' · ')
  const linhas: [string, string | null][] = [
    ['Nome', [d.nome, d.sobrenome].filter(Boolean).join(' ')],
    ['CPF', mascaraCpf(d.cpf)],
    ['E-mail', d.email],
    ['Telefone', d.telefone ? mascaraTelefone(d.telefone) : null],
    ['Endereço', endereco || null],
  ]
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="portal-dados">
      <h2 id="portal-dados" className="flex items-center gap-2 font-semibold"><UserRound size={18} className="text-bronze" aria-hidden /> Meus dados</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className={rotulo === 'Endereço' ? 'sm:col-span-2' : undefined}>
            <dt className="text-xs text-muted">{rotulo}</dt>
            <dd className="mt-0.5 break-words">{valor || '—'}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted">Algum dado errado? Fale com seu corretor ou com nosso atendimento para corrigir.</p>
    </section>
  )
}

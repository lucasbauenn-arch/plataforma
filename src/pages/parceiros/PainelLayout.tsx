import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useEscopo } from '@/lib/escopo'
import { BASE, MENU_PAINEL, menuDoEscopo, situacaoAcesso } from '@/lib/menu'
import { useInatividade } from '@/hooks/useInatividade'
import { Carregando } from '@/components/Estados'
import { BarraLateral } from '@/components/app/BarraLateral'
import { EstadoAcesso } from '@/components/app/EstadoAcesso'

const MEU_CADASTRO = `${BASE.painel}/meu-cadastro`

const TEXTO_PENDENCIA: Record<'cpf' | 'creci', string> = { cpf: 'CPF', creci: 'CRECI' }

/**
 * Layout da área de parceiros (fora do SiteLayout, com barra lateral). Estados de acesso pelo escopo:
 * pendente, bloqueado e inativo veem a tela informativa; termo pendente só abre "Meu cadastro";
 * CPF/CRECI pendentes aparecem como aviso. O menu vem de `meu_escopo().permissoes`.
 */
export default function PainelLayout() {
  const { profile } = useAuth()
  const { escopo, carregando, erro, recarregar } = useEscopo()
  const { pathname } = useLocation()
  useInatividade()

  if (carregando) return <div className="grid min-h-svh place-items-center bg-ink"><Carregando /></div>
  if (erro || !escopo) return <EstadoAcesso tipo="erro_escopo" detalhe={erro?.message} tentarDeNovo={recarregar} />

  const situacao = situacaoAcesso(escopo)
  if (situacao === 'mfa_pendente') return <Navigate to="/admin/seguranca" replace />
  if (situacao === 'pendente' || situacao === 'bloqueado' || situacao === 'inativo' || situacao === 'nao_liberado') {
    return <EstadoAcesso tipo={situacao} />
  }

  const termoPendente = situacao === 'termo_pendente'
  const naTelaDoCadastro = pathname === MEU_CADASTRO || pathname.startsWith(MEU_CADASTRO + '/')
  const itens = termoPendente ? MENU_PAINEL.filter((i) => i.id === 'meu-cadastro') : menuDoEscopo('painel', escopo)
  const pendencias = escopo.pendencias.filter((p): p is 'cpf' | 'creci' => p === 'cpf' || p === 'creci')
  const primeiroNome = (profile?.nome || escopo.parceiro?.nome || '').trim().split(/\s+/)[0] || 'parceiro'

  return (
    <div className="min-h-svh bg-ink lg:grid lg:grid-cols-[250px_1fr]">
      <BarraLateral itens={itens} subtitulo="Área do parceiro" nome={profile?.nome || profile?.email} />
      <main className="min-w-0 p-5 sm:p-8 lg:p-10">
        <header className="mb-8">
          <p className="eyebrow">{escopo.imobiliaria && !escopo.imobiliaria.da_casa ? escopo.imobiliaria.nome : 'Área do parceiro'}</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Olá, {primeiroNome}</h1>
        </header>
        {pendencias.length > 0 && !naTelaDoCadastro && !termoPendente && (
          <p className="mb-8 flex flex-wrap items-center justify-between gap-3 border border-bronze/40 bg-bronze/10 px-4 py-3 text-sm">
            <span>Complete seu cadastro: falta informar {pendencias.map((p) => TEXTO_PENDENCIA[p]).join(' e ')}.</span>
            <Link to={MEU_CADASTRO} className="font-semibold text-bronze">Ir para Meu cadastro</Link>
          </p>
        )}
        {termoPendente && !naTelaDoCadastro ? (
          <EstadoAcesso tipo="termo_pendente" inline acao={<Link to={MEU_CADASTRO} className="btn-primary">Ir para Meu cadastro</Link>} />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  )
}

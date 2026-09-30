import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useEscopo } from '@/lib/escopo'
import { menuDoEscopo, situacaoAcesso } from '@/lib/menu'
import { useInatividade } from '@/hooks/useInatividade'
import { Carregando } from '@/components/Estados'
import { BarraLateral } from '@/components/app/BarraLateral'
import { EstadoAcesso } from '@/components/app/EstadoAcesso'

const SEGURANCA = '/admin/seguranca'

/** Layout do admin (admin e super). O menu vem de `meu_escopo().permissoes`; com 2FA exigida e sessão aal1, só Segurança abre. */
export default function AdminLayout() {
  const { profile } = useAuth()
  const { escopo, carregando, erro, recarregar } = useEscopo()
  const { pathname } = useLocation()
  useInatividade()

  if (carregando) return <div className="grid min-h-svh place-items-center bg-ink"><Carregando /></div>
  if (erro || !escopo) return <EstadoAcesso tipo="erro_escopo" detalhe={erro?.message} tentarDeNovo={recarregar} />

  const situacao = situacaoAcesso(escopo)
  // desligado (inclusive interno com o token ainda válido): "Acesso encerrado", como na área de parceiros
  if (situacao === 'inativo') return <EstadoAcesso tipo="inativo" />
  if (situacao === 'mfa_pendente' && !pathname.startsWith(SEGURANCA)) return <Navigate to={SEGURANCA} replace />
  if (situacao !== 'liberado' && situacao !== 'mfa_pendente') return <EstadoAcesso tipo="nao_liberado" />

  return (
    <div className="min-h-svh bg-ink lg:grid lg:grid-cols-[250px_1fr]">
      <BarraLateral
        itens={menuDoEscopo('admin', escopo)}
        subtitulo={escopo.super ? 'Painel administrativo · Super' : 'Painel administrativo'}
        nome={profile?.nome || profile?.email}
      />
      <main className="min-w-0 p-5 sm:p-8 lg:p-10">
        {situacao === 'mfa_pendente' && (
          <p className="mb-6 border border-bronze/40 bg-bronze/10 px-4 py-3 text-sm">
            A verificação em duas etapas é obrigatória para a equipe. Conclua a configuração abaixo para liberar o painel.
          </p>
        )}
        <Outlet />
      </main>
    </div>
  )
}

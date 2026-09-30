import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ban, CircleAlert, Clock, Lock, LogOut, RotateCw, ScrollText, ShieldAlert, UserX, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Logo } from '@/components/Logo'

export type TipoEstadoAcesso =
  | 'pendente' | 'bloqueado' | 'inativo' | 'nao_liberado' | 'termo_pendente' | 'sem_permissao' | 'erro_perfil' | 'erro_escopo'

const TEXTOS: Record<TipoEstadoAcesso, { icone: LucideIcon; titulo: string; texto: string }> = {
  pendente: {
    icone: Clock, titulo: 'Cadastro em análise',
    texto: 'Recebemos seu cadastro. Assim que a equipe Arken aprovar, você terá acesso a tabelas, materiais e propostas.',
  },
  bloqueado: { icone: Ban, titulo: 'Acesso bloqueado', texto: 'Seu acesso à área do parceiro foi suspenso. Fale com a equipe comercial.' },
  inativo: { icone: UserX, titulo: 'Acesso encerrado', texto: 'Seu acesso à plataforma foi encerrado. Se acha que é um engano, fale com a equipe Arken.' },
  nao_liberado: {
    icone: Lock, titulo: 'Acesso ainda não liberado',
    texto: 'Seu perfil ainda não tem acesso a esta área. A equipe Arken avisa quando for liberado.',
  },
  termo_pendente: {
    icone: ScrollText, titulo: 'Aceite os termos atualizados',
    texto: 'Para continuar usando a área do parceiro, leia e aceite a versão vigente dos termos em "Meu cadastro".',
  },
  sem_permissao: { icone: ShieldAlert, titulo: 'Sem acesso a esta área', texto: 'Seu perfil não tem permissão para esta tela.' },
  erro_perfil: { icone: CircleAlert, titulo: 'Não foi possível carregar seu perfil', texto: 'Verifique a conexão e tente de novo. Se continuar, entre novamente.' },
  erro_escopo: { icone: CircleAlert, titulo: 'Não foi possível carregar seu acesso', texto: 'Verifique a conexão e tente de novo.' },
}

/**
 * Tela informativa de acesso (parceiro pendente, bloqueado, inativo, colaborador, termo pendente, sem permissão, erro).
 * `inline` = dentro de um layout (sem logo e sem ocupar a tela inteira).
 */
export function EstadoAcesso({ tipo, inline, acao, tentarDeNovo, detalhe }: {
  tipo: TipoEstadoAcesso
  inline?: boolean
  /** Botão ou link extra (ex.: "Ir para Meu cadastro"). */
  acao?: ReactNode
  tentarDeNovo?: () => unknown
  /** Texto no lugar do padrão (ex.: mensagem de erro traduzida). */
  detalhe?: string
}) {
  const { session, sair } = useAuth()
  const { icone: Icone, titulo, texto } = TEXTOS[tipo]
  const Titulo = inline ? 'h2' : 'h1'
  const conteudo = (
    <div className="max-w-md text-center">
      <Icone className="mx-auto text-bronze" size={40} aria-hidden />
      <Titulo className="display mt-4 text-4xl">{titulo}</Titulo>
      <p className="mt-3 text-muted">{detalhe ?? texto}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {acao}
        {tentarDeNovo && <button type="button" onClick={() => tentarDeNovo()} className="btn-ghost"><RotateCw size={16} aria-hidden /> Tentar de novo</button>}
        {session && !inline && <button type="button" onClick={sair} className="btn-ghost"><LogOut size={16} aria-hidden /> Sair</button>}
      </div>
    </div>
  )
  if (inline) return <section className="grid min-h-[50svh] place-items-center py-10">{conteudo}</section>
  return (
    <div className="flex min-h-svh flex-col bg-ink">
      <header className="container-x py-6"><Link to="/" aria-label="Página inicial"><Logo /></Link></header>
      <main className="container-x grid flex-1 place-items-center pb-16">{conteudo}</main>
    </div>
  )
}

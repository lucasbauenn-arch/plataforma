import type { ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { Carregando, Erro, Vazio } from '@/components/Estados'
import { traduzirErro } from '@/lib/erros'

/**
 * Estados padrão de uma consulta do TanStack Query: carregando, erro (mensagem traduzida + "Tentar de novo"),
 * vazio e conteúdo. `children` recebe os dados já carregados.
 */
export function Consulta<T>({ consulta, vazio, tituloVazio = 'Nada por aqui', textoVazio, children }: {
  consulta: { isPending: boolean; error: unknown; data: T | undefined; refetch?: () => unknown }
  /** Diz quando os dados contam como vazios (padrão: `null` ou lista vazia). */
  vazio?: (d: T) => boolean
  tituloVazio?: string
  textoVazio?: string
  children: (d: T) => ReactNode
}) {
  if (consulta.isPending) return <Carregando />
  if (consulta.error) return <ErroConsulta erro={consulta.error} tentarDeNovo={consulta.refetch} />
  const d = consulta.data as T
  const estaVazio = vazio ? vazio(d) : d == null || (Array.isArray(d) && d.length === 0)
  if (estaVazio) return <Vazio titulo={tituloVazio} texto={textoVazio} />
  return <>{children(d)}</>
}

/**
 * Erro traduzido para pt-BR, com botão para repetir. Todas as RPCs têm corpo: função fora do ar (`NAO_IMPLEMENTADO`,
 * ex.: `PGRST202` com o cache de esquema desatualizado) aparece como indisponibilidade, também com "Tentar de novo".
 */
export function ErroConsulta({ erro, tentarDeNovo }: { erro: unknown; tentarDeNovo?: () => unknown }) {
  const e = traduzirErro(erro)
  return (
    <div className="grid gap-3">
      <Erro texto={e.message} />
      {tentarDeNovo && (
        <button type="button" className="btn-ghost justify-self-start" onClick={() => tentarDeNovo()}>
          <RotateCw size={16} aria-hidden /> Tentar de novo
        </button>
      )}
    </div>
  )
}

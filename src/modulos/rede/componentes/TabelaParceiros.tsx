import { Link } from 'react-router-dom'
import { Etiqueta, SeloStatus } from '@/components/app/Etiqueta'
import { Tabela } from '@/components/app/Tabela'
import { TIPOS_PARCEIRO } from '@/lib/constants'
import type { Uuid } from '@/lib/types'
import type { LinhaParceiro } from '../api'

/**
 * Lista de parceiros (Rede, Imobiliária e Equipe). Sem CPF (minimização): o CPF só sai no detalhe, auditado.
 * Com `selecao`, mostra caixas para o convite em lote (só de quem está ativo e não é virtual).
 */
export function TabelaParceiros({ itens, rotaDetalhe, selecao, aoSelecionar, mostrarImobiliaria = true, vazio }: {
  itens: LinhaParceiro[]
  rotaDetalhe: (id: Uuid) => string
  selecao?: Set<Uuid>
  aoSelecionar?: (ids: Set<Uuid>) => void
  mostrarImobiliaria?: boolean
  vazio?: string
}) {
  const selecionaveis = itens.filter((p) => !p.inativado_em && !p.virtual)
  const todos = !!selecao && selecionaveis.length > 0 && selecionaveis.every((p) => selecao.has(p.id))
  const alternar = (id: Uuid) => {
    if (!selecao || !aoSelecionar) return
    const s = new Set(selecao)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    aoSelecionar(s)
  }
  const alternarTodos = () => {
    if (!selecao || !aoSelecionar) return
    const s = new Set(selecao)
    for (const p of selecionaveis) {
      if (todos) s.delete(p.id)
      else s.add(p.id)
    }
    aoSelecionar(s)
  }

  const colunas = [
    ...(selecao ? [{ rotulo: <input type="checkbox" aria-label="Selecionar todos" className="accent-bronze" checked={todos} onChange={alternarTodos} />, classe: 'w-10' }] : []),
    'Nome', 'Tipo', ...(mostrarImobiliaria ? ['Imobiliária'] : []), 'Gerente', 'Contato', 'Acesso',
  ]

  return (
    <Tabela colunas={colunas} legenda="Parceiros" vazio={vazio ?? 'Nenhum parceiro encontrado.'}>
      {itens.map((p) => (
        <tr key={p.id} className={p.inativado_em ? 'text-muted' : 'hover:bg-sand/40'}>
          {selecao && (
            <td>
              <input
                type="checkbox" className="accent-bronze" aria-label={`Selecionar ${p.nome}`}
                disabled={!!p.inativado_em || p.virtual} checked={selecao.has(p.id)} onChange={() => alternar(p.id)}
              />
            </td>
          )}
          <td>
            <Link to={rotaDetalhe(p.id)} className="font-semibold hover:text-bronze">{p.nome}</Link>
            {p.virtual && <span className="ml-2"><Etiqueta>virtual</Etiqueta></span>}
            {p.migrado_legado && <span className="ml-2"><Etiqueta tom="alerta" titulo="Migrado do cadastro antigo">legado</Etiqueta></span>}
          </td>
          <td>{TIPOS_PARCEIRO[p.tipo]}</td>
          {mostrarImobiliaria && <td>{p.imobiliaria ? (p.imobiliaria.da_casa ? 'Arken (casa)' : p.imobiliaria.nome) : '—'}</td>}
          <td>{p.gerente?.nome ?? '—'}</td>
          <td className="max-w-56 truncate text-muted">{p.email ?? '—'}</td>
          <td>
            <span className="flex flex-wrap gap-1">
              {p.inativado_em ? <SeloStatus tipo="parceiro" valor="inativo" />
                : p.perfil ? <SeloStatus tipo="parceiro" valor={p.perfil.status_parceiro} />
                : p.profile_id ? <Etiqueta tom="ok">Com login</Etiqueta>
                : p.virtual ? <Etiqueta>Sem login</Etiqueta>
                : <Etiqueta tom="alerta">Sem login</Etiqueta>}
            </span>
          </td>
        </tr>
      ))}
    </Tabela>
  )
}

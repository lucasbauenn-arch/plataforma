import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEscopo } from '@/lib/escopo'
import { brl, codigoExibicao, data } from '@/lib/format'
import { Abas, type Aba } from '@/components/app/Abas'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { Consulta } from '@/components/app/Consulta'
import { Etiqueta, SeloStatus } from '@/components/app/Etiqueta'
import { BarraFiltros, CampoBusca } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { Tabela } from '@/components/app/Tabela'
import { useBase } from '@/components/app/useBase'
import { chavesImoveis, listarImoveis, listarTipos, POR_PAGINA, type AbaLista, type FiltrosLista } from '../api'

const ABAS: Aba<AbaLista>[] = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'rascunho', rotulo: 'Rascunho' },
  { id: 'pendente', rotulo: 'Pendentes' },
  { id: 'em_revisao', rotulo: 'Revisão' },
  { id: 'aprovado', rotulo: 'Aprovados' },
  { id: 'no_contrato', rotulo: 'No contrato' },
]
const ehAba = (v: string | null): v is AbaLista => ABAS.some((a) => a.id === v)

/**
 * [WP5] Lista de imóveis (§7.3): abas por status, busca por nome ou código, 20 por página. A RLS aplica a regra E4:
 * em rascunho, pendente e revisão aparecem só os do próprio usuário, da cadeia abaixo dele (gerente e imobiliária) e,
 * para os internos, todos; aprovados e no contrato aparecem para todos os parceiros aprovados.
 */
export default function Imoveis() {
  const base = useBase()
  const { escopo, tem } = useEscopo()
  const [params, setParams] = useSearchParams()
  const filtros: FiltrosLista = {
    aba: ehAba(params.get('aba')) ? (params.get('aba') as AbaLista) : 'todos',
    busca: params.get('busca') ?? '',
    offset: Math.max(0, Number(params.get('offset')) || 0),
    inativos: params.get('inativos') === '1',
    criadoPor: params.get('meus') === '1' ? escopo?.profile_id ?? null : null,
  }

  const consulta = useQuery({
    queryKey: chavesImoveis.lista(filtros),
    queryFn: () => listarImoveis(filtros),
    placeholderData: keepPreviousData,
  })
  const tipos = useQuery({ queryKey: chavesImoveis.tipos, queryFn: listarTipos, staleTime: 10 * 60_000 })
  const rotuloTipo = (codigo: string | null) =>
    codigo ? tipos.data?.find((t) => t.codigo === codigo)?.rotulo ?? codigo : '—'

  function mudar(mudancas: Record<string, string | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v == null || v === '' || v === '0') p.delete(k)
      else p.set(k, v)
    }
    if (!('offset' in mudancas)) p.delete('offset')
    setParams(p, { replace: true })
  }

  return (
    <section>
      <CabecalhoPagina
        titulo="Imóveis"
        subtitulo="Imóveis de terceiros para contrato: cadastro, fotos e aprovação pela equipe Arken."
        acoes={
          <>
            <SeloProvisorio codigo="E4" />
            {tem('imoveis.cadastrar') && (
              <Link to={`${base}/imoveis/novo`} className="btn-primary"><Plus size={16} aria-hidden /> Cadastrar imóvel</Link>
            )}
          </>
        }
      />

      <div className="mb-4">
        <Abas abas={ABAS} ativa={filtros.aba} aoMudar={(a) => mudar({ aba: a === 'todos' ? null : a })} rotulo="Status do imóvel" />
      </div>

      <BarraFiltros>
        <CampoBusca valor={filtros.busca} aoMudar={(v) => mudar({ busca: v.trim() || null })}
          placeholder="Nome ou código (#0000012)" rotulo="Buscar imóvel" />
        <label className="flex items-center gap-2 py-3 text-sm text-stone/85">
          <input type="checkbox" className="accent-bronze" checked={params.get('meus') === '1'}
            onChange={(e) => mudar({ meus: e.target.checked ? '1' : null })} />
          Só os que eu cadastrei
        </label>
        <label className="flex items-center gap-2 py-3 text-sm text-stone/85">
          <input type="checkbox" className="accent-bronze" checked={filtros.inativos}
            onChange={(e) => mudar({ inativos: e.target.checked ? '1' : null })} />
          Incluir inativados
        </label>
      </BarraFiltros>

      <Consulta consulta={consulta} vazio={(d) => d.total === 0} tituloVazio="Nenhum imóvel encontrado"
        textoVazio={filtros.busca ? 'Tente outra busca ou outra aba.' : 'Os imóveis que você pode ver aparecem aqui.'}>
        {(d) => (
          <>
            <Tabela legenda="Imóveis" colunas={['Código', 'Imóvel', 'Tipo', 'Cidade', { rotulo: 'Valor', direita: true }, 'Status', 'Atualizado']}>
              {d.itens.map((i) => (
                <tr key={i.id} className="hover:bg-sand/40">
                  <td className="whitespace-nowrap text-muted">{codigoExibicao(i.codigo)}</td>
                  <td>
                    <Link to={`${base}/imoveis/${i.id}`} className="font-semibold hover:text-bronze">
                      {i.nome?.trim() || 'Sem nome'}
                    </Link>
                  </td>
                  <td>{rotuloTipo(i.tipo)}</td>
                  <td>{i.cidade ? `${i.cidade}${i.uf ? ` / ${i.uf}` : ''}` : '—'}</td>
                  <td className="text-right whitespace-nowrap">{i.valor != null ? brl(Number(i.valor)) : '—'}</td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      <SeloStatus tipo="imovel" valor={i.status} />
                      {i.inativado_em && <Etiqueta tom="erro">Inativado</Etiqueta>}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-muted">{data(i.atualizado_em ?? i.criado_em)}</td>
                </tr>
              ))}
            </Tabela>
            <Paginacao total={d.total} limite={POR_PAGINA} offset={filtros.offset} aoMudar={(o) => mudar({ offset: String(o) })} />
          </>
        )}
      </Consulta>
    </section>
  )
}

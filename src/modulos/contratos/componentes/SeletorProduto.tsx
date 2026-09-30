import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, Home } from 'lucide-react'
import { brlCentavos, codigoExibicao } from '@/lib/format'
import { Abas } from '@/components/app/Abas'
import { CampoBusca } from '@/components/app/Filtros'
import { ErroConsulta } from '@/components/app/Consulta'
import { buscarProdutos, chavesContratos, type ProdutoOpcao, type TipoProduto } from '../api'

/**
 * Escolha do produto do contrato (N4): unidade de empreendimento (não vendida, com valor de tabela) OU imóvel
 * aprovado (busca por #código ou nome). O valor mostrado é só referência: o servidor relê o valor do produto (N16).
 */
export function SeletorProduto({ valor, aoMudar, desabilitado }: {
  valor: ProdutoOpcao | null
  aoMudar: (p: ProdutoOpcao | null) => void
  desabilitado?: boolean
}) {
  const [tipo, setTipo] = useState<TipoProduto>(valor?.tipo ?? 'unidade')
  const [busca, setBusca] = useState('')
  const q = useQuery({
    queryKey: chavesContratos.produtos(tipo, busca),
    queryFn: () => buscarProdutos(tipo, busca),
    enabled: !valor && !desabilitado,
    staleTime: 30_000,
  })

  if (valor) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-sand/40 px-4 py-3 text-sm">
        <div className="flex items-center gap-3">
          {valor.tipo === 'unidade' ? <Building2 size={18} aria-hidden className="text-bronze" /> : <Home size={18} aria-hidden className="text-bronze" />}
          <div>
            <p className="font-semibold">{valor.nome}</p>
            <p className="text-xs text-muted">
              {valor.tipo === 'unidade' ? 'Unidade de empreendimento' : `Imóvel ${codigoExibicao(valor.codigo)}`} · valor de tabela {brlCentavos(valor.valor)}
            </p>
          </div>
        </div>
        {!desabilitado && <button type="button" className="btn-ghost" onClick={() => aoMudar(null)}>Trocar produto</button>}
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <Abas
        abas={[{ id: 'unidade', rotulo: 'Unidade de empreendimento' }, { id: 'imovel', rotulo: 'Imóvel aprovado' }]}
        ativa={tipo} aoMudar={(t) => { setTipo(t); setBusca('') }} rotulo="Tipo de produto"
      />
      <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar produto"
        placeholder={tipo === 'unidade' ? 'Nome do empreendimento ou identificador da unidade…' : '#código ou nome do imóvel…'} />
      {q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : (
        <ul className="max-h-64 divide-y divide-line overflow-y-auto border border-line" aria-label="Produtos disponíveis" aria-busy={q.isPending}>
          {q.isPending && <li className="px-4 py-3 text-sm text-muted">Carregando…</li>}
          {!q.isPending && !q.data?.itens.length && <li className="px-4 py-3 text-sm text-muted">Nenhum produto disponível com essa busca.</li>}
          {q.data?.itens.map((p) => (
            <li key={p.id}>
              <button
                type="button" onClick={() => aoMudar(p)}
                className={clsx('flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-sand/60')}
              >
                <span>
                  <span className="font-medium">{p.nome}</span>
                  {p.codigo != null && <span className="ml-2 text-xs text-muted">{codigoExibicao(p.codigo)}</span>}
                </span>
                <span className="whitespace-nowrap text-muted">{brlCentavos(p.valor)}</span>
              </button>
            </li>
          ))}
          {q.data?.cortado && (
            <li className="px-4 py-3 text-xs text-muted">Mostrando os primeiros resultados. Digite mais do nome ou do identificador para encontrar outros.</li>
          )}
        </ul>
      )}
    </div>
  )
}

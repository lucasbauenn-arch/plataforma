import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Mail, Plus } from 'lucide-react'
import { useEscopo } from '@/lib/escopo'
import { TIPOS_PARCEIRO } from '@/lib/constants'
import type { TipoParceiro, Uuid } from '@/lib/types'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { Consulta } from '@/components/app/Consulta'
import { BarraFiltros, CampoBusca, FiltroSelecao } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { useBase } from '@/components/app/useBase'
import { chavesRede, listarParceiros, POR_PAGINA, type FiltrosParceiros, type SituacaoFiltro } from '../api'
import { tiposCadastraveis } from '../regras'
import { FormParceiro } from '../componentes/FormParceiro'
import { ModalConvite } from '../componentes/ModalConvite'
import { TabelaParceiros } from '../componentes/TabelaParceiros'

const ehSituacao = (v: string | null): v is SituacaoFiltro => v === 'ativos' || v === 'inativos' || v === 'todos'
const ehTipo = (v: string | null): v is TipoParceiro => v === 'imobiliaria' || v === 'gerente' || v === 'corretor'

/**
 * [WP1] Painel › Equipe (§7.2): o gerente vê os corretores dele; a imobiliária, gerentes, corretores e usuários da
 * imobiliária. Cadastrar e convidar (por e-mail; o link pelo WhatsApp só com rede.convite_por_link), e no detalhe
 * editar, transferir cliente ou corretor e inativar com destino. A lista vem pela RLS (o servidor limita o escopo).
 */
export default function Equipe() {
  const base = useBase()
  const { escopo, tem } = useEscopo()
  const [params, setParams] = useSearchParams()
  const [novo, setNovo] = useState(false)
  const [selecao, setSelecao] = useState<Set<Uuid>>(new Set())
  const [convidar, setConvidar] = useState(false)
  const ehGerente = escopo?.tipo === 'gerente'
  const tipos = tiposCadastraveis(escopo)

  const filtros: FiltrosParceiros = {
    busca: params.get('busca') ?? '',
    tipo: ehTipo(params.get('tipo')) ? (params.get('tipo') as TipoParceiro) : '',
    imobiliariaId: null,
    gerenteId: null,
    situacao: ehSituacao(params.get('situacao')) ? (params.get('situacao') as SituacaoFiltro) : 'ativos',
    offset: Math.max(0, Number(params.get('offset')) || 0),
    excluirId: escopo?.parceiro_id ?? null,
  }
  const consulta = useQuery({
    queryKey: chavesRede.parceiros(filtros), queryFn: () => listarParceiros(filtros), placeholderData: keepPreviousData, enabled: !!escopo,
  })

  function mudar(mudancas: Record<string, string | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v == null || v === '' || v === '0') p.delete(k)
      else p.set(k, v)
    }
    if (!('offset' in mudancas)) p.delete('offset')
    setParams(p, { replace: true })
    setSelecao(new Set())
  }

  const selecionados = (consulta.data?.itens ?? []).filter((p) => selecao.has(p.id))

  return (
    <section>
      <CabecalhoPagina
        titulo="Equipe"
        subtitulo={ehGerente ? 'Seus corretores. Os clientes deles aparecem no seu funil.' : 'Gerentes, corretores e usuários da sua imobiliária.'}
        acoes={tipos.length > 0 && (
          <button type="button" className="btn-primary" onClick={() => setNovo(true)}>
            <Plus size={16} aria-hidden /> {tipos.length === 1 ? `Novo ${TIPOS_PARCEIRO[tipos[0]].toLowerCase()}` : 'Novo parceiro'}
          </button>
        )}
      />

      <BarraFiltros
        acoes={selecao.size > 0 && (
          <button type="button" className="btn-accent" onClick={() => setConvidar(true)}><Mail size={16} aria-hidden /> Convidar ({selecao.size})</button>
        )}
      >
        <CampoBusca valor={filtros.busca} aoMudar={(v) => mudar({ busca: v.trim() || null })} placeholder="Nome, e-mail ou CRECI" rotulo="Buscar na equipe" />
        {!ehGerente && (
          <FiltroSelecao rotulo="Tipo" valor={filtros.tipo} aoMudar={(v) => mudar({ tipo: v || null })}
            opcoes={(Object.keys(TIPOS_PARCEIRO) as TipoParceiro[]).map((t) => ({ valor: t, rotulo: TIPOS_PARCEIRO[t] }))} />
        )}
        <FiltroSelecao rotulo="Situação" valor={filtros.situacao} todos={null} aoMudar={(v) => mudar({ situacao: v === 'ativos' ? null : v })}
          opcoes={[{ valor: 'ativos', rotulo: 'Ativos' }, { valor: 'inativos', rotulo: 'Inativos' }, { valor: 'todos', rotulo: 'Todos' }]} />
      </BarraFiltros>

      <Consulta consulta={consulta} vazio={() => false}>
        {(d) => (
          <>
            <TabelaParceiros
              itens={d.itens} rotaDetalhe={(id) => `${base}/equipe/${id}`} mostrarImobiliaria={false}
              selecao={tem('rede.cadastrar_corretor') || tem('rede.cadastrar_gerente') ? selecao : undefined} aoSelecionar={setSelecao}
              vazio={ehGerente ? 'Nenhum corretor na sua equipe ainda.' : 'Ninguém cadastrado na imobiliária ainda.'}
            />
            <Paginacao total={d.total} limite={POR_PAGINA} offset={filtros.offset} aoMudar={(o) => mudar({ offset: String(o) })} />
          </>
        )}
      </Consulta>

      <FormParceiro
        aberto={novo} aoFechar={() => setNovo(false)}
        modo={{
          tipo: 'novo', tipos, interno: false, imobiliariaId: escopo?.imobiliaria_id ?? null,
          gerenteId: ehGerente ? escopo?.parceiro_id ?? null : null, gerenteFixo: ehGerente,
        }}
      />
      <ModalConvite
        aberto={convidar} aoFechar={() => { setConvidar(false); setSelecao(new Set()) }} podeLink={tem('rede.convite_por_link')}
        convidados={selecionados.map((p) => ({ id: p.id, nome: p.nome, telefone: p.telefone }))}
      />
    </section>
  )
}

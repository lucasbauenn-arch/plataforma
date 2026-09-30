import { lazy, Suspense } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { crmFicha } from '@/lib/rpc'
import { ORIGENS_CLIENTE } from '@/lib/constants'
import { Carregando } from '@/components/Estados'
import { Abas, type Aba } from '@/components/app/Abas'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ErroConsulta } from '@/components/app/Consulta'
import { Etiqueta, SeloStatus } from '@/components/app/Etiqueta'
import { EstadoAcesso } from '@/components/app/EstadoAcesso'
import { useBase } from '@/components/app/useBase'
import { chaveFicha, type CrmFicha } from '../tipos'

// Cada aba é de um pacote (§8.3) e carrega sob demanda.
const ABAS = {
  timeline: lazy(() => import('./AbaTimeline')),
  dados: lazy(() => import('./AbaDados')),
  notas: lazy(() => import('./AbaNotas')),
  tarefas: lazy(() => import('./AbaTarefas')),
  documentos: lazy(() => import('./AbaDocumentos')),
  contratos: lazy(() => import('./AbaContratos')),
  afiliados: lazy(() => import('./AbaAfiliados')),
  portal: lazy(() => import('./AbaPortal')),
  propostas: lazy(() => import('./AbaPropostas')),
}
type IdAba = keyof typeof ABAS

function abasDaFicha(f: CrmFicha): Aba<IdAba>[] {
  const c = f.contadores
  const abas: Aba<IdAba>[] = [
    { id: 'timeline', rotulo: 'Timeline' },
    { id: 'dados', rotulo: 'Dados' },
    { id: 'notas', rotulo: 'Notas', contador: c.notas },
    { id: 'tarefas', rotulo: 'Tarefas', contador: c.tarefas_pendentes },
    { id: 'documentos', rotulo: 'Documentos', contador: c.documentos_pendentes + c.documentos_em_analise },
    { id: 'contratos', rotulo: 'Contratos', contador: c.contratos_ativos },
    { id: 'afiliados', rotulo: 'Afiliados' },
    { id: 'portal', rotulo: 'Portal' },
    { id: 'propostas', rotulo: 'Propostas', contador: c.propostas },
  ]
  // a aba Portal é só dos internos (o servidor manda `ver_portal`)
  return abas.filter((a) => a.id !== 'portal' || f.permissoes.ver_portal)
}

/**
 * Ficha do cliente (casca do WP0): carrega `crm_ficha` (auditada), mostra o cabeçalho e as abas. A aba ativa fica em
 * `?aba=`; a padrão é a Timeline. Mesma tela em /admin/crm/:id e /parceiros/painel/crm/:id.
 */
export default function Ficha() {
  const { id = '' } = useParams()
  const base = useBase()
  const [params, setParams] = useSearchParams()
  const q = useQuery({ queryKey: chaveFicha(id), queryFn: () => crmFicha({ p_id: id }), enabled: !!id })

  if (q.isPending) return <Carregando />
  if (q.error) return <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} />
  if (!q.data) {
    // o servidor devolve nulo tanto para inexistente quanto para fora do escopo
    return (
      <EstadoAcesso
        tipo="sem_permissao" inline detalhe="Cliente não encontrado ou fora do seu escopo."
        acao={<Link to={`${base}/crm/lista`} className="btn-primary">Ver clientes</Link>}
      />
    )
  }

  const ficha = q.data
  const { cliente, cadeia } = ficha
  const abas = abasDaFicha(ficha)
  const pedida = params.get('aba')
  const ativa: IdAba = abas.some((a) => a.id === pedida) ? (pedida as IdAba) : 'timeline'
  const AbaAtiva = ABAS[ativa]
  const responsavel = cadeia.corretor?.nome

  return (
    <>
      <CabecalhoPagina
        voltar={{ para: `${base}/crm/lista`, rotulo: 'Clientes' }}
        eyebrow={ORIGENS_CLIENTE[cliente.origem]}
        titulo={[cliente.nome, cliente.sobrenome].filter(Boolean).join(' ')}
        subtitulo={responsavel ? `Corretor responsável: ${responsavel}` : undefined}
        acoes={
          <>
            <SeloStatus tipo="etapa" valor={cliente.etapa} />
            {cliente.anonimizado_em ? <Etiqueta tom="neutro">Anonimizado</Etiqueta> : cliente.inativado_em && <Etiqueta tom="neutro">Inativo</Etiqueta>}
            {cliente.portal_liberado && <Etiqueta tom="ok">Portal liberado</Etiqueta>}
          </>
        }
      />
      <Abas
        abas={abas} ativa={ativa} rotulo="Seções da ficha"
        aoMudar={(a) => setParams((p) => { p.set('aba', a); return p }, { replace: true })}
      />
      <div className="mt-6">
        <Suspense fallback={<Carregando />}>
          <AbaAtiva clienteId={cliente.id} ficha={ficha} recarregarFicha={() => { void q.refetch() }} />
        </Suspense>
      </div>
    </>
  )
}

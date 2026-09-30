import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Mail, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useEscopo } from '@/lib/escopo'
import { redeInativarImobiliaria } from '@/lib/rpc'
import { dataHora, mascaraCep, mascaraCnpj, mascaraTelefone } from '@/lib/format'
import type { Uuid } from '@/lib/types'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Consulta } from '@/components/app/Consulta'
import { Etiqueta } from '@/components/app/Etiqueta'
import { BarraFiltros, CampoBusca, FiltroSelecao } from '@/components/app/Filtros'
import { Paginacao } from '@/components/app/Paginacao'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { buscarImobiliaria, chavesRede, listarParceiros, POR_PAGINA, type FiltrosParceiros, type SituacaoFiltro } from '../api'
import { tiposCadastraveis } from '../regras'
import { FormImobiliaria } from '../componentes/FormImobiliaria'
import { FormParceiro } from '../componentes/FormParceiro'
import { ModalConvite } from '../componentes/ModalConvite'
import { TabelaParceiros } from '../componentes/TabelaParceiros'

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{rotulo}</dt>
      <dd className="mt-1">{children || '—'}</dd>
    </div>
  )
}

/**
 * [WP1] Admin › Rede › Imobiliária: dados (PAR-4: CNPJ e CRECI PJ), usuários, gerentes e corretores, cadastro,
 * convite e inativação (só sem parceiro ativo; a casa nunca).
 */
export default function Imobiliaria() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { escopo, tem } = useEscopo()
  const [editar, setEditar] = useState(false)
  const [inativar, setInativar] = useState(false)
  const [novo, setNovo] = useState(false)
  const [convidar, setConvidar] = useState(false)
  const [selecao, setSelecao] = useState<Set<Uuid>>(new Set())
  const [busca, setBusca] = useState('')
  const [situacao, setSituacao] = useState<SituacaoFiltro>('ativos')
  const [offset, setOffset] = useState(0)

  const imob = useQuery({ queryKey: chavesRede.imobiliaria(id ?? ''), queryFn: () => buscarImobiliaria(id!), enabled: !!id })
  const filtros: FiltrosParceiros = { busca, tipo: '', imobiliariaId: id ?? null, gerenteId: null, situacao, offset, virtuais: true }
  const parceiros = useQuery({
    queryKey: chavesRede.parceiros(filtros), queryFn: () => listarParceiros(filtros), enabled: !!id, placeholderData: keepPreviousData,
  })
  const selecionados = (parceiros.data?.itens ?? []).filter((p) => selecao.has(p.id))

  async function confirmarInativacao(motivo: string | null) {
    await redeInativarImobiliaria({ p_id: id!, p_motivo: motivo ?? '' })
    toast.success('Imobiliária inativada.')
    await qc.invalidateQueries({ queryKey: chavesRede.tudo })
  }

  return (
    <Consulta consulta={imob} tituloVazio="Imobiliária não encontrada" textoVazio="Ela não existe ou você não tem acesso.">
      {(i) => i && (
        <section>
          <CabecalhoPagina
            voltar={{ para: '/admin/rede?aba=imobiliarias', rotulo: 'Rede' }}
            eyebrow={i.da_casa ? 'Imobiliária da casa' : 'Imobiliária'}
            titulo={i.nome}
            subtitulo={i.da_casa ? 'Parceiros legados, autocadastros aprovados sem imobiliária e cadastros sem indicador ficam aqui.' : i.razao_social ?? undefined}
            acoes={
              <>
                {i.da_casa && <SeloProvisorio codigo="A4" />}
                {i.inativado_em ? <Etiqueta>Inativa</Etiqueta> : <Etiqueta tom="ok">Ativa</Etiqueta>}
                <button type="button" className="btn-ghost" onClick={() => setEditar(true)}><Pencil size={16} aria-hidden /> Editar</button>
                {!i.da_casa && !i.inativado_em && (
                  <button type="button" className="btn-ghost" onClick={() => setInativar(true)}><Ban size={16} aria-hidden /> Inativar</button>
                )}
              </>
            }
          />

          <dl className="card mb-8 grid gap-5 p-6 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Dado rotulo="CNPJ">{i.cnpj ? mascaraCnpj(i.cnpj) : i.da_casa ? <span className="flex items-center gap-2">Não informado <SeloProvisorio codigo="N7" /></span> : null}</Dado>
            <Dado rotulo="CRECI PJ">{i.creci_pj}</Dado>
            <Dado rotulo="E-mail">{i.email}</Dado>
            <Dado rotulo="Telefone">{i.telefone ? mascaraTelefone(i.telefone) : null}</Dado>
            <div className="sm:col-span-2">
              <Dado rotulo="Endereço">
                {[i.logradouro && `${i.logradouro}${i.numero ? `, ${i.numero}` : ''}`, i.complemento, i.bairro,
                  i.cidade && `${i.cidade}${i.uf ? ` / ${i.uf}` : ''}`, i.cep && mascaraCep(i.cep)].filter(Boolean).join(' · ')}
              </Dado>
            </div>
            <Dado rotulo="Cadastrada em">{dataHora(i.criado_em)}</Dado>
            {i.inativado_em && <Dado rotulo="Inativada em">{`${dataHora(i.inativado_em)}${i.motivo_inativacao ? ` — ${i.motivo_inativacao}` : ''}`}</Dado>}
          </dl>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Pessoas da imobiliária</h2>
            {!i.inativado_em && (
              <button type="button" className="btn-primary" onClick={() => setNovo(true)}><Plus size={16} aria-hidden /> Novo parceiro</button>
            )}
          </div>
          <BarraFiltros
            acoes={selecao.size > 0 && (
              <button type="button" className="btn-accent" onClick={() => setConvidar(true)}><Mail size={16} aria-hidden /> Convidar ({selecao.size})</button>
            )}
          >
            <CampoBusca valor={busca} aoMudar={(v) => { setBusca(v.trim()); setOffset(0) }} placeholder="Nome, e-mail ou CRECI" rotulo="Buscar na imobiliária" />
            <FiltroSelecao rotulo="Situação" valor={situacao} todos={null}
              aoMudar={(v) => { setSituacao(v as SituacaoFiltro); setOffset(0) }}
              opcoes={[{ valor: 'ativos', rotulo: 'Ativos' }, { valor: 'inativos', rotulo: 'Inativos' }, { valor: 'todos', rotulo: 'Todos' }]} />
          </BarraFiltros>
          <Consulta consulta={parceiros} vazio={() => false}>
            {(d) => (
              <>
                <TabelaParceiros itens={d.itens} rotaDetalhe={(pid) => `/admin/rede/parceiros/${pid}`} mostrarImobiliaria={false}
                  selecao={selecao} aoSelecionar={setSelecao} vazio="Nenhuma pessoa cadastrada nesta imobiliária." />
                <Paginacao total={d.total} limite={POR_PAGINA} offset={offset} aoMudar={setOffset} />
              </>
            )}
          </Consulta>

          <FormImobiliaria aberto={editar} atual={i} aoFechar={() => setEditar(false)} />
          <FormParceiro
            aberto={novo} aoFechar={() => setNovo(false)}
            modo={{ tipo: 'novo', tipos: tiposCadastraveis(escopo).filter((t) => !(i.da_casa && t === 'imobiliaria')), imobiliariaId: i.id, interno: !!escopo?.interno }}
          />
          <ModalConvite
            aberto={convidar} aoFechar={() => { setConvidar(false); setSelecao(new Set()) }} podeLink={tem('rede.convite_por_link')}
            convidados={selecionados.map((p) => ({ id: p.id, nome: p.nome, telefone: p.telefone }))}
          />
          <ConfirmarModal
            aberto={inativar} aoFechar={() => setInativar(false)} perigo rotuloConfirmar="Inativar imobiliária"
            titulo={`Inativar ${i.nome}`}
            texto="Só é possível inativar a imobiliária sem nenhum parceiro ativo: inative ou transfira os gerentes e corretores antes. Nada é apagado."
            motivo={{ rotulo: 'Motivo', minimo: 5 }}
            aoConfirmar={confirmarInativacao}
          />
        </section>
      )}
    </Consulta>
  )
}

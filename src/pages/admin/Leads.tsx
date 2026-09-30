import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Trash2, UserPlus, XCircle } from 'lucide-react'
import { leadsConverter, leadsDescartar, leadsExcluir, leadsExportar, leadsListar } from '@/lib/rpc'
import { ErroRpc, mensagemErro } from '@/lib/erros'
import { useEmpreendimentos } from '@/hooks/queries'
import { STATUS_LEAD } from '@/lib/constants'
import { dataHora, mascaraTelefone, whatsappBR, waLink } from '@/lib/format'
import type { StatusLead } from '@/lib/types'
import { Campo } from '@/components/Campo'
import { Carregando } from '@/components/Estados'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { ErroConsulta } from '@/components/app/Consulta'
import { SeloStatus } from '@/components/app/Etiqueta'
import { BarraFiltros, CampoBusca, FiltroSelecao } from '@/components/app/Filtros'
import { Modal } from '@/components/app/Modal'
import { Paginacao } from '@/components/app/Paginacao'
import { SeletorParceiro } from '@/components/app/SeletorParceiro'
import { Tabela } from '@/components/app/Tabela'
import {
  baixarCsv, chavesCrm, csvDeLeads, paraClienteDados, TEXTO_INDISPONIVEL, useTermoCliente, VALORES_VAZIOS, type ValoresCliente,
} from '@/modulos/crm/api-clientes'
import { FormCliente } from '@/modulos/crm/componentes/FormCliente'
import type { LeadItem, LeadsFiltros } from '@/modulos/crm/tipos'

const LIMITE = 50

/**
 * Leads do site (internos) [WP2]: caixa de entrada anônima do formulário do site. Tudo por RPC auditada:
 * leads_listar, leads_converter (vira cliente do CRM pela mesma regra A2 do cadastro), leads_descartar (com motivo),
 * leads_excluir (só "novo", spam) e leads_exportar (CSV auditado).
 */
export default function Leads() {
  const qc = useQueryClient()
  const { data: emps = [] } = useEmpreendimentos()
  const [status, setStatus] = useState<string>('novo')
  const [busca, setBusca] = useState('')
  const [emp, setEmp] = useState('')
  const [offset, setOffset] = useState(0)
  const [converter, setConverter] = useState<LeadItem | null>(null)
  const [descartar, setDescartar] = useState<LeadItem | null>(null)
  const [excluir, setExcluir] = useState<LeadItem | null>(null)
  const [exportando, setExportando] = useState(false)

  const filtros: LeadsFiltros = {
    status: (status || null) as StatusLead | null, busca: busca || null, empreendimento_id: emp || null, limite: LIMITE, offset,
  }
  const q = useQuery({
    queryKey: chavesCrm.leads(filtros),
    queryFn: () => leadsListar({ p_filtros: filtros }),
    placeholderData: keepPreviousData,
  })
  const recarregar = () => qc.invalidateQueries({ queryKey: ['crm-leads'] })

  async function exportar() {
    setExportando(true)
    try {
      const semPagina: LeadsFiltros = { status: filtros.status, busca: filtros.busca, empreendimento_id: filtros.empreendimento_id }
      const itens = await leadsExportar({ p_filtros: semPagina })
      baixarCsv('leads-arken.csv', csvDeLeads(itens))
      toast.success(`${itens.length} contato(s) exportado(s).`)
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setExportando(false)
    }
  }

  return (
    <>
      <CabecalhoPagina
        eyebrow="Comercial" titulo="Leads do site"
        subtitulo="Contatos do formulário do site. Converta em cliente do CRM, descarte com motivo ou exclua spam."
        acoes={<button type="button" className="btn-ghost" onClick={exportar} disabled={exportando}><Download size={16} aria-hidden /> {exportando ? 'Exportando…' : 'Exportar CSV'}</button>}
      />
      <BarraFiltros>
        <CampoBusca valor={busca} aoMudar={(v) => { setBusca(v); setOffset(0) }} placeholder="Nome, e-mail ou telefone" />
        <FiltroSelecao rotulo="Status" valor={status} aoMudar={(v) => { setStatus(v); setOffset(0) }}
          opcoes={(Object.keys(STATUS_LEAD) as StatusLead[]).map((s) => ({ valor: s, rotulo: STATUS_LEAD[s] }))} />
        <FiltroSelecao rotulo="Empreendimento" valor={emp} aoMudar={(v) => { setEmp(v); setOffset(0) }}
          opcoes={emps.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
      </BarraFiltros>

      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : (
        <>
          <Tabela colunas={['Data', 'Contato', 'Empreendimento', 'Mensagem', 'Status', '']} legenda="Leads" vazio="Nenhum contato." minimo={900}>
            {q.data.itens.map((l) => {
              const wa = whatsappBR(l.telefone)
              return (
                <tr key={l.id}>
                  <td className="text-muted">{dataHora(l.criado_em)}</td>
                  <td>
                    <span className="font-semibold">{l.nome}</span>
                    {l.telefone && (
                      <span className="block">
                        {wa ? <a className="text-bronze" target="_blank" rel="noreferrer" href={waLink(wa, `Olá, ${l.nome}! Aqui é da Arken.`)}>{mascaraTelefone(l.telefone)}</a> : l.telefone}
                      </span>
                    )}
                    {l.email && <span className="block text-xs text-muted">{l.email}</span>}
                  </td>
                  <td>{l.empreendimento?.nome ?? '—'}</td>
                  <td className="max-w-sm text-xs whitespace-pre-line">{l.mensagem}</td>
                  <td>
                    <SeloStatus tipo="lead" valor={l.status} />
                    {l.tratado_por && <span className="mt-1 block text-xs text-muted">{l.tratado_por.nome}</span>}
                    {l.motivo_descarte && <span className="block text-xs text-muted">{l.motivo_descarte}</span>}
                  </td>
                  <td className="text-right">
                    {l.status === 'novo' && (
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-primary px-3 py-2 text-xs" onClick={() => setConverter(l)}><UserPlus size={14} aria-hidden /> Converter</button>
                        <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => setDescartar(l)} aria-label={`Descartar ${l.nome}`}><XCircle size={14} aria-hidden /> Descartar</button>
                        <button type="button" className="text-muted hover:text-perigo" onClick={() => setExcluir(l)} aria-label={`Excluir ${l.nome}`}><Trash2 size={15} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </Tabela>
          <Paginacao total={q.data.total} limite={LIMITE} offset={offset} aoMudar={setOffset} />
        </>
      )}

      {converter && <Converter lead={converter} aoFechar={() => setConverter(null)} aoConcluir={() => void recarregar()} />}
      <ConfirmarModal
        aberto={!!descartar} titulo="Descartar este contato?" rotuloConfirmar="Descartar"
        texto="O contato fica no histórico como descartado, com o motivo."
        motivo={{ rotulo: 'Motivo do descarte' }}
        aoConfirmar={async (motivo) => {
          await leadsDescartar({ p_lead_id: descartar!.id, p_motivo: motivo ?? '' })
          toast.success('Contato descartado.')
          void recarregar()
        }}
        aoFechar={() => setDescartar(null)}
      />
      <ConfirmarModal
        aberto={!!excluir} titulo="Excluir este contato?" perigo rotuloConfirmar="Excluir"
        texto="Use só para spam: a exclusão não pode ser desfeita (fica registrada na auditoria)."
        aoConfirmar={async () => {
          await leadsExcluir({ p_lead_id: excluir!.id })
          toast.success('Contato excluído.')
          void recarregar()
        }}
        aoFechar={() => setExcluir(null)}
      />
    </>
  )
}

/** Conversão do lead em cliente do CRM (leads_converter): dados pré-preenchidos, responsável e declaração (N12). */
function Converter({ lead, aoFechar, aoConcluir }: { lead: LeadItem; aoFechar: () => void; aoConcluir: () => void }) {
  const navegar = useNavigate()
  const termo = useTermoCliente()
  const [corretor, setCorretor] = useState<string | null>(null)
  const [indisponivel, setIndisponivel] = useState(false)
  const inicial = useMemo<Partial<ValoresCliente>>(() => {
    const partes = lead.nome.trim().split(/\s+/)
    return {
      ...VALORES_VAZIOS,
      nome: partes[0] ?? '', sobrenome: partes.slice(1).join(' '),
      email: lead.email ?? '', telefone: lead.telefone ? mascaraTelefone(lead.telefone) : '',
    }
  }, [lead])

  async function converter(v: ValoresCliente) {
    setIndisponivel(false)
    if (!termo.data) throw new ErroRpc('DESCONHECIDO', 'O termo de consentimento ainda não carregou. Tente de novo.')
    const r = await leadsConverter({ p_lead_id: lead.id, p_corretor_id: corretor, p_dados: paraClienteDados(v), p_termo_id: termo.data.id })
    if (r.situacao === 'indisponivel' || !r.id) {
      setIndisponivel(true)
      return
    }
    toast.success(r.situacao === 'criado' ? 'Lead convertido em cliente.' : 'Este documento já é de um cliente: o lead foi ligado a ele.')
    aoConcluir()
    aoFechar()
    navegar(`/admin/crm/${r.id}`)
  }

  return (
    <Modal aberto titulo={`Converter ${lead.nome} em cliente`} aoFechar={aoFechar} largura="lg">
      {indisponivel && <p role="alert" className="mb-4 border border-bronze/40 bg-bronze/10 p-3 text-sm">{TEXTO_INDISPONIVEL}</p>}
      <FormCliente
        modo="cadastro" inicial={inicial} versaoTermo={termo.data?.versao ?? null} rotuloEnviar="Converter em cliente"
        aoEnviar={converter} aoCancelar={aoFechar}
        antesDosBotoes={
          <section className="card p-6">
            <Campo label="Corretor responsável">
              <SeletorParceiro valor={corretor} aoMudar={setCorretor} tipos={['corretor', 'gerente']} vazio="Carteira Arken (padrão)" />
            </Campo>
          </section>
        }
      />
    </Modal>
  )
}

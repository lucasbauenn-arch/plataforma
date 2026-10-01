import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { crmPortalSolicitacaoAtualizar, crmPortalSolicitacoes } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { dataHora } from '@/lib/format'
import { Carregando } from '@/components/Estados'
import { Campo } from '@/components/Campo'
import { ErroConsulta } from '@/components/app/Consulta'
import { Etiqueta } from '@/components/app/Etiqueta'
import { BarraFiltros, FiltroSelecao } from '@/components/app/Filtros'
import { Modal } from '@/components/app/Modal'
import { Paginacao } from '@/components/app/Paginacao'
import { Tabela } from '@/components/app/Tabela'
import {
  chavesPortal, numeroSolicitacao, proximosStatus, ROTULOS_SOLICITACAO, ROTULOS_STATUS_SOLICITACAO, TOM_STATUS_SOLICITACAO,
} from '../rotulos'
import type { SolicitacaoEquipe, SolicitacoesFiltros, StatusSolicitacao } from '../tipos'

const LIMITE = 50

/**
 * Fila de solicitações do Portal do Cliente (equipe, crm_portal_solicitacoes, auditada): abertas primeiro, a mais
 * antiga no topo. "Atender" muda o status (aberta → em atendimento → concluída) e grava a resposta que o cliente vê no
 * portal (crm_portal_solicitacao_atualizar). Com `clienteId`, mostra só os pedidos desse cliente (aba Portal da ficha).
 */
export function SolicitacoesEquipe({ clienteId, base = '/admin' }: { clienteId?: string; base?: string }) {
  const [situacao, setSituacao] = useState(clienteId ? '' : 'abertas')
  const [offset, setOffset] = useState(0)
  const [atender, setAtender] = useState<SolicitacaoEquipe | null>(null)
  const filtros: SolicitacoesFiltros = {
    abertas: situacao === 'abertas' ? true : situacao === 'concluidas' ? false : null,
    cliente_id: clienteId ?? null,
    limite: LIMITE, offset,
  }
  const q = useQuery({
    queryKey: [...chavesPortal.solicitacoesEquipe, filtros],
    queryFn: () => crmPortalSolicitacoes({ p_filtros: filtros }),
    placeholderData: keepPreviousData,
  })

  return (
    <div className="grid gap-4">
      <BarraFiltros>
        <FiltroSelecao rotulo="Situação" valor={situacao} todos="Todas" aoMudar={(v) => { setSituacao(v); setOffset(0) }}
          opcoes={[{ valor: 'abertas', rotulo: 'Abertas e em atendimento' }, { valor: 'concluidas', rotulo: 'Concluídas' }]} />
      </BarraFiltros>
      {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : (
        <>
          <Tabela colunas={['Pedido', ...(clienteId ? [] : ['Cliente']), 'Mensagem', 'Status', '']} legenda="Solicitações do portal"
            vazio="Nenhuma solicitação." minimo={clienteId ? 640 : 860}>
            {q.data.itens.map((s) => (
              <tr key={s.id}>
                <td>
                  <span className="font-semibold">{ROTULOS_SOLICITACAO[s.tipo]}</span>
                  <span className="block text-xs text-muted">{numeroSolicitacao(s.numero)} · {dataHora(s.criado_em)}</span>
                  {s.negocio && <span className="block text-xs text-muted">{s.negocio.titulo}</span>}
                </td>
                {!clienteId && (
                  <td><Link to={`${base}/crm/${s.cliente.id}?aba=portal`} className="font-semibold hover:text-bronze">{s.cliente.nome}</Link></td>
                )}
                <td className="max-w-md">
                  {s.mensagem ? <span className="line-clamp-3 whitespace-pre-line">{s.mensagem}</span> : <span className="text-muted">—</span>}
                  {s.resposta && <span className="mt-1 block text-xs text-muted">Resposta: {s.resposta}</span>}
                </td>
                <td>
                  <Etiqueta tom={TOM_STATUS_SOLICITACAO[s.status]}>{ROTULOS_STATUS_SOLICITACAO[s.status]}</Etiqueta>
                  {s.atualizado_por && <span className="mt-1 block text-xs text-muted">{s.atualizado_por.nome}</span>}
                </td>
                <td className="text-right">
                  {s.status !== 'concluida' && (
                    <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => setAtender(s)}
                      aria-label={`Atender ${ROTULOS_SOLICITACAO[s.tipo]} ${numeroSolicitacao(s.numero)}`}>Atender</button>
                  )}
                </td>
              </tr>
            ))}
          </Tabela>
          <Paginacao total={q.data.total} limite={LIMITE} offset={offset} aoMudar={setOffset} />
        </>
      )}
      {atender && <Atender s={atender} aoFechar={() => setAtender(null)} />}
    </div>
  )
}

const esquema = z.object({
  status: z.enum(['aberta', 'em_atendimento', 'concluida']),
  resposta: z.string().trim().max(2000, 'Escreva no máximo 2.000 caracteres.'),
})
type FormAtender = z.infer<typeof esquema>

function Atender({ s, aoFechar }: { s: SolicitacaoEquipe; aoFechar: () => void }) {
  const qc = useQueryClient()
  const opcoes = proximosStatus(s.status)
  const form = useForm<FormAtender>({
    resolver: zodResolver(esquema.superRefine((v, ctx) => {
      if (v.status === 'concluida' && !v.resposta && !s.resposta) {
        ctx.addIssue({ code: 'custom', path: ['resposta'], message: 'Escreva a resposta ao cliente para concluir.' })
      }
    })),
    defaultValues: { status: s.status === 'aberta' ? 'em_atendimento' : 'concluida', resposta: s.resposta ?? '' },
  })
  const status = useWatch({ control: form.control, name: 'status' })
  const enviando = form.formState.isSubmitting

  async function salvar(v: FormAtender) {
    try {
      await crmPortalSolicitacaoAtualizar({ p_id: s.id, p_status: v.status as StatusSolicitacao, p_resposta: v.resposta || null })
    } catch (e) {
      toast.error(mensagemErro(e))
      return
    }
    toast.success(v.status === 'concluida' ? 'Solicitação concluída. O cliente vê a resposta no portal.' : 'Solicitação atualizada.')
    aoFechar()
    await qc.invalidateQueries({ queryKey: chavesPortal.solicitacoesEquipe })
  }

  return (
    <Modal
      aberto titulo={`${ROTULOS_SOLICITACAO[s.tipo]} ${numeroSolicitacao(s.numero)}`} aoFechar={aoFechar} bloquearFechar={enviando}
      rodape={<>
        <button type="button" className="btn-ghost" onClick={aoFechar} disabled={enviando}>Cancelar</button>
        <button type="submit" form="form-atender" className="btn-primary" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar'}</button>
      </>}
    >
      <form id="form-atender" className="grid gap-4" noValidate onSubmit={form.handleSubmit(salvar)}>
        <div className="text-sm">
          <p className="text-muted">{s.cliente.nome} · aberta em {dataHora(s.criado_em)}{s.negocio ? ` · ${s.negocio.titulo}` : ''}</p>
          {s.mensagem && <p className="mt-2 whitespace-pre-line">{s.mensagem}</p>}
        </div>
        <Campo label="Status" obrigatorio>
          <select className="input" {...form.register('status')}>
            {opcoes.map((o) => <option key={o} value={o}>{ROTULOS_STATUS_SOLICITACAO[o]}</option>)}
          </select>
        </Campo>
        <Campo label="Resposta ao cliente" obrigatorio={status === 'concluida'} erro={form.formState.errors.resposta?.message}>
          <textarea className="input" rows={4} maxLength={2000} placeholder="O cliente vê esta resposta no portal."
            aria-invalid={!!form.formState.errors.resposta || undefined} {...form.register('resposta')} />
        </Campo>
      </form>
    </Modal>
  )
}

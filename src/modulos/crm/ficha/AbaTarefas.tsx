import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Pencil, Plus } from 'lucide-react'
import { crmResponsaveis, crmTarefaConcluir, crmTarefaCriar, crmTarefaEditar, crmTarefas } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { TIPOS_PARCEIRO } from '@/lib/constants'
import { dataHora } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { Consulta } from '@/components/app/Consulta'
import { SeloStatus } from '@/components/app/Etiqueta'
import { Modal } from '@/components/app/Modal'
import { chavesFunil } from '../api-funil'
import { dataSemFuso, hojeSaoPaulo } from '../funil'
import type { ClienteTarefa, PropsAbaFicha, Responsavel, TarefaEdicao } from '../tipos'

const esquema = z.object({
  titulo: z.string().trim().min(1, 'Informe o que deve ser feito.').max(200, 'Até 200 caracteres.'),
  descricao: z.string().trim().max(2000, 'Até 2.000 caracteres.'),
  responsavel_id: z.string().min(1, 'Escolha o responsável.'),
  prazo: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Data inválida.'),
})
type FormTarefa = z.infer<typeof esquema>

const rotuloResponsavel = (r: Responsavel) =>
  `${r.nome} (${r.tipo ? TIPOS_PARCEIRO[r.tipo] : r.papel === 'super' ? 'Super' : 'Equipe Arken'})`

/** Criar (sem `tarefa`) ou editar. Na edição só vão as chaves alteradas; o prazo só é conferido se mudar. */
function ModalTarefa({ clienteId, tarefa, aberto, aoFechar, aoSalvar }: {
  clienteId: string
  tarefa: ClienteTarefa | null
  aberto: boolean
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const responsaveis = useQuery({
    queryKey: chavesFunil.responsaveis(clienteId), queryFn: () => crmResponsaveis({ p_cliente_id: clienteId }), enabled: aberto,
  })
  const opcoes = responsaveis.data ?? []
  // o responsável atual continua na lista mesmo que quem edita não possa escolhê-lo (a RPC só confere na troca)
  const atualForaDaLista = tarefa?.responsavel && !opcoes.some((o) => o.profile_id === tarefa.responsavel!.id) ? tarefa.responsavel : null
  const form = useForm<FormTarefa>({
    resolver: zodResolver(esquema),
    values: {
      titulo: tarefa?.titulo ?? '', descricao: tarefa?.descricao ?? '',
      responsavel_id: tarefa?.responsavel?.id ?? (opcoes[0]?.profile_id ?? ''), prazo: tarefa?.prazo ?? '',
    },
    resetOptions: { keepDirtyValues: true },
  })
  const e = form.formState.errors

  const salvar = useMutation({
    mutationFn: async (d: FormTarefa) => {
      const prazo = d.prazo || null
      if (prazo && prazo !== (tarefa?.prazo ?? null) && prazo < hojeSaoPaulo()) {
        form.setError('prazo', { message: 'O prazo não pode estar no passado.' })
        return false
      }
      if (!tarefa) {
        await crmTarefaCriar({
          p_cliente_id: clienteId, p_titulo: d.titulo, p_descricao: d.descricao || null, p_responsavel_id: d.responsavel_id, p_prazo: prazo,
        })
        return true
      }
      const mudou: TarefaEdicao = {}
      if (d.titulo !== tarefa.titulo) mudou.titulo = d.titulo
      if ((d.descricao || null) !== tarefa.descricao) mudou.descricao = d.descricao || null
      if (d.responsavel_id !== (tarefa.responsavel?.id ?? '')) mudou.responsavel_id = d.responsavel_id
      if (prazo !== tarefa.prazo) mudou.prazo = prazo
      if (Object.keys(mudou).length) await crmTarefaEditar({ p_id: tarefa.id, p_dados: mudou })
      return true
    },
    onSuccess: (ok) => {
      if (!ok) return
      toast.success(tarefa ? 'Tarefa atualizada.' : 'Tarefa criada.')
      aoSalvar()
      aoFechar()
    },
    onError: (err) => toast.error(mensagemErro(err)),
  })

  const idForm = tarefa ? `form-tarefa-${tarefa.id}` : 'form-tarefa-nova'
  return (
    <Modal
      aberto={aberto} titulo={tarefa ? 'Editar tarefa' : 'Nova tarefa'} aoFechar={aoFechar} bloquearFechar={salvar.isPending}
      rodape={
        <>
          <button type="button" className="btn-ghost" onClick={aoFechar} disabled={salvar.isPending}>Cancelar</button>
          <button type="submit" form={idForm} className="btn-primary" disabled={salvar.isPending || responsaveis.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id={idForm} className="grid gap-4" noValidate onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
        <Campo label="O que fazer" obrigatorio erro={e.titulo?.message}>
          <input className="input" maxLength={200} aria-invalid={!!e.titulo || undefined} {...form.register('titulo')} />
        </Campo>
        <Campo label="Detalhes" erro={e.descricao?.message}>
          <textarea className="input" rows={3} maxLength={2000} {...form.register('descricao')} />
        </Campo>
        <Campo label="Responsável" obrigatorio erro={e.responsavel_id?.message ?? (responsaveis.error ? mensagemErro(responsaveis.error) : undefined)}>
          <select className="input" disabled={responsaveis.isPending} aria-invalid={!!e.responsavel_id || undefined} {...form.register('responsavel_id')}>
            {responsaveis.isPending && <option value="">Carregando…</option>}
            {atualForaDaLista && <option value={atualForaDaLista.id}>{atualForaDaLista.nome}</option>}
            {opcoes.map((r) => <option key={r.profile_id} value={r.profile_id}>{rotuloResponsavel(r)}</option>)}
          </select>
        </Campo>
        <Campo label="Prazo" erro={e.prazo?.message}>
          <input type="date" className="input" min={hojeSaoPaulo()} aria-invalid={!!e.prazo || undefined} {...form.register('prazo')} />
        </Campo>
        <p className="text-xs text-muted">Só aparecem como responsáveis pessoas com acesso a este cliente, da sua equipe.</p>
      </form>
    </Modal>
  )
}

/**
 * [WP3] Aba Tarefas (§7.3): pendentes primeiro, por prazo; "atrasada" calculada no servidor (fuso de São Paulo).
 * Editar e concluir conforme o servidor (`pode_editar`/`pode_concluir`): responsável, criador, cadeia acima ou interno;
 * se o responsável perdeu o acesso ao cliente (ex.: transferência), quem tem o cliente agora trata e reatribui a tarefa.
 * Nomes de quem está acima ou ao lado vêm genéricos do servidor (PAR-3).
 */
export default function AbaTarefas({ clienteId, ficha, recarregarFicha }: PropsAbaFicha) {
  const qc = useQueryClient()
  const consulta = useQuery({ queryKey: chavesFunil.tarefas(clienteId), queryFn: () => crmTarefas({ p_id: clienteId }) })
  const [editando, setEditando] = useState<ClienteTarefa | null>(null)
  const [criando, setCriando] = useState(false)
  const podeCriar = ficha.permissoes.criar_tarefa && !ficha.cliente.inativado_em

  function atualizar() {
    void qc.invalidateQueries({ queryKey: chavesFunil.tarefas(clienteId) })
    void qc.invalidateQueries({ queryKey: chavesFunil.timeline(clienteId) })
    void qc.invalidateQueries({ queryKey: chavesFunil.minhasTarefasTodas })
    recarregarFicha()
  }
  const concluir = useMutation({
    mutationFn: (id: string) => crmTarefaConcluir({ p_id: id }),
    onSuccess: () => { toast.success('Tarefa concluída.'); atualizar() },
    onError: (e) => toast.error(mensagemErro(e)),
  })

  return (
    <section aria-labelledby="titulo-tarefas">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 id="titulo-tarefas" className="text-lg font-semibold">Tarefas</h3>
        {podeCriar && (
          <button type="button" className="btn-primary" onClick={() => setCriando(true)}><Plus size={16} aria-hidden /> Nova tarefa</button>
        )}
      </div>
      <Consulta consulta={consulta} tituloVazio="Nenhuma tarefa" textoVazio="Crie tarefas para organizar os próximos passos com este cliente.">
        {(tarefas) => (
          <ul className="grid gap-3">
            {tarefas!.map((t) => (
              <li key={t.id} className="card flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{t.titulo}</p>
                    <SeloStatus tipo="tarefa" valor={t.status} atrasada={t.atrasada} />
                  </div>
                  {t.descricao && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone/85">{t.descricao}</p>}
                  <p className="mt-2 text-xs text-muted">
                    Responsável: {t.responsavel?.nome ?? '—'} · Prazo: {t.prazo ? dataSemFuso(t.prazo) : 'sem prazo'}
                    {t.criado_por && <> · Criada por {t.criado_por.nome}</>}
                    {t.concluida_em && <> · Concluída em {dataHora(t.concluida_em)}{t.concluida_por && ` por ${t.concluida_por.nome}`}</>}
                  </p>
                </div>
                <div className="flex gap-2">
                  {t.pode_editar && (
                    <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditando(t)} aria-label={`Editar: ${t.titulo}`}>
                      <Pencil size={14} aria-hidden /> Editar
                    </button>
                  )}
                  {t.pode_concluir && (
                    <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={concluir.isPending}
                      onClick={() => concluir.mutate(t.id)} aria-label={`Concluir: ${t.titulo}`}>
                      <Check size={14} aria-hidden /> Concluir
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Consulta>
      {criando && <ModalTarefa clienteId={clienteId} tarefa={null} aberto aoFechar={() => setCriando(false)} aoSalvar={atualizar} />}
      {editando && <ModalTarefa clienteId={clienteId} tarefa={editando} aberto aoFechar={() => setEditando(null)} aoSalvar={atualizar} />}
    </section>
  )
}

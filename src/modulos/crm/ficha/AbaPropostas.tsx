import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { propostasCriar, propostasListar, propostasResponder } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import { mensagemErro, traduzirErro, ErroRpc, listaDoDetalhe } from '@/lib/erros'
import { useEmpreendimentos } from '@/hooks/queries'
import { STATUS_PROPOSTA } from '@/lib/constants'
import { data } from '@/lib/format'
import type { StatusProposta } from '@/lib/types'
import { Campo } from '@/components/Campo'
import { Carregando } from '@/components/Estados'
import { ErroConsulta } from '@/components/app/Consulta'
import { SeloStatus } from '@/components/app/Etiqueta'
import { SeletorCliente } from '@/components/app/SeletorCliente'
import { chavesCrm } from '../api-clientes'
import type { ClienteOpcao, PropostaItem, PropsAbaFicha } from '../tipos'

/**
 * Aba Propostas [WP2]: propostas do cliente (propostas_listar com cliente_id) e o envio de uma nova
 * (propostas_criar; só parceiro aprovado com o cliente no escopo). Os componentes CartaoProposta e FormProposta
 * também servem às páginas de propostas do painel e do admin.
 */
export default function AbaPropostas({ clienteId, ficha, recarregarFicha }: PropsAbaFicha) {
  const filtros = { cliente_id: clienteId, limite: 100 }
  const q = useQuery({ queryKey: chavesCrm.propostas(filtros), queryFn: () => propostasListar({ p_filtros: filtros }) })
  const cliente: ClienteOpcao = {
    id: clienteId, nome: [ficha.cliente.nome, ficha.cliente.sobrenome].filter(Boolean).join(' '), etapa: ficha.cliente.etapa,
    corretor_nome: ficha.cadeia.corretor?.nome ?? null,
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      {ficha.permissoes.criar_proposta ? (
        <FormProposta clienteFixo={cliente} aoEnviar={recarregarFicha} />
      ) : (
        <p className="card p-6 text-sm text-muted">
          {ficha.permissoes.editar ? 'Propostas são enviadas pelos parceiros; a equipe Arken responde.' : 'Cliente inativo: sem novas propostas.'}
        </p>
      )}
      <div>
        <h3 className="mb-4 text-lg font-semibold">Propostas do cliente</h3>
        {q.isPending ? <Carregando /> : q.error ? <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} /> : q.data.itens.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma proposta para este cliente.</p>
        ) : (
          <ul className="grid gap-3">{q.data.itens.map((p) => <CartaoProposta key={p.id} proposta={p} mostrarCliente={false} />)}</ul>
        )}
      </div>
    </div>
  )
}

/** Uma proposta: empreendimento, cliente, autor, cadeia visível, texto, status e resposta (internos respondem aqui). */
export function CartaoProposta({ proposta: p, mostrarCliente = true }: { proposta: PropostaItem; mostrarCliente?: boolean }) {
  const cadeia = [p.imobiliaria?.nome, p.gerente?.nome, p.corretor?.nome].filter(Boolean).join(' › ')
  return (
    <li className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{p.empreendimento.nome}{p.unidade ? ` · ${p.unidade.identificador}` : ''}</p>
          <p className="text-xs text-muted">
            {data(p.criado_em)} · por {p.autor.nome}
            {mostrarCliente && p.cliente ? ` · cliente ${p.cliente.nome}` : ''}
          </p>
          {cadeia && <p className="text-xs text-muted">{cadeia}</p>}
        </div>
        <SeloStatus tipo="proposta" valor={p.status} />
      </div>
      <p className="mt-3 text-sm whitespace-pre-line text-stone/80">{p.texto}</p>
      {p.pode_responder ? <Responder proposta={p} /> : p.resposta_admin && (
        <p className="mt-3 bg-sand/60 p-3 text-sm whitespace-pre-line"><strong>Resposta Arken:</strong> {p.resposta_admin}</p>
      )}
    </li>
  )
}

function Responder({ proposta: p }: { proposta: PropostaItem }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<StatusProposta>(p.status)
  const [resposta, setResposta] = useState(p.resposta_admin ?? '')
  const [salvando, setSalvando] = useState(false)
  async function salvar() {
    setSalvando(true)
    try {
      await propostasResponder({ p_id: p.id, p_status: status, p_resposta: resposta.trim() || null })
      toast.success('Proposta atualizada.')
      void qc.invalidateQueries({ queryKey: chavesCrm.propostasTodas })
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }
  return (
    <div className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-[200px_1fr]">
      <label className="block">
        <span className="label">Status</span>
        <select className="input py-2" value={status} onChange={(e) => setStatus(e.target.value as StatusProposta)}>
          {(Object.keys(STATUS_PROPOSTA) as StatusProposta[]).map((s) => <option key={s} value={s}>{STATUS_PROPOSTA[s]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Resposta ao parceiro</span>
        <textarea className="input py-2" rows={2} maxLength={5000} value={resposta} onChange={(e) => setResposta(e.target.value)} />
      </label>
      <button type="button" className="btn-primary justify-self-start py-2 sm:col-start-2" onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Salvar resposta'}
      </button>
    </div>
  )
}

const esquemaProposta = z.object({
  empreendimento_id: z.string().min(1, 'Selecione um empreendimento'),
  unidade_id: z.string(),
  texto: z.string().trim().min(10, 'Descreva a proposta (mínimo de 10 caracteres)').max(5000, 'Texto muito longo'),
})
type DadosProposta = z.infer<typeof esquemaProposta>

/**
 * Envio de proposta (propostas_criar): empreendimento, unidade opcional (não vendida), cliente do CRM opcional
 * (crm_clientes_opcoes) e o texto. Com `clienteFixo`, o cliente vem da ficha.
 */
export function FormProposta({ clienteFixo, aoEnviar }: { clienteFixo?: ClienteOpcao; aoEnviar?: () => void }) {
  const qc = useQueryClient()
  const idCliente = useId()
  const { data: emps = [] } = useEmpreendimentos()
  const [cliente, setCliente] = useState<ClienteOpcao | null>(clienteFixo ?? null)
  const { register, handleSubmit, reset, control, setError, formState: { errors, isSubmitting } } = useForm<DadosProposta>({
    resolver: zodResolver(esquemaProposta), defaultValues: { empreendimento_id: '', unidade_id: '', texto: '' },
  })
  const empId = useWatch({ control, name: 'empreendimento_id' })
  const unidades = useQuery({
    queryKey: ['unidades-disponiveis', empId],
    enabled: !!empId,
    queryFn: async () => {
      const { data: linhas, error } = await supabase.from('unidades').select('id, identificador, status')
        .eq('empreendimento_id', empId).neq('status', 'vendida').order('identificador')
      if (error) throw traduzirErro(error)
      return linhas as { id: string; identificador: string; status: string }[]
    },
  })
  const disponiveis = emps.filter((e) => !['portfolio', 'futuro_lancamento'].includes(e.estagio))

  async function enviar(d: DadosProposta) {
    try {
      await propostasCriar({
        p_empreendimento_id: d.empreendimento_id, p_cliente_id: cliente?.id ?? null, p_unidade_id: d.unidade_id || null, p_texto: d.texto.trim(),
      })
    } catch (e) {
      if (e instanceof ErroRpc && e.codigo === 'DADOS_INVALIDOS') {
        for (const c of listaDoDetalhe(e, 'campos')) {
          if (c === 'empreendimento_id' || c === 'unidade_id' || c === 'texto') setError(c, { message: 'Valor inválido' })
        }
      }
      toast.error(mensagemErro(e))
      return
    }
    toast.success('Proposta enviada!')
    reset()
    if (!clienteFixo) setCliente(null)
    void qc.invalidateQueries({ queryKey: chavesCrm.propostasTodas })
    aoEnviar?.()
  }

  return (
    <form onSubmit={handleSubmit(enviar)} className="card grid content-start gap-4 p-6" noValidate>
      <h3 className="display text-3xl">Fazer proposta</h3>
      <Campo label="Empreendimento" obrigatorio erro={errors.empreendimento_id?.message}>
        <select className="input" {...register('empreendimento_id')}>
          <option value="" disabled>Selecione um empreendimento</option>
          {disponiveis.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </Campo>
      <Campo label="Unidade (opcional)" erro={errors.unidade_id?.message}>
        <select className="input" disabled={!empId} {...register('unidade_id')}>
          <option value="">—</option>
          {(unidades.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.identificador}</option>)}
        </select>
      </Campo>
      {!clienteFixo && (
        <div>
          <label htmlFor={idCliente} className="label">Cliente (opcional)</label>
          <SeletorCliente id={idCliente} valor={cliente} aoMudar={setCliente} />
        </div>
      )}
      <Campo label="Proposta" obrigatorio erro={errors.texto?.message}>
        <textarea rows={6} className="input" placeholder="Unidade, valor, forma de pagamento, entrada, FGTS…" {...register('texto')} />
      </Campo>
      <button type="submit" className="btn-primary justify-self-start" disabled={isSubmitting}>{isSubmitting ? 'Enviando…' : 'Enviar proposta'}</button>
    </form>
  )
}

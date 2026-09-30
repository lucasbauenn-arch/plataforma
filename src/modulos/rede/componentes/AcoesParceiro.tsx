import { useState, type ReactNode } from 'react'
import { Controller, useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Campo } from '@/components/Campo'
import { Modal } from '@/components/app/Modal'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import {
  crmListar, redeInativarParceiro, redeMudarImobiliariaCorretor, redeRegularizarLegado, redeTransferirClientes, redeTransferirCorretor,
} from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { ETAPAS } from '@/lib/constants'
import type { Uuid } from '@/lib/types'
import { chavesCrm } from '@/modulos/crm/api-clientes'
import { chavesRede } from '../api'
import {
  CARTEIRA_POR_PAGINA, destinoDeCarteira, destinoDeInativacao, emLotes, inativacaoPedeDestino, proximoOffsetCarteira, rotuloTodosCarteira,
} from '../regras'
import type { ParceiroDetalhe } from '../tipos'
import { SeletorOpcao } from './SeletorOpcao'

const motivo = z.string().trim().min(5, 'Mínimo de 5 caracteres').max(500, 'Máximo de 500 caracteres')

type Enviar = (fn: () => Promise<void>) => Promise<void>

/**
 * Janela de ação com formulário: rodapé padrão, envio pelo `id` do formulário e o estado "enviando" (bloqueia fechar).
 * O corpo só existe com a janela aberta, então cada abertura começa com o formulário limpo.
 */
function JanelaAcao({ aberto, titulo, formId, rotulo, perigo, aoFechar, children }: {
  aberto: boolean
  titulo: ReactNode
  formId: string
  rotulo: string
  perigo?: boolean
  aoFechar: () => void
  children: (enviar: Enviar) => ReactNode
}) {
  const [enviando, setEnviando] = useState(false)
  const enviar: Enviar = async (fn) => {
    setEnviando(true)
    try {
      await fn()
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Modal
      aberto={aberto} titulo={titulo} aoFechar={aoFechar} bloquearFechar={enviando} largura="lg"
      rodape={
        <>
          <button type="button" className="btn-ghost" onClick={aoFechar} disabled={enviando}>Cancelar</button>
          <button type="submit" form={formId} className={perigo ? 'btn-accent' : 'btn-primary'} disabled={enviando}>
            {enviando ? 'Aguarde…' : rotulo}
          </button>
        </>
      }
    >
      {children(enviar)}
    </Modal>
  )
}

function CampoMotivo({ erro, registro }: { erro?: string; registro: UseFormRegisterReturn }) {
  return (
    <Campo label="Motivo" obrigatorio erro={erro}>
      <textarea className="input" rows={3} maxLength={500} {...registro} />
    </Campo>
  )
}

function useInvalidar() {
  const qc = useQueryClient()
  return async () => {
    await qc.invalidateQueries({ queryKey: chavesRede.tudo })
    await qc.invalidateQueries({ queryKey: chavesCrm.listas })
  }
}

interface PropsAcao { aberto: boolean; parceiro: ParceiroDetalhe; aoFechar: () => void }
interface PropsCorpo { parceiro: ParceiroDetalhe; enviar: Enviar; aoFechar: () => void }

// ============ inativação (corretor, gerente ou usuário de imobiliária) ============

/**
 * Inativar com destino obrigatório quando há carteira ou equipe (nunca deixa cliente órfão): corretor → outro corretor
 * ativo da mesma imobiliária (no seu escopo) ou o gerente dele (A1); gerente → outro gerente da mesma imobiliária.
 */
export function ModalInativar({ aberto, parceiro, aoFechar }: PropsAcao) {
  return (
    <JanelaAcao aberto={aberto} titulo={`Inativar ${parceiro.nome}`} formId="form-inativar" rotulo="Inativar" perigo aoFechar={aoFechar}>
      {(enviar) => <CorpoInativar parceiro={parceiro} enviar={enviar} aoFechar={aoFechar} />}
    </JanelaAcao>
  )
}

function CorpoInativar({ parceiro, enviar, aoFechar }: PropsCorpo) {
  const invalidar = useInvalidar()
  const pedeDestino = inativacaoPedeDestino(parceiro)
  const esquema = z.object({ destino: z.string(), motivo }).superRefine((v, ctx) => {
    if (pedeDestino && !v.destino) ctx.addIssue({ code: 'custom', path: ['destino'], message: 'Escolha o destino' })
  })
  const { register, handleSubmit, control, formState: { errors } } = useForm<{ destino: string; motivo: string }>({
    resolver: zodResolver(esquema) as never, defaultValues: { destino: '', motivo: '' },
  })
  const salvar = (v: { destino: string; motivo: string }) => enviar(async () => {
    await redeInativarParceiro({ p_id: parceiro.id, p_destino_id: v.destino || null, p_motivo: v.motivo.trim() })
    toast.success('Parceiro inativado. O acesso foi encerrado.')
    await invalidar()
    aoFechar()
  })

  return (
    <form id="form-inativar" onSubmit={handleSubmit(salvar)} className="grid gap-4 text-sm" noValidate>
      <p className="text-stone/85">
        Inativar é desligar: o acesso é encerrado e o código de indicação deixa de valer. Nada é apagado.
        {parceiro.tipo === 'gerente' && ' Os corretores e os clientes diretos dele vão para o gerente escolhido.'}
        {parceiro.tipo === 'corretor' && ' A carteira de clientes vai para o destino escolhido.'}
      </p>
      {pedeDestino && (
        <>
          <Campo label={parceiro.tipo === 'gerente' ? 'Novo gerente da equipe' : 'Destino da carteira'} obrigatorio erro={errors.destino?.message}>
            <Controller control={control} name="destino" render={({ field }) => (
              <SeletorOpcao
                valor={field.value || null} aoMudar={(id) => field.onChange(id ?? '')} invalido={!!errors.destino}
                tipos={parceiro.tipo === 'gerente' ? ['gerente'] : ['corretor', 'gerente']} imobiliariaId={parceiro.imobiliaria.id}
                aceita={(o) => destinoDeInativacao(parceiro, o)}
              />
            )} />
          </Campo>
          <p className="text-xs text-muted">
            {parceiro.clientes_ativos > 0 && `${parceiro.clientes_ativos} cliente(s) ativo(s). `}
            {parceiro.corretores_ativos > 0 && `${parceiro.corretores_ativos} corretor(es) ativo(s). `}
            Clientes com contrato aguardando assinatura não mudam de dono: resolva o contrato antes.
          </p>
        </>
      )}
      <CampoMotivo erro={errors.motivo?.message} registro={register('motivo')} />
    </form>
  )
}

// ============ corretor para outro gerente (mesma imobiliária) ============

export function ModalTransferirCorretor({ aberto, parceiro, aoFechar }: PropsAcao) {
  return (
    <JanelaAcao aberto={aberto} titulo={`Trocar ${parceiro.nome} de gerente`} formId="form-transferir-corretor" rotulo="Transferir" aoFechar={aoFechar}>
      {(enviar) => <CorpoTransferirCorretor parceiro={parceiro} enviar={enviar} aoFechar={aoFechar} />}
    </JanelaAcao>
  )
}

function CorpoTransferirCorretor({ parceiro, enviar, aoFechar }: PropsCorpo) {
  const invalidar = useInvalidar()
  const esquema = z.object({ gerente: z.string().min(1, 'Escolha o novo gerente'), motivo })
  const { register, handleSubmit, control, formState: { errors } } = useForm<{ gerente: string; motivo: string }>({
    resolver: zodResolver(esquema) as never, defaultValues: { gerente: '', motivo: '' },
  })
  const salvar = (v: { gerente: string; motivo: string }) => enviar(async () => {
    await redeTransferirCorretor({ p_corretor_id: parceiro.id, p_novo_gerente_id: v.gerente, p_motivo: v.motivo.trim() })
    toast.success('Corretor transferido. Os clientes acompanham o novo gerente.')
    await invalidar()
    aoFechar()
  })

  return (
    <form id="form-transferir-corretor" onSubmit={handleSubmit(salvar)} className="grid gap-4 text-sm" noValidate>
      <p className="text-stone/85">O corretor passa para outro gerente da mesma imobiliária e leva os clientes dele.</p>
      <Campo label="Novo gerente" obrigatorio erro={errors.gerente?.message}>
        <Controller control={control} name="gerente" render={({ field }) => (
          <SeletorOpcao
            valor={field.value || null} aoMudar={(id) => field.onChange(id ?? '')} invalido={!!errors.gerente}
            tipos={['gerente']} imobiliariaId={parceiro.imobiliaria.id} aceita={(o) => o.id !== parceiro.gerente?.id}
          />
        )} />
      </Campo>
      <CampoMotivo erro={errors.motivo?.message} registro={register('motivo')} />
    </form>
  )
}

// ============ corretor para outra imobiliária (Super; PAR-6) ============

export function ModalMudarImobiliaria({ aberto, parceiro, aoFechar }: PropsAcao) {
  return (
    <JanelaAcao aberto={aberto} titulo={`Mudar ${parceiro.nome} de imobiliária`} formId="form-mudar-imob" rotulo="Mudar de imobiliária" aoFechar={aoFechar}>
      {(enviar) => <CorpoMudarImobiliaria parceiro={parceiro} enviar={enviar} aoFechar={aoFechar} />}
    </JanelaAcao>
  )
}

function CorpoMudarImobiliaria({ parceiro, enviar, aoFechar }: PropsCorpo) {
  const invalidar = useInvalidar()
  const temCarteira = parceiro.clientes_ativos > 0
  type V = { gerente: string; carteira: string; motivo: string }
  const esquema = z.object({ gerente: z.string().min(1, 'Escolha o gerente da nova imobiliária'), carteira: z.string(), motivo })
    .superRefine((v, ctx) => {
      if (temCarteira && !v.carteira) ctx.addIssue({ code: 'custom', path: ['carteira'], message: 'Escolha quem fica com a carteira' })
    })
  const { register, handleSubmit, control, formState: { errors } } = useForm<V>({
    resolver: zodResolver(esquema) as never, defaultValues: { gerente: '', carteira: '', motivo: '' },
  })
  const salvar = (v: V) => enviar(async () => {
    await redeMudarImobiliariaCorretor({
      p_corretor_id: parceiro.id, p_novo_gerente_id: v.gerente, p_destino_carteira_id: v.carteira || null, p_motivo: v.motivo.trim(),
    })
    toast.success('Corretor mudou de imobiliária. A carteira ficou na imobiliária de origem.')
    await invalidar()
    aoFechar()
  })

  return (
    <form id="form-mudar-imob" onSubmit={handleSubmit(salvar)} className="grid gap-4 text-sm" noValidate>
      <p className="text-stone/85">
        O corretor muda de imobiliária e <strong>não leva os clientes</strong> (PAR-6): a carteira fica com alguém da imobiliária de
        origem, na mesma operação.
      </p>
      <Campo label="Gerente na nova imobiliária" obrigatorio erro={errors.gerente?.message}>
        <Controller control={control} name="gerente" render={({ field }) => (
          <SeletorOpcao valor={field.value || null} aoMudar={(id) => field.onChange(id ?? '')} invalido={!!errors.gerente}
            tipos={['gerente']} aceita={(o) => o.imobiliaria_id !== parceiro.imobiliaria.id} />
        )} />
      </Campo>
      {temCarteira && (
        <Campo label={`Quem fica com a carteira (${parceiro.clientes_ativos} cliente(s))`} obrigatorio erro={errors.carteira?.message}>
          <Controller control={control} name="carteira" render={({ field }) => (
            <SeletorOpcao valor={field.value || null} aoMudar={(id) => field.onChange(id ?? '')} invalido={!!errors.carteira}
              tipos={['corretor', 'gerente']} imobiliariaId={parceiro.imobiliaria.id}
              aceita={(o) => destinoDeCarteira(o, parceiro.id, parceiro.imobiliaria.id)} />
          )} />
        </Campo>
      )}
      <CampoMotivo erro={errors.motivo?.message} registro={register('motivo')} />
    </form>
  )
}

// ============ regularização de legado (Super; N3) ============

export function ModalRegularizar({ aberto, parceiro, aoFechar }: PropsAcao) {
  return (
    <JanelaAcao aberto={aberto} titulo={`Regularizar ${parceiro.nome}`} formId="form-regularizar" rotulo="Regularizar" aoFechar={aoFechar}>
      {(enviar) => <CorpoRegularizar parceiro={parceiro} enviar={enviar} aoFechar={aoFechar} />}
    </JanelaAcao>
  )
}

function CorpoRegularizar({ parceiro, enviar, aoFechar }: PropsCorpo) {
  const invalidar = useInvalidar()
  type V = { gerente: string; levar: 'sim' | 'nao' | '' }
  const esquema = z.object({
    gerente: z.string().min(1, 'Escolha o gerente da imobiliária real'),
    levar: z.enum(['sim', 'nao'], { error: 'Escolha o que acontece com os clientes' }),
  })
  const { handleSubmit, control, register, formState: { errors } } = useForm<V>({
    resolver: zodResolver(esquema) as never, defaultValues: { gerente: '', levar: '' },
  })
  const salvar = (v: V) => enviar(async () => {
    await redeRegularizarLegado({ p_corretor_id: parceiro.id, p_novo_gerente_id: v.gerente, p_levar_clientes: v.levar === 'sim' })
    toast.success('Cadastro regularizado.')
    await invalidar()
    aoFechar()
  })

  return (
    <form id="form-regularizar" onSubmit={handleSubmit(salvar)} className="grid gap-4 text-sm" noValidate>
      <p className="flex flex-wrap items-center gap-2 text-stone/85">
        O corretor migrado sai da imobiliária da casa para uma imobiliária real, uma vez só. <SeloProvisorio codigo="N3" />
      </p>
      <Campo label="Gerente na imobiliária real" obrigatorio erro={errors.gerente?.message}>
        <Controller control={control} name="gerente" render={({ field }) => (
          <SeletorOpcao valor={field.value || null} aoMudar={(id) => field.onChange(id ?? '')} invalido={!!errors.gerente}
            tipos={['gerente']} aceita={(o) => !o.imobiliaria?.da_casa} />
        )} />
      </Campo>
      <fieldset className="grid gap-2">
        <legend className="label">Clientes ({parceiro.clientes_ativos}) <span className="text-bronze">*</span></legend>
        <label className="flex items-center gap-2"><input type="radio" value="sim" className="accent-bronze" {...register('levar')} /> Levar os clientes junto (exceção ao PAR-6)</label>
        <label className="flex items-center gap-2"><input type="radio" value="nao" className="accent-bronze" {...register('levar')} /> Deixar os clientes na carteira da casa</label>
        {errors.levar?.message && <span className="text-xs text-perigo">{errors.levar.message}</span>}
      </fieldset>
    </form>
  )
}

// ============ transferência de clientes do parceiro ============

/**
 * Transfere clientes da carteira do parceiro (lista do CRM, no escopo de quem usa). Destino: corretor ativo, ou
 * gerente pelo A1; entre imobiliárias, só o Super. Clientes com contrato aguardando assinatura ficam (cadeia congelada).
 * [WP1R-06] A carteira vem paginada (200 por vez, "Carregar mais") com o total do servidor à vista; "Todos" diz quantos
 * estão carregados, e a transferência vai em lotes de até 500 (limite da RPC).
 */
export function ModalTransferirClientes({ aberto, parceiro, entreImobiliarias, aoFechar }: PropsAcao & {
  /** Só o Super transfere para outra imobiliária. */
  entreImobiliarias: boolean
}) {
  return (
    <JanelaAcao aberto={aberto} titulo={`Transferir clientes de ${parceiro.nome}`} formId="form-transferir-clientes" rotulo="Transferir" aoFechar={aoFechar}>
      {(enviar) => <CorpoTransferirClientes parceiro={parceiro} entreImobiliarias={entreImobiliarias} enviar={enviar} aoFechar={aoFechar} />}
    </JanelaAcao>
  )
}

function CorpoTransferirClientes({ parceiro, entreImobiliarias, enviar, aoFechar }: PropsCorpo & { entreImobiliarias: boolean }) {
  const invalidar = useInvalidar()
  const [selecionados, setSelecionados] = useState<Set<Uuid>>(new Set())
  const clientes = useInfiniteQuery({
    queryKey: ['rede', 'carteira', parceiro.id],
    queryFn: ({ pageParam }) => crmListar({ p_filtros: { corretor_id: parceiro.id, ordem: 'nome' }, p_limite: CARTEIRA_POR_PAGINA, p_offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (_ultima, paginas) => proximoOffsetCarteira(paginas),
  })
  const esquema = z.object({ destino: z.string().min(1, 'Escolha o novo responsável'), motivo })
  const { register, handleSubmit, control, formState: { errors } } = useForm<{ destino: string; motivo: string }>({
    resolver: zodResolver(esquema) as never, defaultValues: { destino: '', motivo: '' },
  })
  const paginas = clientes.data?.pages ?? []
  const itens = paginas.flatMap((p) => p.itens)
  const total = paginas.length ? Math.max(paginas[paginas.length - 1].total, itens.length) : 0
  const faltam = total - itens.length
  const todos = itens.length > 0 && itens.every((c) => selecionados.has(c.id))
  const imob = entreImobiliarias ? null : parceiro.imobiliaria.id

  const salvar = (v: { destino: string; motivo: string }) => enviar(async () => {
    if (selecionados.size === 0) {
      toast.error('Selecione ao menos um cliente.')
      return
    }
    // lotes de até 500 (limite da RPC); cada lote é uma transação: se um falhar, os anteriores já foram
    let n = 0
    for (const lote of emLotes([...selecionados])) {
      try {
        n += await redeTransferirClientes({ p_cliente_ids: lote, p_novo_corretor_id: v.destino, p_motivo: v.motivo.trim() })
      } catch (e) {
        if (n === 0) throw e
        await invalidar()
        throw new Error(`${n} cliente(s) transferido(s) antes do erro; os demais não foram: ${mensagemErro(e)}`)
      }
    }
    const ficaram = selecionados.size - n
    if (ficaram > 0) toast.warning(`${n} transferido(s); ${ficaram} ficou(aram): contrato aguardando assinatura ou já era do destino.`)
    else toast.success(`${n} cliente(s) transferido(s).`)
    await invalidar()
    aoFechar()
  })

  function alternar(id: Uuid) {
    const s = new Set(selecionados)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelecionados(s)
  }

  return (
    <form id="form-transferir-clientes" onSubmit={handleSubmit(salvar)} className="grid gap-4 text-sm" noValidate>
      <div className="max-h-64 overflow-y-auto border border-line">
        {clientes.isPending ? <p className="p-4 text-muted">Carregando clientes…</p>
          : clientes.error ? <p className="p-4 text-perigo">{mensagemErro(clientes.error)}</p>
          : itens.length === 0 ? <p className="p-4 text-muted">Nenhum cliente ativo na carteira.</p>
          : (
            <ul aria-label="Clientes da carteira">
              <li className="border-b border-line bg-sand/50 px-4 py-2">
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  <input type="checkbox" className="accent-bronze" checked={todos}
                    onChange={() => setSelecionados(todos ? new Set() : new Set(itens.map((c) => c.id)))} />
                  {rotuloTodosCarteira(itens.length, total)}
                </label>
              </li>
              {itens.map((c) => (
                <li key={c.id} className="border-b border-line px-4 py-2 last:border-b-0">
                  <label className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" className="accent-bronze" checked={selecionados.has(c.id)} onChange={() => alternar(c.id)} />
                      {[c.nome, c.sobrenome].filter(Boolean).join(' ')}
                    </span>
                    <span className="text-xs text-muted">{ETAPAS[c.etapa].rotulo}</span>
                  </label>
                </li>
              ))}
              {clientes.hasNextPage && (
                <li className="px-4 py-2">
                  <button type="button" className="btn-ghost px-3 py-2 text-xs" disabled={clientes.isFetchingNextPage} onClick={() => clientes.fetchNextPage()}>
                    {clientes.isFetchingNextPage ? 'Carregando…' : `Carregar mais (${faltam} restante(s))`}
                  </button>
                </li>
              )}
            </ul>
          )}
      </div>
      {faltam > 0 && (
        <p className="text-xs text-muted" role="status">
          Mostrando {itens.length} de {total} clientes: “Todos” marca só os carregados. Para mover a carteira inteira de uma vez, use a inativação,
          que leva todos os clientes.
        </p>
      )}
      {selecionados.size > 0 && <p className="text-xs text-muted">{selecionados.size} selecionado(s).</p>}
      <Campo label="Novo responsável" obrigatorio erro={errors.destino?.message}>
        <Controller control={control} name="destino" render={({ field }) => (
          <SeletorOpcao valor={field.value || null} aoMudar={(id) => field.onChange(id ?? '')} invalido={!!errors.destino}
            tipos={['corretor', 'gerente']} imobiliariaId={imob} aceita={(o) => destinoDeCarteira(o, parceiro.id, imob)} />
        )} />
      </Campo>
      <CampoMotivo erro={errors.motivo?.message} registro={register('motivo')} />
    </form>
  )
}

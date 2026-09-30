import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { AlertTriangle, ShieldOff, UserX } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { crmFicha, lgpdRevogarConsentimento } from '@/lib/rpc'
import { dataHora, mascaraDocumento } from '@/lib/format'
import { ETAPAS } from '@/lib/constants'
import { ErroConsulta } from '@/components/app/Consulta'
import { SeletorCliente } from '@/components/app/SeletorCliente'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Etiqueta } from '@/components/app/Etiqueta'
import { Campo } from '@/components/Campo'
import { Carregando } from '@/components/Estados'
import type { ClienteOpcao, ConsentimentoCliente, CrmFicha } from '@/modulos/crm/tipos'
import {
  EDGE_ANONIMIZAR, esquemaAnonimizacao, type FormAnonimizacao, idCliente, lerResultado, PALAVRA_CONFIRMACAO,
} from '@/modulos/governanca/lgpd'

const ORIGENS: Record<string, string> = {
  pre_cadastro_link: 'pré-cadastro pelo link', declarado: 'declarado pelo parceiro ou pela equipe', cadastro_parceiro: 'cadastro de parceiro',
  portal: 'aceite no portal', migracao: 'migração',
}

/**
 * Direitos do titular (LGPD, §5.4 e §5.5), só o Super: localizar o cliente, revogar consentimentos e anonimizar. A
 * anonimização é irreversível e passa pela Edge lgpd-anonimizar, que chama a RPC com o JWT do Super (com a 2FA quando
 * exigida), apaga os arquivos pela API do Storage e remove o acesso ao portal. Valores e datas de contratos, vínculos
 * e eventos continuam (obrigação legal ⚑).
 */
export default function Anonimizacao() {
  const [escolhido, setEscolhido] = useState<ClienteOpcao | null>(null)
  const [idDigitado, setIdDigitado] = useState('')
  const [id, setId] = useState<string | null>(null)
  const [erroId, setErroId] = useState<string | null>(null)

  function usarId(ev: React.FormEvent) {
    ev.preventDefault()
    const r = idCliente.safeParse(idDigitado)
    if (!r.success) return setErroId(r.error.issues[0]?.message ?? 'ID de cliente inválido')
    setErroId(null)
    setEscolhido(null)
    setId(r.data)
  }

  return (
    <div className="grid gap-8">
      <section className="card grid gap-4 p-6" aria-labelledby="lgpd-busca">
        <h3 id="lgpd-busca" className="font-semibold">Localizar o titular</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <Campo label="Buscar cliente ativo pelo nome">
            <SeletorCliente valor={escolhido} aoMudar={(c) => { setEscolhido(c); setId(c?.id ?? null) }} />
          </Campo>
          <form onSubmit={usarId} className="grid gap-2" noValidate>
            <Campo label="ou informe o ID do cliente (também inativos)" erro={erroId ?? undefined}>
              <div className="flex gap-2">
                <input className="input" value={idDigitado} onChange={(e) => setIdDigitado(e.target.value)} placeholder="uuid do cliente" />
                <button className="btn-ghost px-4">Abrir</button>
              </div>
            </Campo>
          </form>
        </div>
      </section>

      {id && <Titular key={id} id={id} />}
    </div>
  )
}

function Titular({ id }: { id: string }) {
  const qc = useQueryClient()
  const chave = ['lgpd', 'titular', id]
  const q = useQuery({ queryKey: chave, queryFn: () => crmFicha({ p_id: id }), staleTime: Infinity, refetchOnWindowFocus: false })
  const [revogar, setRevogar] = useState<ConsentimentoCliente | null>(null)
  const [pedido, setPedido] = useState<FormAnonimizacao | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormAnonimizacao>({
    resolver: zodResolver(esquemaAnonimizacao), defaultValues: { protocolo: '', confirmacao: '' },
  })

  async function confirmarRevogacao(motivo: string | null) {
    if (!revogar) return
    await lgpdRevogarConsentimento({ p_id: revogar.id, p_motivo: motivo ?? '' })
    toast.success('Consentimento revogado. O cliente deixa de receber e-mails.')
    await qc.invalidateQueries({ queryKey: chave })
  }

  async function anonimizar() {
    if (!pedido) return
    const { data, error } = await supabase.functions.invoke(EDGE_ANONIMIZAR, { body: { cliente_id: id, protocolo: pedido.protocolo.trim() } })
    let resultado
    if (error) {
      const ctx = (error as { context?: { status?: number; json?: () => Promise<unknown> } }).context
      const corpo = ctx?.json ? await ctx.json().catch(() => null) : null
      resultado = lerResultado(ctx?.status ?? 0, corpo)
    } else {
      resultado = lerResultado(200, data)
    }
    if (resultado.situacao === 'erro') throw new Error(resultado.mensagem)
    await qc.invalidateQueries({ queryKey: chave })
    reset({ protocolo: '', confirmacao: '' })
    if (resultado.situacao === 'incompleta') {
      setAviso(resultado.mensagem)
      toast.warning('Anonimizado, mas a remoção não terminou. Repita o pedido com o mesmo protocolo.')
    } else {
      setAviso(null)
      toast.success(`Titular anonimizado. ${resultado.arquivos} arquivo(s) apagado(s)${resultado.usuarioRemovido ? ' e acesso ao portal removido' : ''}.`)
    }
  }

  if (q.isPending) return <Carregando />
  if (q.error) return <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} />
  const f: CrmFicha | null = q.data ?? null
  if (!f) return <ErroConsulta erro={{ code: '42501', message: 'Sem acesso a este registro' }} />
  const c = f.cliente
  const anonimizado = !!c.anonimizado_em

  return (
    <>
      <section className="card p-6" aria-labelledby="lgpd-titular">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="lgpd-titular" className="text-lg font-semibold">{[c.nome, c.sobrenome].filter(Boolean).join(' ')}</h3>
            <p className="text-sm text-muted">{mascaraDocumento(c.cpf ?? c.cnpj) || 'Sem documento'} · {ETAPAS[c.etapa].rotulo} · cadastrado em {dataHora(c.criado_em)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {anonimizado && <Etiqueta tom="destaque">Anonimizado em {dataHora(c.anonimizado_em)}</Etiqueta>}
            {!anonimizado && c.inativado_em && <Etiqueta tom="neutro">Inativo</Etiqueta>}
            {c.portal_liberado && <Etiqueta tom="alerta">Portal liberado</Etiqueta>}
          </div>
        </div>

        <h4 className="mt-6 mb-2 text-sm font-semibold">Consentimentos</h4>
        {f.consentimentos.length === 0 ? <p className="text-sm text-muted">Nenhum consentimento registrado.</p> : (
          <ul className="divide-y divide-line text-sm">
            {f.consentimentos.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  {k.termo_versao ? `Versão ${k.termo_versao}` : 'Sem termo'} · {ORIGENS[k.origem] ?? k.origem} · {dataHora(k.aceito_em)}
                  {k.registrado_por && <span className="block text-xs text-muted">Declarado por {k.registrado_por.nome}</span>}
                  {k.revogado_em && <span className="block text-xs text-muted">Revogado em {dataHora(k.revogado_em)}{k.motivo_revogacao ? `: ${k.motivo_revogacao}` : ''}</span>}
                </span>
                {k.revogado_em ? <Etiqueta tom="neutro">Revogado</Etiqueta> : (
                  <button type="button" className="inline-flex items-center gap-1 font-semibold text-bronze" onClick={() => setRevogar(k)}>
                    <ShieldOff size={15} aria-hidden /> Revogar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card border-perigo/40 p-6" aria-labelledby="lgpd-anonimizar">
        <h3 id="lgpd-anonimizar" className="flex items-center gap-2 text-lg font-semibold"><UserX size={18} className="text-perigo" aria-hidden /> Anonimizar a pedido do titular</h3>
        <ul className="mt-3 grid gap-1 text-sm text-stone/85">
          <li>• Nome vira "Titular anonimizado"; documentos, contatos, endereço e textos livres são apagados.</li>
          <li>• Arquivos de documentos e o acesso ao portal são removidos.</li>
          <li>• Contratos (valores e datas), histórico de vínculos, linha do tempo e auditoria ficam, sem dado pessoal.</li>
          <li className="flex items-start gap-1.5 text-bronze"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> Não tem volta.</li>
        </ul>
        {aviso && <p role="status" className="mt-4 border border-bronze/40 p-3 text-sm text-bronze">{aviso}</p>}
        <form onSubmit={handleSubmit((v) => setPedido(v))} className="mt-5 grid gap-4 sm:grid-cols-2" noValidate>
          <Campo label="Protocolo do pedido" obrigatorio erro={errors.protocolo?.message}>
            <input className="input" placeholder="ex.: LGPD-2026-001" {...register('protocolo')} />
          </Campo>
          <Campo label={`Digite ${PALAVRA_CONFIRMACAO} para confirmar`} obrigatorio erro={errors.confirmacao?.message}>
            <input className="input" autoComplete="off" {...register('confirmacao')} />
          </Campo>
          <button className="btn-accent justify-self-start sm:col-span-2">{anonimizado ? 'Repetir a remoção de arquivos e acesso' : 'Anonimizar'}</button>
        </form>
      </section>

      <ConfirmarModal
        aberto={!!revogar} titulo="Revogar consentimento?" rotuloConfirmar="Revogar"
        texto="O cliente continua cadastrado, mas deixa de receber e-mails. A revogação fica registrada e não pode ser desfeita."
        motivo={{ rotulo: 'Motivo (ex.: pedido do titular por e-mail em 28/09)', minimo: 5 }}
        aoConfirmar={confirmarRevogacao} aoFechar={() => setRevogar(null)}
      />
      <ConfirmarModal
        aberto={!!pedido} titulo="Anonimizar este titular?" rotuloConfirmar="Anonimizar" perigo
        texto={<>Protocolo <strong>{pedido?.protocolo}</strong>. Esta ação é irreversível e fica registrada na auditoria.</>}
        aoConfirmar={anonimizar} aoFechar={() => setPedido(null)}
      />
    </>
  )
}

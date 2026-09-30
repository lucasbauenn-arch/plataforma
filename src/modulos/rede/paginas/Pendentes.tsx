import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'
import { redeAprovarAutocadastro, redeRecusarAutocadastro } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { cpfValido, dataHora, mascaraCpf, mascaraTelefone, soDigitos } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Consulta } from '@/components/app/Consulta'
import { Modal } from '@/components/app/Modal'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { Tabela } from '@/components/app/Tabela'
import { chavesRede, listarPendentes, type Pendente } from '../api'
import { SeletorOpcao } from '../componentes/SeletorOpcao'

const esquema = z.object({
  gerente: z.string(),
  nome: z.string().trim().min(2, 'Informe o nome').max(200, 'Máximo de 200 caracteres'),
  cpf: z.string().refine((v) => !soDigitos(v) || cpfValido(v), 'CPF inválido'),
  creci: z.string().trim().min(1, 'Informe o CRECI').max(60, 'Máximo de 60 caracteres'),
  telefone: z.string().refine((v) => !soDigitos(v) || [10, 11].includes(soDigitos(v).length), 'Informe o DDD e o número'),
})
type Valores = z.infer<typeof esquema>

function ModalAprovar({ pendente, aoFechar }: { pendente: Pendente | null; aoFechar: () => void }) {
  const [enviando, setEnviando] = useState(false)
  return (
    <Modal
      aberto={!!pendente} titulo={`Aprovar ${pendente?.nome || pendente?.email || ''}`} aoFechar={aoFechar} bloquearFechar={enviando} largura="lg"
      rodape={
        <>
          <button type="button" className="btn-ghost" onClick={aoFechar} disabled={enviando}>Cancelar</button>
          <button type="submit" form="form-aprovar" className="btn-primary" disabled={enviando}>{enviando ? 'Aprovando…' : 'Aprovar'}</button>
        </>
      }
    >
      {pendente && <CorpoAprovar key={pendente.id} pendente={pendente} aoEnviando={setEnviando} aoFechar={aoFechar} />}
    </Modal>
  )
}

function CorpoAprovar({ pendente, aoEnviando, aoFechar }: { pendente: Pendente; aoEnviando: (b: boolean) => void; aoFechar: () => void }) {
  const qc = useQueryClient()
  const { register, handleSubmit, control, formState: { errors } } = useForm<Valores>({
    resolver: zodResolver(esquema),
    defaultValues: {
      gerente: '', nome: pendente.nome ?? '', cpf: '', creci: pendente.creci ?? '',
      telefone: pendente.telefone ? mascaraTelefone(pendente.telefone) : '',
    },
  })

  async function aprovar(v: Valores) {
    aoEnviando(true)
    try {
      await redeAprovarAutocadastro({
        p_profile_id: pendente.id,
        p_gerente_id: v.gerente || null,
        // CPF vazio = o declarado no autocadastro (o servidor valida e depois tira dos metadados)
        p_dados: { cpf: soDigitos(v.cpf), creci: v.creci.trim(), nome: v.nome.trim(), telefone: soDigitos(v.telefone) || null },
      })
      toast.success(`${v.nome.trim()} aprovado como corretor.`)
      await qc.invalidateQueries({ queryKey: chavesRede.tudo })
      aoFechar()
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      aoEnviando(false)
    }
  }

  return (
    <form id="form-aprovar" onSubmit={handleSubmit(aprovar)} className="grid gap-4 text-sm sm:grid-cols-2" noValidate>
      <p className="text-stone/85 sm:col-span-2">
        O autocadastro vira corretor na cadeia escolhida. Sem gerente escolhido, entra na imobiliária da casa (Gerência Arken). <SeloProvisorio codigo="A4" />
      </p>
      <div className="sm:col-span-2">
        <Campo label="Gerente (cadeia)" erro={errors.gerente?.message}>
          <Controller control={control} name="gerente" render={({ field }) => (
            <SeletorOpcao valor={field.value || null} aoMudar={(id) => field.onChange(id ?? '')} tipos={['gerente']}
              vazio="Gerência Arken (casa) — padrão" aceita={(o) => !o.virtual} />
          )} />
        </Campo>
      </div>
      <Campo label="Nome" obrigatorio erro={errors.nome?.message}><input className="input" {...register('nome')} /></Campo>
      <Campo label="CPF" erro={errors.cpf?.message}>
        <Controller control={control} name="cpf" render={({ field }) => (
          <input className="input" inputMode="numeric" placeholder="Em branco: o CPF informado no cadastro" value={field.value}
            onBlur={field.onBlur} onChange={(e) => field.onChange(mascaraCpf(e.target.value))} />
        )} />
      </Campo>
      <Campo label="CRECI" obrigatorio erro={errors.creci?.message}><input className="input" {...register('creci')} /></Campo>
      <Campo label="Telefone" erro={errors.telefone?.message}>
        <Controller control={control} name="telefone" render={({ field }) => (
          <input className="input" inputMode="tel" value={field.value} onBlur={field.onBlur} onChange={(e) => field.onChange(mascaraTelefone(e.target.value))} />
        )} />
      </Campo>
      <p className="text-xs text-muted sm:col-span-2">
        O CPF declarado no cadastro é conferido (dígitos e unicidade) na aprovação e não fica visível aqui. Confira o CRECI no conselho antes de aprovar.
      </p>
    </form>
  )
}

/**
 * [WP1] Admin › Autocadastros (N8, N18): quem se cadastrou em /parceiros/cadastro espera a aprovação interna.
 * Aprovar = rede_aprovar_autocadastro (corretor na cadeia escolhida; padrão: a casa); recusar = acesso bloqueado, com
 * motivo no histórico. Lê só os perfis (sem CPF).
 */
export default function Pendentes() {
  const qc = useQueryClient()
  const consulta = useQuery({ queryKey: chavesRede.pendentes, queryFn: listarPendentes })
  const [aprovar, setAprovar] = useState<Pendente | null>(null)
  const [recusar, setRecusar] = useState<Pendente | null>(null)

  return (
    <section>
      <CabecalhoPagina
        voltar={{ para: '/admin/rede', rotulo: 'Rede' }}
        titulo="Autocadastros"
        subtitulo="Corretores que se cadastraram pelo site e aguardam a aprovação da equipe Arken."
        acoes={<SeloProvisorio codigo="N18" />}
      />
      <Consulta consulta={consulta} tituloVazio="Nenhum autocadastro pendente" textoVazio="Quando alguém se cadastrar pelo site, aparece aqui.">
        {(lista) => (
          <Tabela legenda="Autocadastros pendentes" colunas={['Nome', 'E-mail', 'Telefone', 'CRECI', 'Imobiliária informada', 'Cadastro', '']}>
            {lista.map((p) => (
              <tr key={p.id}>
                <td className="font-semibold">{p.nome || '—'}</td>
                <td>{p.email ?? '—'}</td>
                <td className="whitespace-nowrap">{p.telefone ? mascaraTelefone(p.telefone) : '—'}</td>
                <td>{p.creci ?? '—'}</td>
                <td>{p.imobiliaria ?? '—'}</td>
                <td className="whitespace-nowrap text-muted">{dataHora(p.created_at)}</td>
                <td className="whitespace-nowrap text-right">
                  <span className="inline-flex gap-2">
                    <button type="button" className="btn-primary px-3 py-2 text-xs" onClick={() => setAprovar(p)}><Check size={14} aria-hidden /> Aprovar</button>
                    <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => setRecusar(p)}><X size={14} aria-hidden /> Recusar</button>
                  </span>
                </td>
              </tr>
            ))}
          </Tabela>
        )}
      </Consulta>

      <ModalAprovar pendente={aprovar} aoFechar={() => setAprovar(null)} />
      <ConfirmarModal
        aberto={!!recusar} aoFechar={() => setRecusar(null)} perigo rotuloConfirmar="Recusar"
        titulo={`Recusar ${recusar?.nome || recusar?.email || ''}`}
        texto="O acesso fica bloqueado. O motivo fica registrado no histórico do acesso (não vai para a pessoa)."
        motivo={{ rotulo: 'Motivo', minimo: 5 }}
        aoConfirmar={async (m) => {
          await redeRecusarAutocadastro({ p_profile_id: recusar!.id, p_motivo: m ?? '' })
          toast.success('Autocadastro recusado.')
          await qc.invalidateQueries({ queryKey: chavesRede.tudo })
        }}
      />
    </section>
  )
}

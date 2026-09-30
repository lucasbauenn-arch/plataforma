import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Campo } from '@/components/Campo'
import { Modal } from '@/components/app/Modal'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { redeEditarParceiro } from '@/lib/rpc'
import { listaDoDetalhe, mensagemErro, traduzirErro } from '@/lib/erros'
import { mascaraCpf, mascaraTelefone } from '@/lib/format'
import { TIPOS_PARCEIRO } from '@/lib/constants'
import type { TipoParceiro, Uuid } from '@/lib/types'
import { atualizarMeuCadastro, cadastrarParceiro, chavesRede, listarImobiliarias } from '../api'
import { dadosEdicaoParceiro, dadosNovoParceiro, problemasParceiro, type ValoresParceiro } from '../regras'
import type { ParceiroDetalhe } from '../tipos'
import { SeletorOpcao } from './SeletorOpcao'

export type ModoFormParceiro =
  | { tipo: 'novo'; tipos: TipoParceiro[]; imobiliariaId?: Uuid | null; gerenteId?: Uuid | null; gerenteFixo?: boolean; interno: boolean }
  /** `interno`: só internos completam o CPF vazio de outro parceiro (rede_editar_parceiro, WP1R-04). */
  | { tipo: 'editar'; atual: ParceiroDetalhe; interno: boolean }
  | { tipo: 'meu'; atual: ParceiroDetalhe }

interface Valores extends ValoresParceiro {
  tipo: TipoParceiro
  imobiliaria_id: string
  gerente_id: string
}

const CAMPOS_FORM = new Set(['nome', 'cpf', 'creci', 'email', 'telefone'])
const ID_FORM = 'form-parceiro'

/**
 * Cadastro e edição de parceiro (gerente, corretor ou usuário de imobiliária). PAR-4 no formulário e no servidor:
 * CPF para gerente e corretor, CRECI para corretor. Na edição, o CPF só é aceito se estiver vazio e o e-mail não muda
 * depois do login. "meu" = a tela Meu cadastro (rede_atualizar_meu_cadastro). O formulário nasce de novo a cada
 * abertura (o corpo do Modal só existe aberto).
 */
export function FormParceiro({ aberto, modo, aoFechar, aoSalvar }: {
  aberto: boolean
  modo: ModoFormParceiro
  aoFechar: () => void
  aoSalvar?: (id: Uuid | null) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const titulo = modo.tipo === 'novo' ? 'Novo parceiro' : modo.tipo === 'meu' ? 'Atualizar meu cadastro' : `Editar ${TIPOS_PARCEIRO[modo.atual.tipo].toLowerCase()}`
  return (
    <Modal
      aberto={aberto} titulo={titulo} aoFechar={aoFechar} bloquearFechar={enviando} largura="lg"
      rodape={
        <>
          <button type="button" className="btn-ghost" onClick={aoFechar} disabled={enviando}>Cancelar</button>
          <button type="submit" form={ID_FORM} className="btn-primary" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <CorpoFormParceiro modo={modo} aoEnviando={setEnviando} aoFechar={aoFechar} aoSalvar={aoSalvar} />
    </Modal>
  )
}

function CorpoFormParceiro({ modo, aoEnviando, aoFechar, aoSalvar }: {
  modo: ModoFormParceiro
  aoEnviando: (b: boolean) => void
  aoFechar: () => void
  aoSalvar?: (id: Uuid | null) => void
}) {
  const qc = useQueryClient()
  const atual = modo.tipo === 'novo' ? null : modo.atual
  const legado = !!atual?.migrado_legado

  const esquema = z.object({
    tipo: z.enum(['imobiliaria', 'gerente', 'corretor']),
    imobiliaria_id: z.string(),
    gerente_id: z.string(),
    nome: z.string().max(200, 'Máximo de 200 caracteres'),
    cpf: z.string(),
    creci: z.string(),
    email: z.string().max(200, 'Máximo de 200 caracteres'),
    telefone: z.string(),
  }).superRefine((v, ctx) => {
    for (const [campo, mensagem] of Object.entries(problemasParceiro(v.tipo, v))) {
      // legado migrado: CPF e CRECI ainda podem ficar vazios (PAR-4 vale para cadastros novos, §2.4)
      if (legado && (campo === 'cpf' || campo === 'creci') && !(v[campo] ?? '').trim()) continue
      if (atual?.cpf && campo === 'cpf') continue
      ctx.addIssue({ code: 'custom', path: [campo], message: mensagem })
    }
    if (modo.tipo === 'novo') {
      if (v.tipo === 'corretor' && !v.gerente_id && !modo.gerenteFixo) ctx.addIssue({ code: 'custom', path: ['gerente_id'], message: 'Escolha o gerente.' })
      if (v.tipo !== 'corretor' && modo.interno && !v.imobiliaria_id && !modo.imobiliariaId) {
        ctx.addIssue({ code: 'custom', path: ['imobiliaria_id'], message: 'Escolha a imobiliária.' })
      }
    }
  })

  const { register, handleSubmit, control, setError, formState: { errors } } = useForm<Valores>({
    resolver: zodResolver(esquema) as never,
    defaultValues: {
      tipo: modo.tipo === 'novo' ? modo.tipos[0] ?? 'corretor' : modo.atual.tipo,
      imobiliaria_id: modo.tipo === 'novo' ? modo.imobiliariaId ?? '' : '',
      gerente_id: modo.tipo === 'novo' ? modo.gerenteId ?? '' : '',
      nome: atual?.nome ?? '',
      cpf: atual?.cpf ? mascaraCpf(atual.cpf) : '',
      creci: atual?.creci ?? '',
      email: atual?.email ?? '',
      telefone: atual?.telefone ? mascaraTelefone(atual.telefone) : '',
    },
  })
  const tipo = useWatch({ control, name: 'tipo' })
  const interno = modo.tipo === 'novo' && modo.interno
  const escolheImob = modo.tipo === 'novo' && tipo !== 'corretor' && interno && !modo.imobiliariaId
  const imobs = useQuery({
    queryKey: chavesRede.imobiliarias({ busca: '', situacao: 'ativos' }),
    queryFn: () => listarImobiliarias({ busca: '', situacao: 'ativos' }),
    enabled: escolheImob,
  })

  async function salvar(v: Valores) {
    aoEnviando(true)
    try {
      let id: Uuid | null = null
      if (modo.tipo === 'novo') {
        id = await cadastrarParceiro({
          p_tipo: v.tipo,
          p_dados: dadosNovoParceiro(v),
          p_imobiliaria_id: v.tipo === 'corretor' ? (modo.imobiliariaId ?? null) : (v.imobiliaria_id || modo.imobiliariaId || null),
          p_gerente_id: v.tipo === 'corretor' ? (v.gerente_id || modo.gerenteId || null) : null,
        })
        toast.success(`${TIPOS_PARCEIRO[v.tipo]} cadastrado. Agora envie o convite para o acesso.`)
      } else {
        const dados = dadosEdicaoParceiro(modo.atual, v)
        if (Object.keys(dados).length === 0) {
          toast.info('Nada mudou.')
          aoFechar()
          return
        }
        if (modo.tipo === 'editar') await redeEditarParceiro({ p_id: modo.atual.id, p_dados: dados })
        else {
          // com CPF, relê e confere se ele ficou gravado (CPF de outro parceiro: nada muda, DOCUMENTO_INDISPONIVEL)
          const relido = await atualizarMeuCadastro(modo.atual.id, dados)
          if (relido) qc.setQueryData(chavesRede.detalhe(modo.atual.id), relido)
        }
        id = modo.atual.id
        toast.success('Cadastro atualizado.')
      }
      await qc.invalidateQueries({ queryKey: chavesRede.tudo })
      aoSalvar?.(id)
      aoFechar()
    } catch (e) {
      const erro = traduzirErro(e)
      for (const c of listaDoDetalhe(erro, 'campos').filter((x) => CAMPOS_FORM.has(x))) {
        setError(c as keyof Valores, { message: 'Obrigatório' })
      }
      if (erro.codigo === 'DOCUMENTO_INDISPONIVEL') setError('cpf', { message: 'CPF indisponível para cadastro.' })
      toast.error(mensagemErro(erro))
    } finally {
      aoEnviando(false)
    }
  }

  // CPF: não muda depois de gravado; o de outro parceiro, vazio, só um interno completa
  const cpfTravado = !!atual?.cpf || (modo.tipo === 'editar' && !modo.interno)
  const emailTravado = !!atual && (atual.tem_login || modo.tipo === 'meu')

  return (
    <form id={ID_FORM} onSubmit={handleSubmit(salvar)} className="grid gap-4 sm:grid-cols-2" noValidate>
      {modo.tipo === 'novo' && modo.tipos.length > 1 && (
        <Campo label="Tipo" obrigatorio erro={errors.tipo?.message}>
          <select className="input" {...register('tipo')}>
            {modo.tipos.map((t) => <option key={t} value={t}>{TIPOS_PARCEIRO[t]}</option>)}
          </select>
        </Campo>
      )}
      {escolheImob && (
        <Campo label="Imobiliária" obrigatorio erro={errors.imobiliaria_id?.message}>
          <select className="input" {...register('imobiliaria_id')} disabled={imobs.isPending}>
            <option value="">{imobs.isPending ? 'Carregando…' : 'Selecione…'}</option>
            {(imobs.data ?? []).filter((i) => tipo !== 'imobiliaria' || !i.da_casa).map((i) => (
              <option key={i.id} value={i.id}>{i.da_casa ? `${i.nome} (casa)` : i.nome}</option>
            ))}
          </select>
        </Campo>
      )}
      {modo.tipo === 'novo' && tipo === 'corretor' && !modo.gerenteFixo && (
        <Campo label="Gerente" obrigatorio erro={errors.gerente_id?.message}>
          <Controller control={control} name="gerente_id" render={({ field }) => (
            <SeletorOpcao
              valor={field.value || null} aoMudar={(id) => field.onChange(id ?? '')} tipos={['gerente']}
              imobiliariaId={modo.imobiliariaId ?? null} invalido={!!errors.gerente_id}
            />
          )} />
        </Campo>
      )}
      <div className="sm:col-span-2">
        <Campo label="Nome completo" obrigatorio erro={errors.nome?.message}>
          <input className="input" autoComplete="off" {...register('nome')} />
        </Campo>
      </div>
      <Campo label="CPF" obrigatorio={tipo !== 'imobiliaria' && !legado} erro={errors.cpf?.message}>
        <Controller control={control} name="cpf" render={({ field }) => (
          <input
            className="input" inputMode="numeric" placeholder="000.000.000-00" disabled={cpfTravado}
            value={field.value} onChange={(e) => field.onChange(mascaraCpf(e.target.value))} onBlur={field.onBlur}
          />
        )} />
      </Campo>
      <Campo label={tipo === 'corretor' ? 'CRECI (PF)' : 'CRECI'} obrigatorio={tipo === 'corretor' && !legado} erro={errors.creci?.message}>
        <input className="input" autoComplete="off" {...register('creci')} />
      </Campo>
      <Campo label="E-mail (login)" erro={errors.email?.message}>
        <input className="input" type="email" autoComplete="off" disabled={emailTravado} {...register('email')} />
      </Campo>
      <Campo label="Telefone / WhatsApp" erro={errors.telefone?.message}>
        <Controller control={control} name="telefone" render={({ field }) => (
          <input
            className="input" inputMode="tel" value={field.value} onBlur={field.onBlur}
            onChange={(e) => field.onChange(mascaraTelefone(e.target.value))}
          />
        )} />
      </Campo>
      <div className="text-xs text-muted sm:col-span-2">
        {cpfTravado && (atual?.cpf
          ? <p>O CPF já cadastrado não muda por aqui (fale com a equipe Arken).</p>
          : <p>O CPF de outro parceiro é completado pela equipe Arken.</p>)}
        {emailTravado && <p>O e-mail é o do login e não muda por aqui.</p>}
        {modo.tipo === 'novo' && <p>O acesso é criado pelo convite (e-mail com link para definir a senha, válido por 24 h).</p>}
        {modo.tipo === 'novo' && tipo === 'corretor' && (
          <p className="mt-1 flex flex-wrap items-center gap-2">Os clientes ficam com o corretor; o gerente e a imobiliária vêm da cadeia. <SeloProvisorio codigo="A3" /></p>
        )}
      </div>
    </form>
  )
}

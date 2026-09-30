import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Campo } from '@/components/Campo'
import { CampoCep } from '@/components/app/CampoCep'
import { Modal } from '@/components/app/Modal'
import { redeCadastrarImobiliaria, redeEditarImobiliaria } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { cnpjValido, mascaraCnpj, mascaraTelefone, soDigitos } from '@/lib/format'
import { UFS } from '@/lib/constants'
import type { Uuid } from '@/lib/types'
import { chavesRede } from '../api'
import { dadosImobiliaria, type ValoresImobiliaria } from '../regras'
import type { Imobiliaria } from '../tipos'

const ID_FORM = 'form-imobiliaria'

function valoresDe(atual: Imobiliaria | null | undefined): ValoresImobiliaria {
  return {
    nome: atual?.nome ?? '', razao_social: atual?.razao_social ?? '', cnpj: atual?.cnpj ? mascaraCnpj(atual.cnpj) : '',
    creci_pj: atual?.creci_pj ?? '', email: atual?.email ?? '', telefone: atual?.telefone ? mascaraTelefone(atual.telefone) : '',
    cep: atual?.cep ?? '', logradouro: atual?.logradouro ?? '', numero: atual?.numero ?? '', complemento: atual?.complemento ?? '',
    bairro: atual?.bairro ?? '', cidade: atual?.cidade ?? '', uf: atual?.uf ?? '',
  }
}

/**
 * Cadastro e edição de imobiliária (só internos). PAR-4: CNPJ (com dígitos verificadores, único) e CRECI PJ; a casa
 * (Imobiliária Arken) pode ficar sem eles (⚑ N7). O CEP preenche o endereço (ViaCEP/BrasilAPI).
 */
export function FormImobiliaria({ aberto, atual, aoFechar, aoSalvar }: {
  aberto: boolean
  atual?: Imobiliaria | null
  aoFechar: () => void
  aoSalvar?: (id: Uuid) => void
}) {
  const [enviando, setEnviando] = useState(false)
  return (
    <Modal
      aberto={aberto} titulo={atual ? 'Editar imobiliária' : 'Nova imobiliária'} aoFechar={aoFechar} bloquearFechar={enviando} largura="lg"
      rodape={
        <>
          <button type="button" className="btn-ghost" onClick={aoFechar} disabled={enviando}>Cancelar</button>
          <button type="submit" form={ID_FORM} className="btn-primary" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <CorpoImobiliaria atual={atual ?? null} aoEnviando={setEnviando} aoFechar={aoFechar} aoSalvar={aoSalvar} />
    </Modal>
  )
}

function CorpoImobiliaria({ atual, aoEnviando, aoFechar, aoSalvar }: {
  atual: Imobiliaria | null
  aoEnviando: (b: boolean) => void
  aoFechar: () => void
  aoSalvar?: (id: Uuid) => void
}) {
  const qc = useQueryClient()
  const casa = !!atual?.da_casa
  const esquema = z.object({
    nome: z.string().trim().min(2, 'Informe o nome').max(200, 'Máximo de 200 caracteres'),
    razao_social: z.string().max(200, 'Máximo de 200 caracteres'),
    cnpj: z.string(),
    creci_pj: z.string().max(60, 'Máximo de 60 caracteres'),
    email: z.union([z.literal(''), z.email('E-mail inválido')]),
    telefone: z.string().refine((v) => !v || [10, 11].includes(soDigitos(v).length), 'Informe o DDD e o número'),
    cep: z.string().refine((v) => !v || soDigitos(v).length === 8, 'CEP com 8 dígitos'),
    logradouro: z.string().max(200, 'Máximo de 200 caracteres'),
    numero: z.string().max(20, 'Máximo de 20 caracteres'),
    complemento: z.string().max(100, 'Máximo de 100 caracteres'),
    bairro: z.string().max(100, 'Máximo de 100 caracteres'),
    cidade: z.string().max(100, 'Máximo de 100 caracteres'),
    uf: z.string(),
  }).superRefine((v, ctx) => {
    const cnpj = soDigitos(v.cnpj)
    if (cnpj ? !cnpjValido(cnpj) : !casa) ctx.addIssue({ code: 'custom', path: ['cnpj'], message: cnpj ? 'CNPJ inválido' : 'Informe o CNPJ' })
    if (!casa && !v.creci_pj.trim()) ctx.addIssue({ code: 'custom', path: ['creci_pj'], message: 'Informe o CRECI PJ' })
  })
  const { register, handleSubmit, control, setValue, formState: { errors } } = useForm<ValoresImobiliaria>({
    resolver: zodResolver(esquema) as never,
    defaultValues: valoresDe(atual),
  })

  async function salvar(v: ValoresImobiliaria) {
    const dados = dadosImobiliaria(v)
    aoEnviando(true)
    try {
      let id: Uuid
      if (atual) {
        // a casa pode ficar sem CNPJ e CRECI PJ: o vazio não vai (o servidor recusa esvaziar fora da casa)
        const { cnpj, creci_pj, ...resto } = dados
        await redeEditarImobiliaria({ p_id: atual.id, p_dados: { ...resto, ...(cnpj ? { cnpj } : {}), ...(creci_pj ? { creci_pj } : {}) } })
        id = atual.id
        toast.success('Imobiliária atualizada.')
      } else {
        id = await redeCadastrarImobiliaria({ p_dados: dados })
        toast.success('Imobiliária cadastrada.')
      }
      await qc.invalidateQueries({ queryKey: chavesRede.tudo })
      aoSalvar?.(id)
      aoFechar()
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      aoEnviando(false)
    }
  }

  return (
    <form id={ID_FORM} onSubmit={handleSubmit(salvar)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Campo label="Nome" obrigatorio erro={errors.nome?.message}><input className="input" {...register('nome')} /></Campo>
      <Campo label="Razão social" erro={errors.razao_social?.message}><input className="input" {...register('razao_social')} /></Campo>
      <Campo label="CNPJ" obrigatorio={!casa} erro={errors.cnpj?.message}>
        <Controller control={control} name="cnpj" render={({ field }) => (
          <input className="input" inputMode="numeric" placeholder="00.000.000/0000-00" value={field.value} onBlur={field.onBlur}
            onChange={(e) => field.onChange(mascaraCnpj(e.target.value))} />
        )} />
      </Campo>
      <Campo label="CRECI PJ" obrigatorio={!casa} erro={errors.creci_pj?.message}><input className="input" {...register('creci_pj')} /></Campo>
      <Campo label="E-mail" erro={errors.email?.message}><input className="input" type="email" {...register('email')} /></Campo>
      <Campo label="Telefone" erro={errors.telefone?.message}>
        <Controller control={control} name="telefone" render={({ field }) => (
          <input className="input" inputMode="tel" value={field.value} onBlur={field.onBlur}
            onChange={(e) => field.onChange(mascaraTelefone(e.target.value))} />
        )} />
      </Campo>
      <Campo label="CEP" erro={errors.cep?.message}>
        <Controller control={control} name="cep" render={({ field }) => (
          <CampoCep valor={field.value} aoMudar={field.onChange} invalido={!!errors.cep}
            aoEncontrar={(e) => {
              setValue('logradouro', e.logradouro ?? '')
              setValue('bairro', e.bairro ?? '')
              setValue('cidade', e.cidade ?? '')
              setValue('uf', e.uf ?? '')
            }} />
        )} />
      </Campo>
      <Campo label="Logradouro" erro={errors.logradouro?.message}><input className="input" {...register('logradouro')} /></Campo>
      <Campo label="Número" erro={errors.numero?.message}><input className="input" {...register('numero')} /></Campo>
      <Campo label="Complemento" erro={errors.complemento?.message}><input className="input" {...register('complemento')} /></Campo>
      <Campo label="Bairro" erro={errors.bairro?.message}><input className="input" {...register('bairro')} /></Campo>
      <div className="grid grid-cols-[1fr_7rem] gap-4">
        <Campo label="Cidade" erro={errors.cidade?.message}><input className="input" {...register('cidade')} /></Campo>
        <Campo label="UF" erro={errors.uf?.message}>
          <select className="input" {...register('uf')}>
            <option value="">—</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Campo>
      </div>
    </form>
  )
}

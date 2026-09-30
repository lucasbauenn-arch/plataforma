import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mensagemErro, traduzirErro } from '@/lib/erros'
import { MODELOS_CONTRATO, PAPEIS_SIGNATARIO } from '@/lib/constants'
import { Campo } from '@/components/Campo'
import { Abas } from '@/components/app/Abas'
import { Consulta } from '@/components/app/Consulta'
import { Etiqueta } from '@/components/app/Etiqueta'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import type { ContratoSignatarioRegra } from './tipos'

const chaveRegras = ['config', 'signatarios'] as const
const CHAVES_ENVIO = ['parcelado', 'flexivel'] as const
type ChaveEnvio = (typeof CHAVES_ENVIO)[number]

const FONTES: Record<ContratoSignatarioRegra['fonte'], string> = {
  cliente: 'O cliente do contrato (nome e e-mail do cadastro)',
  corretor_do_cliente: 'O corretor do contrato (e-mail do cadastro)',
  fixo: 'Pessoa fixa (nome e e-mail abaixo)',
}

/**
 * Regras obrigatórias (D3): o comprador e a vendedora (representante da Arken) sempre ASSINAM — nunca desligadas nem
 * como testemunha. O banco bloqueia o envio sem elas ou com outro ato (WP4R-05).
 */
const obrigatoria = (r: ContratoSignatarioRegra) => r.papel === 'cliente' || r.papel === 'representante_arken'

const esquema = z.object({
  ordem: z.string().trim().regex(/^\d{1,2}$/, 'De 1 a 50.').refine((v) => Number(v) >= 1 && Number(v) <= 50, 'De 1 a 50.'),
  nome: z.string().trim().max(200, 'Máximo de 200 caracteres.'),
  email: z.string().trim().max(200, 'Máximo de 200 caracteres.').refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail inválido.'),
  ato: z.enum(['assinar', 'testemunhar']).optional(),
  ativo: z.boolean().optional(),
})
type Form = z.infer<typeof esquema>

/**
 * Super: regras de signatários dos contratos (D3 ⚑). Nenhum e-mail fica no código: o representante da Arken e as
 * testemunhas são configurados aqui; regra ativa "fixa" sem e-mail bloqueia o envio, de propósito. As regras do
 * cliente e do representante não podem ser desligadas (o banco também exige as duas para enviar).
 */
export default function Signatarios() {
  const q = useQuery({
    queryKey: chaveRegras,
    queryFn: async () => {
      const { data, error } = await supabase.from('contrato_signatario_regras')
        .select('id, modelo_chave, ordem, papel, fonte, nome, email, ato, ativo').order('modelo_chave').order('ordem')
      if (error) throw traduzirErro(error)
      return (data ?? []) as ContratoSignatarioRegra[]
    },
  })
  const [chave, setChave] = useState<ChaveEnvio>('parcelado')
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <SeloProvisorio codigo="D3" />
        <span>Os dados da Arken como vendedora (razão social, CNPJ e endereço) ficam em <Link to="/admin/configuracoes/geral" className="text-bronze hover:underline">Configurações › Geral</Link> (N7).</span>
      </div>
      <Abas abas={CHAVES_ENVIO.map((c) => ({ id: c, rotulo: MODELOS_CONTRATO[c] }))} ativa={chave} aoMudar={setChave} rotulo="Modelo" />
      <Consulta consulta={q} vazio={(d) => !d?.some((r) => r.modelo_chave === chave)} tituloVazio="Nenhuma regra para este modelo">
        {(regras) => (
          <div className="grid gap-4">
            {regras.filter((r) => r.modelo_chave === chave).map((r) => <RegraSignatario key={r.id} regra={r} />)}
          </div>
        )}
      </Consulta>
    </div>
  )
}

function RegraSignatario({ regra }: { regra: ContratoSignatarioRegra }) {
  const qc = useQueryClient()
  const fixo = regra.fonte === 'fixo'
  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty }, reset } = useForm<Form>({
    resolver: zodResolver(esquema),
    defaultValues: { ordem: String(regra.ordem), nome: regra.nome ?? '', email: regra.email ?? '', ato: regra.ato, ativo: regra.ativo },
  })

  async function salvar(f: Form) {
    if (fixo && f.nome.trim().length < 2) {
      toast.error('Informe o nome do signatário.')
      return
    }
    const ativo = obrigatoria(regra) ? true : f.ativo ?? regra.ativo
    if (obrigatoria(regra) && !ativo) {
      toast.error('O comprador e o representante da Arken sempre assinam: esta regra não pode ser desligada.')
      return
    }
    const mudancas = {
      ordem: Number(f.ordem), ato: obrigatoria(regra) ? 'assinar' : f.ato ?? regra.ato, ativo,
      ...(fixo ? { nome: f.nome.trim(), email: f.email.trim().toLowerCase() || null } : {}),
    }
    const { error } = await supabase.from('contrato_signatario_regras').update(mudancas).eq('id', regra.id)
    if (error) {
      toast.error(error.code === '23505' ? 'Já existe outra regra com essa ordem neste modelo.' : mensagemErro(traduzirErro(error)))
      return
    }
    toast.success('Regra salva.')
    reset(f)
    await qc.invalidateQueries({ queryKey: chaveRegras })
  }

  const semEmail = fixo && regra.ativo && !regra.email
  // regra obrigatória gravada com outro ato (ex.: pela API): a tela mostra "Assina" e deixa salvar para corrigir
  const atoInvalido = obrigatoria(regra) && regra.ato !== 'assinar'
  return (
    <form onSubmit={handleSubmit(salvar)} noValidate className="card grid gap-4 p-5" aria-label={`Regra ${regra.ordem}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{PAPEIS_SIGNATARIO[regra.papel]}</span>
          {obrigatoria(regra) && <Etiqueta>Obrigatória</Etiqueta>}
          {!regra.ativo && <Etiqueta>Desligada</Etiqueta>}
          {semEmail && <Etiqueta tom="alerta">Sem e-mail: bloqueia o envio</Etiqueta>}
          {atoInvalido && <Etiqueta tom="alerta">Gravada como testemunha: salve para corrigir</Etiqueta>}
        </div>
        <span className="text-xs text-muted">{FONTES[regra.fonte]}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-[6rem_1fr_1fr_10rem]">
        <Campo label="Ordem" erro={errors.ordem?.message}><input className="input" inputMode="numeric" {...register('ordem')} /></Campo>
        {fixo ? (
          <>
            <Campo label="Nome" obrigatorio erro={errors.nome?.message}><input className="input" {...register('nome')} /></Campo>
            <Campo label="E-mail" erro={errors.email?.message}><input className="input" type="email" {...register('email')} /></Campo>
          </>
        ) : <p className="self-end pb-3 text-sm text-muted sm:col-span-2">Nome e e-mail vêm do cadastro, no momento do envio.</p>}
        {obrigatoria(regra) ? <p className="self-end pb-3 text-sm">Assina</p> : (
          <Campo label="Ato" erro={errors.ato?.message}>
            <select className="input" {...register('ato')}>
              <option value="assinar">Assinar</option>
              <option value="testemunhar">Testemunhar</option>
            </select>
          </Campo>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {obrigatoria(regra) ? <p className="text-sm text-muted">Sempre ativa (comprador e vendedora assinam todo contrato).</p> : (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-bronze" {...register('ativo')} />
            Regra ativa
          </label>
        )}
        <button type="submit" className="btn-primary" disabled={(!isDirty && !atoInvalido) || isSubmitting}><Save size={16} aria-hidden /> {isSubmitting ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </form>
  )
}

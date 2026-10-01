import { useMemo, type ReactNode } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Campo } from '@/components/Campo'
import { CampoData } from '@/components/app/CampoData'
import { hojeIso } from '@/lib/datas'
import { CampoCep } from '@/components/app/CampoCep'
import { ErroRpc, listaDoDetalhe, mensagemErro, rotuloCampo } from '@/lib/erros'
import { ESTADOS_CIVIS, GENEROS, INTERESSES, TIPOS_PESSOA, UFS } from '@/lib/constants'
import { mascaraCnpj, mascaraCpf, mascaraTelefone } from '@/lib/format'
import type { EstadoCivil, Genero, TipoPessoa } from '@/lib/types'
import { campoDoFormulario, documentoObrigatorio, esquemaCliente, VALORES_VAZIOS, type ValoresCliente } from '../api-clientes'

/**
 * Formulário do cliente do CRM (cadastro, edição na aba Dados e conversão de lead). react-hook-form + zod, máscaras
 * de format.ts e CEP automático. O servidor valida tudo de novo: campos recusados (DADOS_INVALIDOS) voltam marcados.
 * - `modo='cadastro'`: escolhe PF/PJ e pede a declaração de consentimento (N12) com a versão do termo vigente;
 * - `modo='edicao'`: tipo de pessoa fixo; o documento só é editável com `podeEditarDocumento` (vazio ou interno).
 */
export function FormCliente({
  modo, inicial, podeEditarDocumento = true, versaoTermo, antesDosBotoes, rotuloEnviar, aoEnviar, aoCancelar, desabilitado,
}: {
  modo: 'cadastro' | 'edicao'
  inicial?: Partial<ValoresCliente>
  podeEditarDocumento?: boolean
  /** Versão do termo de consentimento vigente (cadastro). Sem termo, o envio fica bloqueado. */
  versaoTermo?: string | null
  /** Conteúdo extra no fim do formulário (ex.: escolha do corretor). */
  antesDosBotoes?: ReactNode
  rotuloEnviar: string
  aoEnviar: (v: ValoresCliente) => Promise<void>
  aoCancelar?: () => void
  desabilitado?: boolean
}) {
  const cadastro = modo === 'cadastro'
  const valores = useMemo(() => ({ ...VALORES_VAZIOS, ...inicial }), [inicial])
  // na edição, documento obrigatório só se o cliente já tem um (cliente migrado sem CPF continua editável)
  const docObrigatorio = documentoObrigatorio(modo, podeEditarDocumento, valores.documento)
  const esquema = useMemo(
    () => esquemaCliente({ exigirDeclaracao: cadastro, documentoObrigatorio: docObrigatorio, interessesAceitos: valores.interesses }),
    [cadastro, docObrigatorio, valores.interesses],
  )
  const { register, handleSubmit, control, setValue, setError, formState: { errors, isSubmitting } } = useForm<ValoresCliente>({
    resolver: zodResolver(esquema),
    defaultValues: valores,
  })
  const tipo = useWatch({ control, name: 'tipo_pessoa' })
  const pf = tipo === 'fisica'
  const interesses = useWatch({ control, name: 'interesses' })

  async function enviar(v: ValoresCliente) {
    try {
      await aoEnviar(v)
    } catch (e) {
      if (e instanceof ErroRpc && e.codigo === 'DADOS_INVALIDOS') {
        const campos = listaDoDetalhe(e, 'campos')
        for (const c of campos) {
          const f = campoDoFormulario(c)
          if (f) setError(f, { message: 'Valor inválido' })
        }
        toast.error(campos.length ? `Confira: ${campos.map(rotuloCampo).join(', ')}.` : e.message)
        return
      }
      toast.error(mensagemErro(e))
    }
  }

  const alternarInteresse = (op: string) =>
    setValue('interesses', interesses.includes(op) ? interesses.filter((i) => i !== op) : [...interesses, op], { shouldDirty: true })

  const bloqueado = desabilitado || isSubmitting || (cadastro && !versaoTermo)

  return (
    <form onSubmit={handleSubmit(enviar)} className="grid gap-6" noValidate>
      <section className="card grid gap-4 p-6 sm:grid-cols-2">
        <h3 className="text-lg font-semibold sm:col-span-2">Identificação</h3>
        {cadastro && (
          <fieldset className="sm:col-span-2">
            <legend className="label">Tipo de pessoa</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TIPOS_PESSOA) as TipoPessoa[]).map((t) => (
                <label key={t} className={`cursor-pointer border px-4 py-2 text-sm font-semibold ${tipo === t ? 'border-stone bg-stone text-ink' : 'border-line text-stone/80 hover:bg-sand'}`}>
                  <input type="radio" value={t} className="sr-only" {...register('tipo_pessoa', { onChange: () => setValue('documento', '') })} />
                  {TIPOS_PESSOA[t]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Campo label={pf ? 'Nome' : 'Razão social'} obrigatorio erro={errors.nome?.message}>
          <input className="input" autoComplete="off" {...register('nome')} />
        </Campo>
        {pf && (
          <Campo label="Sobrenome" erro={errors.sobrenome?.message}>
            <input className="input" autoComplete="off" {...register('sobrenome')} />
          </Campo>
        )}
        <Campo label={pf ? 'CPF' : 'CNPJ'} obrigatorio={docObrigatorio} erro={errors.documento?.message}>
          <input
            className="input" inputMode="numeric" autoComplete="off" disabled={!podeEditarDocumento}
            placeholder={pf ? '000.000.000-00' : '00.000.000/0000-00'}
            {...register('documento', { onChange: (e) => setValue('documento', pf ? mascaraCpf(e.target.value) : mascaraCnpj(e.target.value)) })}
          />
          {!podeEditarDocumento && <span className="mt-1 block text-xs text-muted">Só a equipe Arken altera um documento já preenchido.</span>}
        </Campo>
        {pf && (
          <>
            <Campo label="RG" erro={errors.rg?.message}><input className="input" autoComplete="off" {...register('rg')} /></Campo>
            <Campo label="Data de nascimento" erro={errors.data_nascimento?.message}>
              <Controller control={control} name="data_nascimento" render={({ field }) => (
                <CampoData valor={field.value ?? ''} aoMudar={field.onChange} min="1900-01-01" max={hojeIso()} invalido={!!errors.data_nascimento} />
              )} />
            </Campo>
            <Campo label="Gênero" erro={errors.genero?.message}>
              <select className="input" {...register('genero')}>
                <option value="">—</option>
                {(Object.keys(GENEROS) as Genero[]).map((g) => <option key={g} value={g}>{GENEROS[g]}</option>)}
              </select>
            </Campo>
            <Campo label="Estado civil" erro={errors.estado_civil?.message}>
              <select className="input" {...register('estado_civil')}>
                <option value="">—</option>
                {(Object.keys(ESTADOS_CIVIS) as EstadoCivil[]).map((e) => <option key={e} value={e}>{ESTADOS_CIVIS[e]}</option>)}
              </select>
            </Campo>
            <Campo label="Nacionalidade" erro={errors.nacionalidade?.message}>
              <input className="input" {...register('nacionalidade')} />
            </Campo>
          </>
        )}
      </section>

      <section className="card grid gap-4 p-6 sm:grid-cols-2">
        <h3 className="text-lg font-semibold sm:col-span-2">Contato</h3>
        <Campo label="Telefone / WhatsApp" erro={errors.telefone?.message}>
          <input
            className="input" inputMode="tel" placeholder="(11) 90000-0000"
            {...register('telefone', { onChange: (e) => setValue('telefone', mascaraTelefone(e.target.value)) })}
          />
        </Campo>
        <Campo label="E-mail" erro={errors.email?.message}>
          <input type="email" className="input" autoComplete="off" {...register('email')} />
        </Campo>
        <Campo label="Outros telefones (separe por vírgula)" erro={errors.telefones_adicionais?.message}>
          <input className="input" inputMode="tel" {...register('telefones_adicionais')} />
        </Campo>
        <Campo label="Outros e-mails (separe por vírgula)" erro={errors.emails_adicionais?.message}>
          <input className="input" {...register('emails_adicionais')} />
        </Campo>
        <Campo label="Melhor horário para contato" erro={errors.horario_contato?.message}>
          <input className="input" placeholder="Ex.: dias úteis após as 18h" {...register('horario_contato')} />
        </Campo>
      </section>

      <section className="card grid gap-4 p-6 sm:grid-cols-6">
        <h3 className="text-lg font-semibold sm:col-span-6">Endereço</h3>
        <div className="sm:col-span-2">
          <Campo label="CEP" erro={errors.cep?.message}>
            <Controller
              control={control} name="cep"
              render={({ field }) => (
                <CampoCep
                  valor={field.value} aoMudar={field.onChange} invalido={!!errors.cep}
                  aoEncontrar={(e) => {
                    setValue('logradouro', e.logradouro ?? '')
                    setValue('bairro', e.bairro ?? '')
                    setValue('cidade', e.cidade ?? '')
                    setValue('uf', e.uf ?? '')
                  }}
                />
              )}
            />
          </Campo>
        </div>
        <div className="sm:col-span-4"><Campo label="Logradouro" erro={errors.logradouro?.message}><input className="input" {...register('logradouro')} /></Campo></div>
        <div className="sm:col-span-2"><Campo label="Número" erro={errors.numero?.message}><input className="input" {...register('numero')} /></Campo></div>
        <div className="sm:col-span-4"><Campo label="Complemento" erro={errors.complemento?.message}><input className="input" {...register('complemento')} /></Campo></div>
        <div className="sm:col-span-3"><Campo label="Bairro" erro={errors.bairro?.message}><input className="input" {...register('bairro')} /></Campo></div>
        <div className="sm:col-span-3"><Campo label="Cidade" erro={errors.cidade?.message}><input className="input" {...register('cidade')} /></Campo></div>
        <div className="sm:col-span-2">
          <Campo label="UF" erro={errors.uf?.message}>
            <select className="input" {...register('uf')}>
              <option value="">—</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Campo>
        </div>
        <div className="sm:col-span-4"><Campo label="País" erro={errors.pais?.message}><input className="input" {...register('pais')} /></Campo></div>
      </section>

      <section className="card p-6">
        <h3 className="mb-4 text-lg font-semibold">Interesses</h3>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {INTERESSES.map((g) => (
            <fieldset key={g.grupo}>
              <legend className="label">{g.grupo}</legend>
              <div className="flex flex-wrap gap-2">
                {g.opcoes.map((op) => {
                  const marcado = interesses.includes(op)
                  return (
                    <button
                      key={op} type="button" aria-pressed={marcado} onClick={() => alternarInteresse(op)}
                      className={`border px-3 py-1.5 text-xs font-semibold transition ${marcado ? 'border-stone bg-stone text-ink' : 'border-line text-stone/80 hover:bg-sand'}`}
                    >
                      {op}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>
        {errors.interesses?.message && <p className="mt-2 text-xs text-perigo">{errors.interesses.message}</p>}
      </section>

      {antesDosBotoes}

      {cadastro && (
        <section className="card p-6">
          {versaoTermo ? (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-4 accent-bronze" {...register('declaracao')} />
              <span>
                Declaro que o cliente consentiu com o tratamento dos dados pessoais conforme a Política de privacidade da Arken
                (versão {versaoTermo}). O registro fica em nome de quem cadastra.
              </span>
            </label>
          ) : (
            <p className="text-sm text-muted">Carregando o termo de consentimento vigente…</p>
          )}
          {errors.declaracao?.message && <p className="mt-2 text-xs text-perigo">{errors.declaracao.message}</p>}
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn-primary" disabled={bloqueado}>{isSubmitting ? 'Salvando…' : rotuloEnviar}</button>
        {aoCancelar && <button type="button" className="btn-ghost" onClick={aoCancelar} disabled={isSubmitting}>Cancelar</button>}
      </div>
    </form>
  )
}

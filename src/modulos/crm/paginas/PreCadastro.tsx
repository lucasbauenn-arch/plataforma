import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CircleCheck, Link2Off, Loader2, ShieldCheck } from 'lucide-react'
import { redeLinkPublico } from '@/lib/rpc'
import { cnpjValido, cpfValido, mascaraCnpj, mascaraCpf, mascaraTelefone, soDigitos } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { Carregando } from '@/components/Estados'
import { Turnstile } from '@/components/Turnstile'
import { ErroConsulta } from '@/components/app/Consulta'
import { chavesCrm, deveRelerTermo, enviarPreCadastro, ErroPreCadastro, useTermoCliente } from '../api-clientes'

const COM_TURNSTILE = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY)
const CODIGO = /^[a-z2-7]{10}$/

const esquema = z.object({
  tipo_pessoa: z.enum(['fisica', 'juridica']),
  nome: z.string().trim().min(2, 'Informe seu nome').max(200, 'Nome muito longo'),
  sobrenome: z.string().trim().max(200, 'Sobrenome muito longo'),
  documento: z.string(),
  email: z.string().trim().max(200).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail inválido'),
  telefone: z.string().refine((v) => /^\d{10,11}$/.test(soDigitos(v)), 'Informe o telefone com DDD'),
  aceite: z.boolean().refine((v) => v, 'Para continuar, aceite o termo'),
}).superRefine((v, ctx) => {
  const ok = v.tipo_pessoa === 'fisica' ? cpfValido(v.documento) : cnpjValido(v.documento)
  if (!ok) ctx.addIssue({ code: 'custom', path: ['documento'], message: v.tipo_pessoa === 'fisica' ? 'CPF inválido' : 'CNPJ inválido' })
})
type Dados = z.infer<typeof esquema>

/**
 * Pré-cadastro público pelo link de indicação (/pre-cadastro/cliente/:codigo, §6.1 e §7.2).
 * "Indicado por …" vem de rede_link_publico; o termo vigente de lgpd_termo_vigente, com aceite obrigatório. Sem termo
 * revisado pelo jurídico, o formulário não abre (H4). A mensagem de sucesso é a MESMA em todos os casos: ninguém
 * descobre por aqui se um CPF já está na base. Turnstile e limite por IP ficam na Edge pre-cadastro.
 */
export default function PreCadastro() {
  const { codigo: bruto = '' } = useParams()
  const codigo = bruto.trim().toLowerCase()
  const valido = CODIGO.test(codigo)
  const link = useQuery({
    queryKey: chavesCrm.linkPublico(codigo),
    queryFn: () => redeLinkPublico({ p_codigo: codigo }),
    enabled: valido,
    retry: false,
  })
  const termo = useTermoCliente(valido)
  const [enviado, setEnviado] = useState(false)

  let conteudo
  if (!valido || (link.isSuccess && !link.data)) {
    conteudo = (
      <Aviso icone={<Link2Off className="text-bronze" size={40} aria-hidden />} titulo="Link inválido">
        Este link de indicação não é válido ou foi desativado. Peça um link novo a quem indicou você, ou fale com a Arken.
      </Aviso>
    )
  } else if (link.isPending || termo.isPending) {
    conteudo = <Carregando />
  } else if (link.error || termo.error) {
    conteudo = <ErroConsulta erro={link.error ?? termo.error} tentarDeNovo={() => { void link.refetch(); void termo.refetch() }} />
  } else if (!termo.data || !termo.data.revisado_juridico) {
    conteudo = (
      <Aviso icone={<ShieldCheck className="text-bronze" size={40} aria-hidden />} titulo="Pré-cadastro indisponível">
        O pré-cadastro está temporariamente indisponível. Tente de novo mais tarde ou fale com quem indicou você.
      </Aviso>
    )
  } else if (enviado) {
    conteudo = (
      <Aviso icone={<CircleCheck className="text-sage" size={40} aria-hidden />} titulo="Recebemos seus dados">
        Obrigado! Em breve {link.data?.nome_corretor ?? 'nossa equipe'} vai entrar em contato com você.
      </Aviso>
    )
  } else {
    conteudo = (
      <Formulario
        codigo={codigo} termoId={termo.data.id} termoVersao={termo.data.versao} termoTexto={termo.data.texto}
        indicadoPor={link.data!.nome_corretor} imobiliaria={link.data!.nome_imobiliaria} aoConcluir={() => setEnviado(true)}
        aoTrocarTermo={() => void termo.refetch()}
      />
    )
  }

  return (
    <section className="container-x py-16 sm:py-24">
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow">Pré-cadastro</p>
        <h1 className="display mt-3 text-4xl sm:text-5xl">Cadastre-se na Arken</h1>
        <div className="mt-10">{conteudo}</div>
      </div>
    </section>
  )
}

function Aviso({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <div className="card p-8 text-center">
      <div className="flex justify-center">{icone}</div>
      <h2 className="display mt-4 text-3xl">{titulo}</h2>
      <p className="mt-3 text-muted">{children}</p>
      <Link to="/" className="btn-ghost mt-8">Ir para o site</Link>
    </div>
  )
}

function Formulario({ codigo, termoId, termoVersao, termoTexto, indicadoPor, imobiliaria, aoConcluir, aoTrocarTermo }: {
  codigo: string
  termoId: string
  termoVersao: string
  termoTexto: string
  indicadoPor: string
  imobiliaria: string | null
  aoConcluir: () => void
  aoTrocarTermo: () => void
}) {
  const [captcha, setCaptcha] = useState('')
  const [chaveCaptcha, setChaveCaptcha] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const { register, handleSubmit, control, setValue, setError, formState: { errors, isSubmitting } } = useForm<Dados>({
    resolver: zodResolver(esquema),
    defaultValues: { tipo_pessoa: 'fisica', nome: '', sobrenome: '', documento: '', email: '', telefone: '', aceite: false },
  })
  const tipoPessoa = useWatch({ control, name: 'tipo_pessoa' })
  const pf = tipoPessoa === 'fisica'

  async function enviar(d: Dados) {
    setErro(null)
    if (COM_TURNSTILE && !captcha) {
      setErro('Aguarde a verificação anti-robô terminar e tente de novo.')
      return
    }
    try {
      await enviarPreCadastro({
        codigo, termo_id: termoId, captcha,
        tipo_pessoa: d.tipo_pessoa, nome: d.nome.trim(), sobrenome: pf ? d.sobrenome.trim() || null : null,
        documento: soDigitos(d.documento), email: d.email.trim().toLowerCase() || null, telefone: soDigitos(d.telefone),
      })
      aoConcluir()
    } catch (e) {
      const falha = e instanceof ErroPreCadastro ? e : new ErroPreCadastro(0, 'Não foi possível enviar agora. Tente de novo.')
      let relerTermo = deveRelerTermo(falha)
      for (const c of falha.campos) {
        if (c === 'cpf' || c === 'cnpj') setError('documento', { message: 'Documento inválido' })
        else if (c === 'nome' || c === 'sobrenome' || c === 'email' || c === 'telefone') setError(c, { message: 'Valor inválido' })
        else if (c === 'termo_id') relerTermo = true
      }
      if (relerTermo) {
        // termo novo publicado com a página aberta (409) ou retirado (503): relê o vigente e pede o aceite de novo
        setValue('aceite', false)
        aoTrocarTermo()
      }
      setErro(falha.message)
      // o token do Turnstile é de uso único: gera outro para a próxima tentativa
      setCaptcha('')
      setChaveCaptcha((k) => k + 1)
    }
  }

  return (
    <form onSubmit={handleSubmit(enviar)} className="grid gap-5" noValidate>
      <p className="border border-line bg-ink-soft px-4 py-3 text-sm">
        Indicado por <strong>{indicadoPor}</strong>{imobiliaria ? ` · ${imobiliaria}` : ''}
      </p>
      <fieldset>
        <legend className="label">Você é</legend>
        <div className="flex flex-wrap gap-2">
          {([['fisica', 'Pessoa física'], ['juridica', 'Empresa']] as const).map(([v, r]) => (
            <label key={v} className={`cursor-pointer border px-4 py-2 text-sm font-semibold ${tipoPessoa === v ? 'border-stone bg-stone text-ink' : 'border-line text-stone/80 hover:bg-sand'}`}>
              <input type="radio" value={v} className="sr-only" {...register('tipo_pessoa', { onChange: () => setValue('documento', '') })} />
              {r}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo label={pf ? 'Nome' : 'Razão social'} obrigatorio erro={errors.nome?.message}>
          <input className="input" autoComplete={pf ? 'given-name' : 'organization'} {...register('nome')} />
        </Campo>
        {pf && (
          <Campo label="Sobrenome" erro={errors.sobrenome?.message}>
            <input className="input" autoComplete="family-name" {...register('sobrenome')} />
          </Campo>
        )}
        <Campo label={pf ? 'CPF' : 'CNPJ'} obrigatorio erro={errors.documento?.message}>
          <input
            className="input" inputMode="numeric" autoComplete="off"
            {...register('documento', { onChange: (e) => setValue('documento', pf ? mascaraCpf(e.target.value) : mascaraCnpj(e.target.value)) })}
          />
        </Campo>
        <Campo label="Telefone / WhatsApp" obrigatorio erro={errors.telefone?.message}>
          <input
            className="input" inputMode="tel" autoComplete="tel"
            {...register('telefone', { onChange: (e) => setValue('telefone', mascaraTelefone(e.target.value)) })}
          />
        </Campo>
        <Campo label="E-mail" erro={errors.email?.message}>
          <input type="email" className="input" autoComplete="email" {...register('email')} />
        </Campo>
      </div>

      <div>
        <p className="label">Termo de consentimento (versão {termoVersao})</p>
        <div className="max-h-56 overflow-y-auto border border-line bg-ink-soft p-4 text-xs whitespace-pre-line text-stone/80" tabIndex={0}>
          {termoTexto}
        </div>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-bronze" {...register('aceite')} />
          <span>Li e aceito o tratamento dos meus dados pessoais conforme o termo acima.</span>
        </label>
        {errors.aceite?.message && <span className="mt-1 block text-xs text-perigo">{errors.aceite.message}</span>}
      </div>

      <Turnstile key={chaveCaptcha} acao="pre_cadastro" onToken={setCaptcha} />
      {erro && <p role="alert" className="border border-perigo/30 bg-perigo/10 px-4 py-3 text-sm text-perigo">{erro}</p>}
      <button type="submit" className="btn-primary justify-self-start" disabled={isSubmitting}>
        {isSubmitting ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Enviando…</> : 'Enviar pré-cadastro'}
      </button>
    </form>
  )
}

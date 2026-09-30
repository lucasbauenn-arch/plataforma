import { useEffect, useRef, useState, type BaseSyntheticEvent, type ElementType, type ReactNode } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import clsx from 'clsx'
import { Ban, Lock } from 'lucide-react'
import { ADICIONAIS_IMOVEL, UFS } from '@/lib/constants'
import { listaDoDetalhe, mensagemErro, traduzirErro } from '@/lib/erros'
import { useEscopo } from '@/lib/escopo'
import { codigoExibicao, dataHora } from '@/lib/format'
import { imovelInativar, imovelMudarStatus } from '@/lib/rpc'
import type { EnderecoCep } from '@/lib/cep'
import { Campo } from '@/components/Campo'
import { Carregando, Vazio } from '@/components/Estados'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { CampoCep } from '@/components/app/CampoCep'
import { CampoMoeda } from '@/components/app/CampoMoeda'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { ErroConsulta } from '@/components/app/Consulta'
import { Etiqueta, SeloStatus } from '@/components/app/Etiqueta'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { useArea, useBase } from '@/components/app/useBase'
import type { StatusTransicao } from '@/modulos/config/tipos'
import {
  atualizarImovel, buscarImovel, chavesImoveis, contratoDoImovel, criarImovel, listarTipos, listarTransicoes,
} from '../api'
import {
  ADICIONAIS, MSG_FALTA_FINALIZAR, dadosDoForm, dadosDoImovel, diferencas, ehCampoObrigatorio, esquemaImovelPara,
  formDoImovel, formVazio, mensagemFalta, type FormImovel,
} from '../formulario'
import {
  MOTIVO_INATIVACAO_MINIMO, OBSERVACAO_MINIMA, podeEditarDados, rotuloTransicao, transicoesPermitidas, usuarioDoEscopo,
  valorTravado,
} from '../fluxo'
import { FotosImovel } from '../componentes/FotosImovel'
import { HistoricoImovel } from '../componentes/HistoricoImovel'
import type { CampoObrigatorioImovel, Imovel as RegistroImovel } from '../tipos'

/** Rótulos dos campos do IMV-2, iguais aos do formulário. */
const ROTULOS: Record<CampoObrigatorioImovel, string> = {
  nome: 'Nome do imóvel', tipo: 'Tipo', cep: 'CEP', logradouro: 'Logradouro', numero: 'Número', cidade: 'Cidade',
  uf: 'Estado (UF)', valor: 'Valor',
}

/** Textos da confirmação de cada mudança de status (§7.3). */
const TEXTOS_TRANSICAO: Record<string, string> = {
  'pendente>em_revisao': 'Enquanto a equipe revisa, quem cadastrou não edita mais o imóvel.',
  'em_revisao>aprovado':
    'Depois de aprovado, o imóvel aparece para todos os parceiros aprovados e pode entrar em contratos. A partir daqui, só a equipe Arken edita.',
  'em_revisao>rascunho': 'O imóvel volta para rascunho e quem cadastrou vê a observação para fazer os ajustes.',
}
const SUCESSO_TRANSICAO: Record<string, string> = {
  'pendente>em_revisao': 'Revisão iniciada.',
  'em_revisao>aprovado': 'Imóvel aprovado.',
  'em_revisao>rascunho': 'Imóvel devolvido para ajustes.',
}
const precisaObservacao = (t: StatusTransicao) => t.exige_motivo || (t.de === 'em_revisao' && t.para === 'rascunho')

function faltandoDoEstado(estado: unknown): CampoObrigatorioImovel[] {
  const f = estado && typeof estado === 'object' ? (estado as { faltando?: unknown }).faltando : null
  return Array.isArray(f) ? f.filter((c): c is CampoObrigatorioImovel => typeof c === 'string' && ehCampoObrigatorio(c)) : []
}

/**
 * [WP5] Editor do imóvel (§7.3): novo (`imoveis/novo`) e existente (`imoveis/:id`). Seções Identificação, Endereço
 * (CEP automático), Características, Adicionais e Fotos; "Salvar rascunho" e "Finalizar cadastro" (IMV-2 validado no
 * servidor, com a lista dos campos faltando); só internos: Iniciar revisão, Aprovar, Devolver com observação e Inativar,
 * com o histórico. Em NC o valor fica travado (IMV-3). Quem decide tudo é o servidor (RLS, grants e RPCs).
 */
export default function Imovel() {
  const { id } = useParams()
  // chave por registro: trocar de imóvel (ou sair do "novo" para o salvo) recomeça o formulário do zero
  return <PaginaImovel key={id ?? 'novo'} id={id ?? null} />
}

function PaginaImovel({ id }: { id: string | null }) {
  const base = useBase()
  const consulta = useQuery({ queryKey: chavesImoveis.item(id ?? 'novo'), queryFn: () => buscarImovel(id ?? ''), enabled: !!id })
  if (!id) return <Editor imovel={null} />
  const voltar = { para: `${base}/imoveis`, rotulo: 'Imóveis' }
  if (consulta.isPending) return <Carregando />
  if (consulta.error) {
    return (
      <section>
        <CabecalhoPagina titulo="Imóvel" voltar={voltar} />
        <ErroConsulta erro={consulta.error} tentarDeNovo={consulta.refetch} />
      </section>
    )
  }
  if (!consulta.data) {
    return (
      <section>
        <CabecalhoPagina titulo="Imóvel" voltar={voltar} />
        <Vazio titulo="Imóvel não encontrado" texto="Ele não existe ou você não tem acesso a ele." />
      </section>
    )
  }
  return <Editor imovel={consulta.data} />
}

function Aviso({ tom, titulo, children }: { tom: 'alerta' | 'erro' | 'neutro'; titulo?: string; children: ReactNode }) {
  return (
    <div className={clsx('border px-5 py-4 text-sm', {
      'border-bronze/40 bg-bronze/10': tom === 'alerta',
      'border-perigo/30 bg-perigo/10 text-perigo': tom === 'erro',
      'border-line bg-sand/40': tom === 'neutro',
    })}>
      {titulo && <p className="mb-1 font-semibold">{titulo}</p>}
      <div className="text-stone/90">{children}</div>
    </div>
  )
}

function Secao({ titulo, Titulo, extra, children }: { titulo: string; Titulo: ElementType; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Titulo className="text-lg font-semibold">{titulo}</Titulo>
        {extra}
      </div>
      {children}
    </section>
  )
}

function Editor({ imovel }: { imovel: RegistroImovel | null }) {
  const base = useBase()
  const Titulo: ElementType = useArea() === 'admin' ? 'h2' : 'h3'
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { escopo, tem } = useEscopo()
  const usuario = usuarioDoEscopo(escopo)

  // imóvel novo: quem cadastra é o criador, em rascunho
  const atual = imovel ?? { status: 'rascunho' as const, criado_por: usuario.profileId ?? '', inativado_em: null }
  const editavel = imovel ? podeEditarDados(imovel, usuario) : true
  const travado = imovel ? valorTravado(imovel) : false

  const tipos = useQuery({ queryKey: chavesImoveis.tipos, queryFn: listarTipos, staleTime: 10 * 60_000 })
  const transicoes = useQuery({ queryKey: chavesImoveis.transicoes, queryFn: listarTransicoes, staleTime: 5 * 60_000 })
  const permitidas = transicoesPermitidas(atual, transicoes.data ?? [], usuario)
  const finalizar = permitidas.find((t) => t.de === 'rascunho' && t.para === 'pendente') ?? null
  const outras = imovel ? permitidas.filter((t) => t !== finalizar) : []

  // fora do rascunho os campos do IMV-2 não podem ficar vazios (o esquema acompanha o status atual: o useForm relê as
  // opções a cada renderização)
  const {
    register, control, handleSubmit, reset, setError, setValue, getValues,
    formState: { errors, isDirty, isSubmitting, isSubmitted },
  } = useForm<FormImovel>({
    resolver: zodResolver(esquemaImovelPara(atual.status)),
    defaultValues: imovel ? formDoImovel(imovel) : formVazio(),
  })

  const [faltando, setFaltando] = useState<CampoObrigatorioImovel[]>(() => faltandoDoEstado(location.state))
  const [acao, setAcao] = useState<StatusTransicao | null>(null)
  const [inativando, setInativando] = useState(false)
  const [abrindoContrato, setAbrindoContrato] = useState(false)

  // campos faltando trazidos do cadastro novo (finalizar já no primeiro salvamento); o estado da navegação é limpo
  const inicio = useRef(true)
  useEffect(() => {
    if (!inicio.current) return
    inicio.current = false
    if (faltando.length) {
      for (const c of faltando) setError(c, { type: 'servidor', message: MSG_FALTA_FINALIZAR })
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [faltando, setError, navigate, location.pathname])

  // registro atualizado por fora (outra aba, mudança de status): recarrega o formulário se não houver edição em curso
  const ultimo = useRef(imovel)
  useEffect(() => {
    if (!imovel || imovel === ultimo.current) return
    ultimo.current = imovel
    if (!isDirty) reset(formDoImovel(imovel))
  }, [imovel, isDirty, reset])

  // aviso do navegador ao sair com alterações não salvas
  useEffect(() => {
    if (!isDirty) return
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [isDirty])

  const invalidarLista = () => qc.invalidateQueries({ queryKey: ['imoveis', 'lista'] })

  async function gravar(f: FormImovel): Promise<{ registro: RegistroImovel; mudou: boolean }> {
    const depois = dadosDoForm(f)
    if (!imovel) {
      const novo = await criarImovel(depois)
      qc.setQueryData(chavesImoveis.item(novo.id), novo)
      void invalidarLista()
      return { registro: novo, mudou: true }
    }
    const mudancas = diferencas(dadosDoImovel(imovel), depois)
    if (Object.keys(mudancas).length === 0) return { registro: imovel, mudou: false }
    const atualizado = await atualizarImovel(imovel.id, mudancas)
    ultimo.current = atualizado
    reset(formDoImovel(atualizado))
    qc.setQueryData(chavesImoveis.item(atualizado.id), atualizado)
    void invalidarLista()
    return { registro: atualizado, mudou: true }
  }

  async function recarregar(id: string) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: chavesImoveis.item(id) }),
      qc.invalidateQueries({ queryKey: chavesImoveis.historico(id) }),
      invalidarLista(),
    ])
  }

  function marcarFaltando(campos: CampoObrigatorioImovel[]) {
    setFaltando(campos)
    const mensagem = mensagemFalta(atual.status)
    for (const c of campos) setError(c, { type: 'servidor', message: mensagem })
  }

  /** Campos do IMV-2 que o servidor devolveu em CAMPOS_OBRIGATORIOS (vazio para outros erros). */
  const camposDoErro = (e: unknown) => listaDoDetalhe(traduzirErro(e), 'campos').filter(ehCampoObrigatorio)

  async function aoSalvar(f: FormImovel) {
    try {
      const { registro, mudou } = await gravar(f)
      setFaltando([])
      if (!imovel) {
        toast.success('Rascunho salvo. Agora você já pode enviar as fotos.')
        navigate(`${base}/imoveis/${registro.id}`, { replace: true })
      } else if (mudou) {
        toast.success('Alterações salvas.')
      } else {
        toast.info('Nenhuma alteração para salvar.')
      }
    } catch (e) {
      toast.error(mensagemErro(e))
      // fora do rascunho o servidor recusa esvaziar campo do IMV-2 (gatilho imoveis_campos_obrigatorios)
      const campos = camposDoErro(e)
      if (campos.length) marcarFaltando(campos)
    }
  }

  // §7.3: em NC, link para o contrato do imóvel (procurado só no clique: a consulta de contratos é auditada)
  async function abrirContrato() {
    if (!imovel) return
    setAbrindoContrato(true)
    try {
      const contrato = await contratoDoImovel(imovel)
      if (contrato) {
        navigate(`${base}/contratos/${contrato}`)
      } else {
        toast.info('O contrato deste imóvel não está entre os que você acompanha.')
        navigate(`${base}/contratos`)
      }
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setAbrindoContrato(false)
    }
  }

  async function aoFinalizar(f: FormImovel) {
    let registro: RegistroImovel
    try {
      registro = (await gravar(f)).registro
    } catch (e) {
      toast.error(mensagemErro(e))
      return
    }
    try {
      await imovelMudarStatus({ p_id: registro.id, p_para: 'pendente', p_obs: null })
      setFaltando([])
      await recarregar(registro.id)
      toast.success('Cadastro finalizado. O imóvel foi para a revisão da equipe Arken.')
      if (!imovel) navigate(`${base}/imoveis/${registro.id}`, { replace: true })
    } catch (e) {
      const campos = camposDoErro(e)
      toast.error(mensagemErro(e))
      // o rascunho novo já foi gravado: segue para a página dele, com os campos faltando marcados
      if (!imovel) navigate(`${base}/imoveis/${registro.id}`, { replace: true, state: { faltando: campos } })
      else if (campos.length) marcarFaltando(campos)
    }
  }

  // handleSubmit só no evento (valida pelo esquema e marca os erros antes de gravar)
  const salvar = (e?: BaseSyntheticEvent) => handleSubmit(aoSalvar)(e)
  const finalizarCadastro = () => handleSubmit(aoFinalizar)()

  function preencherEndereco(e: EnderecoCep) {
    const opcoes = { shouldDirty: true, shouldValidate: isSubmitted }
    if (e.logradouro) setValue('logradouro', e.logradouro, opcoes)
    if (e.bairro) setValue('bairro', e.bairro, opcoes)
    if (e.cidade) setValue('cidade', e.cidade, opcoes)
    if (e.uf) setValue('uf', e.uf, opcoes)
    if (e.complemento && !getValues('complemento').trim()) setValue('complemento', e.complemento, opcoes)
  }

  const tiposOpcoes = (tipos.data ?? []).filter((t) => t.ativo || t.codigo === imovel?.tipo)
  const ocupado = isSubmitting
  const titulo = imovel ? imovel.nome?.trim() || 'Imóvel sem nome' : 'Cadastrar imóvel'

  return (
    <section>
      <CabecalhoPagina
        titulo={titulo}
        eyebrow={imovel ? `Imóvel ${codigoExibicao(imovel.codigo)}` : 'Imóveis'}
        voltar={{ para: `${base}/imoveis`, rotulo: 'Imóveis' }}
        acoes={imovel ? (
          <span className="flex flex-wrap items-center gap-2">
            <SeloStatus tipo="imovel" valor={imovel.status} />
            {imovel.inativado_em && <Etiqueta tom="erro">Inativado</Etiqueta>}
          </span>
        ) : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-6">
          {imovel?.inativado_em && (
            <Aviso tom="erro" titulo={`Imóvel inativado em ${dataHora(imovel.inativado_em)}`}>
              {imovel.motivo_inativacao ? `Motivo: ${imovel.motivo_inativacao}` : 'Sem motivo registrado.'}
            </Aviso>
          )}
          {imovel?.status === 'rascunho' && imovel.observacao_revisao && !imovel.inativado_em && (
            <Aviso tom="alerta" titulo="Devolvido pela equipe Arken para ajustes">
              <p className="whitespace-pre-line">{imovel.observacao_revisao}</p>
            </Aviso>
          )}
          {travado && (
            <Aviso tom="neutro" titulo="Imóvel em contrato">
              O valor fica travado enquanto o contrato estiver em andamento (IMV-3).{' '}
              {tem('contratos.ver') && (
                <button type="button" className="font-semibold text-bronze hover:underline disabled:opacity-60"
                  disabled={abrindoContrato} onClick={() => void abrirContrato()}>
                  {abrindoContrato ? 'Procurando o contrato…' : 'Ver contrato'}
                </button>
              )}
            </Aviso>
          )}
          {imovel && !editavel && !imovel.inativado_em && (
            <Aviso tom="neutro">
              {imovel.criado_por === usuario.profileId && ['em_revisao', 'aprovado', 'no_contrato'].includes(imovel.status)
                ? 'O cadastro já foi finalizado: a partir daqui só a equipe Arken altera os dados.'
                : 'Você pode ver este imóvel, mas não pode alterá-lo.'}
            </Aviso>
          )}
          {faltando.length > 0 && (
            <div role="alert" className="border border-perigo/30 bg-perigo/10 px-5 py-4 text-sm text-perigo">
              <p className="font-semibold">
                {atual.status === 'rascunho' ? 'Para finalizar o cadastro, preencha:' : 'Estes campos não podem ficar vazios depois de finalizado o cadastro:'}
              </p>
              <ul className="mt-1 list-inside list-disc">
                {faltando.map((c) => <li key={c}>{ROTULOS[c]}</li>)}
              </ul>
            </div>
          )}

          <form id="form-imovel" onSubmit={salvar} noValidate aria-label="Dados do imóvel">
            <fieldset disabled={!editavel || ocupado} className="grid gap-6">
              <Secao titulo="Identificação" Titulo={Titulo}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Campo label={ROTULOS.nome} obrigatorio erro={errors.nome?.message}>
                      <input className="input" maxLength={200} autoComplete="off" aria-invalid={!!errors.nome || undefined} {...register('nome')} />
                    </Campo>
                  </div>
                  <Campo label="Matrícula (cartório)" erro={errors.matricula?.message}>
                    <input className="input" maxLength={100} autoComplete="off" {...register('matricula')} />
                  </Campo>
                  <Campo label={ROTULOS.tipo} obrigatorio erro={errors.tipo?.message}>
                    {/* controlado: as opções chegam depois do valor (consulta dos tipos), e o select precisa refletir o valor */}
                    <Controller control={control} name="tipo" render={({ field }) => (
                      <select className="input" aria-invalid={!!errors.tipo || undefined} name={field.name} ref={field.ref}
                        value={field.value} onChange={field.onChange} onBlur={field.onBlur}>
                        <option value="">{tipos.isPending ? 'Carregando…' : 'Selecione'}</option>
                        {tiposOpcoes.map((t) => <option key={t.codigo} value={t.codigo}>{t.rotulo}</option>)}
                        {tipos.isSuccess && imovel?.tipo && !tiposOpcoes.some((t) => t.codigo === imovel.tipo) && (
                          <option value={imovel.tipo}>{imovel.tipo}</option>
                        )}
                      </select>
                    )} />

                  </Campo>
                  <div className="sm:col-span-2">
                    <Campo label="Descrição" erro={errors.descricao?.message}>
                      <textarea className="input" rows={5} maxLength={10000} {...register('descricao')} />
                    </Campo>
                  </div>
                </div>
              </Secao>

              <Secao titulo="Endereço" Titulo={Titulo}>
                <div className="grid gap-4 sm:grid-cols-6">
                  <div className="sm:col-span-2">
                    <Campo label={ROTULOS.cep} obrigatorio erro={errors.cep?.message}>
                      <Controller control={control} name="cep" render={({ field }) => (
                        <CampoCep valor={field.value} aoMudar={field.onChange} aoEncontrar={preencherEndereco}
                          desabilitado={!editavel || ocupado} invalido={!!errors.cep} />
                      )} />
                    </Campo>
                  </div>
                  <div className="sm:col-span-2">
                    <Campo label="País" erro={errors.pais?.message}>
                      <input className="input" maxLength={60} {...register('pais')} />
                    </Campo>
                  </div>
                  <div className="sm:col-span-2">
                    <Campo label={ROTULOS.uf} obrigatorio erro={errors.uf?.message}>
                      <select className="input" aria-invalid={!!errors.uf || undefined} {...register('uf')}>
                        <option value="">Selecione</option>
                        {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                      </select>
                    </Campo>
                  </div>
                  <div className="sm:col-span-3">
                    <Campo label={ROTULOS.cidade} obrigatorio erro={errors.cidade?.message}>
                      <input className="input" maxLength={100} aria-invalid={!!errors.cidade || undefined} {...register('cidade')} />
                    </Campo>
                  </div>
                  <div className="sm:col-span-3">
                    <Campo label="Bairro" erro={errors.bairro?.message}>
                      <input className="input" maxLength={100} {...register('bairro')} />
                    </Campo>
                  </div>
                  <div className="sm:col-span-4">
                    <Campo label={ROTULOS.logradouro} obrigatorio erro={errors.logradouro?.message}>
                      <input className="input" maxLength={200} aria-invalid={!!errors.logradouro || undefined} {...register('logradouro')} />
                    </Campo>
                  </div>
                  <div className="sm:col-span-2">
                    <Campo label={ROTULOS.numero} obrigatorio erro={errors.numero?.message}>
                      <input className="input" maxLength={20} aria-invalid={!!errors.numero || undefined} {...register('numero')} />
                    </Campo>
                  </div>
                  <div className="sm:col-span-6">
                    <Campo label="Complemento" erro={errors.complemento?.message}>
                      <input className="input" maxLength={100} {...register('complemento')} />
                    </Campo>
                  </div>
                </div>
              </Secao>

              <Secao titulo="Características" Titulo={Titulo}>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-3 sm:max-w-sm">
                    <Campo label={ROTULOS.valor} obrigatorio erro={errors.valor?.message}>
                      <Controller control={control} name="valor" render={({ field }) => (
                        <CampoMoeda valor={field.value} aoMudar={field.onChange} desabilitado={!editavel || travado || ocupado}
                          invalido={!!errors.valor} />
                      )} />
                    </Campo>
                    {travado && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Lock size={12} aria-hidden /> Travado: imóvel em contrato.</p>
                    )}
                  </div>
                  <Campo label="Área total (m²)" erro={errors.area_total?.message}>
                    <input className="input" inputMode="decimal" placeholder="Ex.: 120,5" {...register('area_total')} />
                  </Campo>
                  <Campo label="Área construída (m²)" erro={errors.area_construida?.message}>
                    <input className="input" inputMode="decimal" placeholder="Ex.: 98" {...register('area_construida')} />
                  </Campo>
                  <Campo label="Idade do imóvel (anos)" erro={errors.idade_anos?.message}>
                    <input className="input" inputMode="numeric" {...register('idade_anos')} />
                  </Campo>
                  <Campo label="Andar" erro={errors.andar?.message}>
                    <input className="input" maxLength={20} placeholder="Ex.: 5º ou térreo" {...register('andar')} />
                  </Campo>
                  <Campo label="Quartos" erro={errors.quartos?.message}>
                    <input className="input" inputMode="numeric" {...register('quartos')} />
                  </Campo>
                  <Campo label="Banheiros" erro={errors.banheiros?.message}>
                    <input className="input" inputMode="numeric" {...register('banheiros')} />
                  </Campo>
                  <Campo label="Suítes" erro={errors.suites?.message}>
                    <input className="input" inputMode="numeric" {...register('suites')} />
                  </Campo>
                  <Campo label="Vagas de garagem" erro={errors.vagas?.message}>
                    <input className="input" inputMode="numeric" {...register('vagas')} />
                  </Campo>
                </div>
              </Secao>

              <Secao titulo="Adicionais" Titulo={Titulo} extra={<SeloProvisorio codigo="E5" />}>
                <fieldset>
                  <legend className="sr-only">Adicionais do imóvel</legend>
                  <div className="flex flex-wrap gap-2">
                    {ADICIONAIS.map((a) => (
                      <label key={a} className="cursor-pointer">
                        <input type="checkbox" value={a} className="peer sr-only" {...register('adicionais')} />
                        <span className="inline-block border border-line bg-ink-soft px-3 py-1.5 text-sm transition peer-checked:border-stone peer-checked:bg-stone peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-bronze peer-disabled:cursor-default peer-disabled:opacity-70">
                          {ADICIONAIS_IMOVEL[a]}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </Secao>
            </fieldset>

            {(editavel || finalizar) && (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {editavel && (
                  <button type="submit" className={finalizar ? 'btn-ghost' : 'btn-primary'} disabled={ocupado}>
                    {ocupado ? 'Aguarde…' : !imovel || imovel.status === 'rascunho' ? 'Salvar rascunho' : 'Salvar alterações'}
                  </button>
                )}
                {finalizar && (
                  <button type="button" className="btn-primary" disabled={ocupado} onClick={() => void finalizarCadastro()}>
                    Finalizar cadastro
                  </button>
                )}
                {imovel && isDirty && (
                  <button type="button" className="text-sm text-muted hover:text-stone" disabled={ocupado}
                    onClick={() => { reset(formDoImovel(imovel)); setFaltando([]) }}>
                    Descartar alterações
                  </button>
                )}
                <p className="w-full text-xs text-muted">
                  <span className="text-bronze">*</span> obrigatório para finalizar o cadastro; o rascunho pode ficar incompleto.
                </p>
              </div>
            )}
          </form>

          {imovel ? (
            <FotosImovel imovel={imovel} usuario={usuario} Titulo={Titulo} />
          ) : (
            <Secao titulo="Fotos" Titulo={Titulo}>
              <p className="text-sm text-muted">Salve o rascunho para enviar as fotos.</p>
            </Secao>
          )}
        </div>

        <aside className="grid content-start gap-6">
          <section className="card p-5" aria-labelledby="titulo-situacao">
            <Titulo id="titulo-situacao" className="mb-3 flex items-center gap-2 text-base font-semibold">
              Situação <SeloProvisorio codigo="E2" />
            </Titulo>
            {imovel ? (
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted">Status</dt><dd><SeloStatus tipo="imovel" valor={imovel.status} /></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Código</dt><dd>{codigoExibicao(imovel.codigo)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Cadastrado em</dt><dd>{dataHora(imovel.criado_em)}</dd></div>
                {imovel.atualizado_em && (
                  <div className="flex justify-between gap-3"><dt className="text-muted">Atualizado em</dt><dd>{dataHora(imovel.atualizado_em)}</dd></div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted">
                O imóvel começa como rascunho e pode ficar incompleto. Ao finalizar o cadastro, ele vai para a revisão da
                equipe Arken; depois de aprovado, aparece para todos os parceiros.
              </p>
            )}

            {(outras.length > 0 || (imovel && usuario.interno && !imovel.inativado_em && imovel.status !== 'no_contrato')) && (
              <div className="mt-4 grid gap-2 border-t border-line pt-4">
                {outras.map((t) => (
                  <button key={`${t.de}>${t.para}`} type="button" disabled={isDirty || ocupado} onClick={() => setAcao(t)}
                    className={t.para === 'aprovado' ? 'btn-primary' : 'btn-ghost'}>
                    {rotuloTransicao(t)}
                  </button>
                ))}
                {imovel && usuario.interno && !imovel.inativado_em && imovel.status !== 'no_contrato' && (
                  <button type="button" className="btn-ghost text-perigo" disabled={ocupado} onClick={() => setInativando(true)}>
                    <Ban size={16} aria-hidden /> Inativar imóvel
                  </button>
                )}
                {isDirty && outras.length > 0 && <p className="text-xs text-muted">Salve as alterações antes de mudar o status.</p>}
              </div>
            )}
          </section>

          {imovel && usuario.interno && <HistoricoImovel imovelId={imovel.id} Titulo={Titulo} />}
        </aside>
      </div>

      {imovel && (
        <ConfirmarModal
          aberto={!!acao}
          titulo={acao ? rotuloTransicao(acao) : ''}
          texto={acao ? TEXTOS_TRANSICAO[`${acao.de}>${acao.para}`] : undefined}
          rotuloConfirmar={acao ? rotuloTransicao(acao) : 'Confirmar'}
          motivo={acao && precisaObservacao(acao)
            ? { rotulo: 'Observação para quem cadastrou', minimo: OBSERVACAO_MINIMA, placeholder: 'Ex.: faltam as fotos da fachada e a matrícula.' }
            : undefined}
          aoFechar={() => setAcao(null)}
          aoConfirmar={async (obs) => {
            if (!acao) return
            try {
              await imovelMudarStatus({ p_id: imovel.id, p_para: acao.para as RegistroImovel['status'], p_obs: obs })
            } catch (e) {
              // IMV-2 também na revisão e na aprovação: fecha a confirmação e marca os campos (o modal mostra o erro)
              const campos = camposDoErro(e)
              if (campos.length) {
                marcarFaltando(campos)
                setAcao(null)
              }
              throw e
            }
            await recarregar(imovel.id)
            toast.success(SUCESSO_TRANSICAO[`${acao.de}>${acao.para}`] ?? 'Status alterado.')
          }}
        />
      )}

      {imovel && (
        <ConfirmarModal
          aberto={inativando}
          titulo="Inativar imóvel"
          perigo
          rotuloConfirmar="Inativar"
          texto="O imóvel sai da lista dos parceiros e não pode entrar em contratos novos. Imóvel com contrato em andamento não pode ser inativado."
          motivo={{ minimo: MOTIVO_INATIVACAO_MINIMO, placeholder: 'Ex.: o proprietário desistiu da venda.' }}
          aoFechar={() => setInativando(false)}
          aoConfirmar={async (motivo) => {
            await imovelInativar({ p_id: imovel.id, p_motivo: motivo ?? '' })
            await recarregar(imovel.id)
            toast.success('Imóvel inativado.')
          }}
        />
      )}
    </section>
  )
}

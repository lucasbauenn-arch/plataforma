// Tradução dos erros do Supabase (PostgREST, Auth, rede) para mensagens em pt-BR.
//
// Convenção das RPCs (docs/ARQUITETURA_EXPANSAO.md §4.4 e §4.6):
// - sem acesso ou registro inexistente: `raise exception 'Sem acesso a este registro' using errcode = '42501'`
//   (mesma mensagem nos dois casos, para não revelar existência);
// - função inexistente ou fora do ar (`0A000` dos antigos esqueletos, `PGRST202` do PostgREST quando a RPC não está no
//   cache de esquema): `NAO_IMPLEMENTADO`, exibida como indisponibilidade temporária;
// - regra de negócio com código: `raise exception '<CODIGO>' using errcode = 'P0001', detail = '<json opcional>'`,
//   onde <CODIGO> é um dos `CodigoErro` abaixo (maiúsculas com `_`); o `detail` em JSON leva dados estruturados
//   (ex.: `{"campos":["nome","cep"]}` em `CAMPOS_OBRIGATORIOS`, `{"motivos":[...]}` em `SIMULACAO_INVALIDA`,
//   `{"validacoes":[...]}` em `VALIDACAO_FALHOU`);
// - regra de negócio com frase pronta: `raise exception '<frase em pt-BR>' using errcode = 'P0001'` → exibida como veio.

export type CodigoErro =
  | 'SEM_ACESSO'
  | 'NAO_IMPLEMENTADO'
  | 'LIMITE_DUPLICIDADE'
  | 'DOCUMENTO_INDISPONIVEL'
  | 'MOTIVO_OBRIGATORIO'
  | 'TRANSICAO_INVALIDA'
  | 'VALIDACAO_FALHOU'
  | 'CAMPOS_OBRIGATORIOS'
  | 'SIMULACAO_INVALIDA'
  | 'PRODUTO_INDISPONIVEL'
  | 'CONTRATO_ATIVO'
  | 'CONFLITO_VERSAO'
  | 'ENVIO_EM_ANDAMENTO'
  | 'DESTINO_INVALIDO'
  | 'DESCENDENTES_ATIVOS'
  | 'LIMITE_FOTOS'
  | 'ARQUIVO_INVALIDO'
  | 'TERMO_DESATUALIZADO'
  | 'EMAIL_EM_USO'
  | 'LIMITE_CONVITES'
  | 'ULTIMO_SUPER'
  | 'ACESSO_INATIVO'
  | 'DADOS_INVALIDOS'
  | 'REGISTRO_DUPLICADO'
  | 'SESSAO_EXPIRADA'
  | 'SEM_CONEXAO'
  | 'DESCONHECIDO'

export const MENSAGENS: Record<CodigoErro, string> = {
  SEM_ACESSO: 'Você não tem acesso a este registro.',
  NAO_IMPLEMENTADO: 'Esta função não está disponível no momento. Recarregue a página e tente de novo.',
  LIMITE_DUPLICIDADE: 'Muitas tentativas com documentos já cadastrados. Aguarde uma hora e tente de novo.',
  DOCUMENTO_INDISPONIVEL: 'Este documento não está disponível para cadastro. Se precisar de ajuda, fale com a equipe Arken.',
  MOTIVO_OBRIGATORIO: 'Informe o motivo.',
  TRANSICAO_INVALIDA: 'Esta mudança de status não é permitida.',
  VALIDACAO_FALHOU: 'Ainda faltam requisitos para concluir esta ação.',
  CAMPOS_OBRIGATORIOS: 'Preencha os campos obrigatórios.',
  SIMULACAO_INVALIDA: 'Os valores da simulação estão fora dos limites permitidos.',
  PRODUTO_INDISPONIVEL: 'Este produto não está disponível para contrato.',
  CONTRATO_ATIVO: 'Já existe um contrato ativo para este produto ou cliente.',
  CONFLITO_VERSAO: 'O registro foi alterado por outra pessoa. Recarregue a página e tente de novo.',
  ENVIO_EM_ANDAMENTO: 'Já existe um envio em andamento. Aguarde alguns minutos.',
  DESTINO_INVALIDO: 'O destino escolhido não é válido para esta operação.',
  DESCENDENTES_ATIVOS: 'Ainda há pessoas ou clientes vinculados. Transfira todos antes de continuar.',
  LIMITE_FOTOS: 'O limite de fotos deste imóvel foi atingido.',
  ARQUIVO_INVALIDO: 'Arquivo com tipo ou tamanho não permitido.',
  TERMO_DESATUALIZADO: 'O termo mudou. Recarregue a página para ver a versão vigente.',
  EMAIL_EM_USO: 'Este e-mail já tem uma conta na plataforma: nenhum convite foi gerado. Confira o e-mail cadastrado ou fale com a equipe Arken.',
  LIMITE_CONVITES: 'Muitas consultas de e-mails que já têm conta na última hora. Aguarde e tente de novo.',
  ULTIMO_SUPER: 'Não é possível remover o último Super.',
  ACESSO_INATIVO: 'Seu acesso foi encerrado. Fale com a equipe Arken.',
  DADOS_INVALIDOS: 'Alguns dados são inválidos. Confira e tente de novo.',
  REGISTRO_DUPLICADO: 'Já existe um registro com esses dados.',
  SESSAO_EXPIRADA: 'Sua sessão expirou. Entre novamente.',
  SEM_CONEXAO: 'Sem conexão com o servidor. Verifique a internet e tente de novo.',
  DESCONHECIDO: 'Não foi possível concluir a operação. Tente de novo.',
}

/** Rótulos dos nomes de campo que o servidor devolve em `detalhe.campos`. */
const ROTULOS_CAMPOS: Record<string, string> = {
  nome: 'nome', sobrenome: 'sobrenome', tipo: 'tipo', cep: 'CEP', logradouro: 'logradouro', numero: 'número',
  cidade: 'cidade', uf: 'estado', valor: 'valor', email: 'e-mail', telefone: 'telefone', cpf: 'CPF', cnpj: 'CNPJ',
  creci: 'CRECI', creci_pj: 'CRECI PJ', matricula: 'matrícula', bairro: 'bairro', complemento: 'complemento',
  rg: 'RG', razao_social: 'razão social', tipo_pessoa: 'tipo de pessoa', corretor_id: 'corretor responsável',
  responsavel_id: 'responsável', data_nascimento: 'data de nascimento', emails_adicionais: 'e-mails adicionais',
  telefones_adicionais: 'telefones adicionais', interesses: 'interesses', unidade_id: 'unidade', empreendimento_id: 'empreendimento',
  texto: 'texto', descricao: 'descrição', prazo: 'prazo', titulo: 'título', motivo: 'motivo', estado_civil: 'estado civil',
  profissao: 'profissão', nacionalidade: 'nacionalidade', produto: 'produto', formatos_aceitos: 'formatos aceitos',
  periodo_de: 'início do período', periodo_ate: 'fim do período', resposta_admin: 'resposta', versao: 'versão',
}

/** Valor de um mapa de rótulos só para chave própria (nunca `constructor`, `toString`… do protótipo). */
const doMapa = (mapa: Record<string, string>, chave: string): string | undefined => (Object.hasOwn(mapa, chave) ? mapa[chave] : undefined)

export const rotuloCampo = (campo: string) => doMapa(ROTULOS_CAMPOS, campo) ?? campo.replace(/_/g, ' ')

/** Rótulos conhecidos de `detalhe.campos`; nomes internos (`p_dados`, `filtros`…) ficam de fora da mensagem. */
const rotulosConhecidos = (campos: string[]) => campos.map((c) => doMapa(ROTULOS_CAMPOS, c)).filter((r): r is string => !!r)

/** Formatos de arquivo em `detalhe.formatos_aceitos` (`ARQUIVO_INVALIDO`). */
const ROTULOS_FORMATOS: Record<string, string> = {
  jpeg: 'JPG', jpg: 'JPG', png: 'PNG', webp: 'WebP', pdf: 'PDF', doc: 'DOC', docx: 'DOCX', xls: 'XLS', xlsx: 'XLSX', csv: 'CSV',
}

/** `detalhe.motivo` do erro `ARQUIVO_INVALIDO` (envio de documento e de foto). */
const MENSAGENS_ARQUIVO: Record<string, string> = {
  caminho: 'O arquivo não foi enviado para o lugar esperado. Tente enviar de novo.',
  ja_registrado: 'Este arquivo já foi registrado.',
  nao_encontrado: 'O arquivo não chegou ao servidor. Tente enviar de novo.',
  autor: 'O arquivo precisa ser enviado pela mesma pessoa que registra o envio. Tente enviar de novo.',
  tamanho: 'O arquivo passa do tamanho permitido.',
  tipo: 'Tipo de arquivo não permitido.',
  tamanho_ou_tipo: 'Arquivo com tipo ou tamanho não permitido.',
}

/** `detalhe.motivo` do erro `DESTINO_INVALIDO` (transferências e inativação na rede). */
const MENSAGENS_DESTINO: Record<string, string> = {
  gerente: 'O gerente de destino não é válido para esta operação.',
  gerente_como_corretor: 'Este gerente não pode receber clientes diretamente.',
  destino_obrigatorio: 'Escolha para onde vão os clientes e corretores antes de continuar.',
  carteira: 'A carteira de destino não é válida para esta operação.',
}

const megabytes = (bytes: number) => `${Number((bytes / (1024 * 1024)).toFixed(1)).toLocaleString('pt-BR')} MB`

/** Validações de `status_transicoes` (§3.8) em `detalhe.validacoes` do erro `VALIDACAO_FALHOU`. */
const ROTULOS_VALIDACOES: Record<string, string> = {
  contrato_assinado: 'contrato assinado',
  campos_obrigatorios_imovel: 'campos obrigatórios do imóvel',
  pdf_gerado: 'PDF do contrato gerado e atualizado',
  signatarios_configurados: 'signatários configurados',
  vendedora_configurada: 'dados da Arken como vendedora',
  modelo_liberado: 'modelo de contrato liberado para envio',
  email_cliente: 'e-mail do cliente',
  valor_produto_atual: 'valor do contrato igual ao valor atual do produto',
  arquivo_enviado: 'arquivo enviado',
}

/** Motivos em `detalhe.motivos` do erro `SIMULACAO_INVALIDA`. */
const ROTULOS_MOTIVOS_SIMULACAO: Record<string, string> = {
  n_parcelas_fora_do_limite: 'número de parcelas fora do limite',
  entrada_maior_que_aporte: 'entrada maior que o aporte',
  entrada_invalida: 'entrada inválida',
  valor_abaixo_do_minimo: 'valor abaixo do mínimo',
  flexivel_sem_minimo: 'plano flexível sem valor mínimo configurado',
  percentual_invalido: 'percentual de aporte inválido',
  produto_sem_valor: 'produto sem valor',
  forma_invalida: 'forma de pagamento inválida',
}

const CODIGOS = new Set(Object.keys(MENSAGENS))
const ehCodigo = (m: string): m is CodigoErro => CODIGOS.has(m)

export class ErroRpc extends Error {
  readonly codigo: CodigoErro
  /** SQLSTATE do Postgres, código `PGRST…` ou nulo (rede/Auth). */
  readonly sqlstate: string | null
  /** `detail` do `raise`, já convertido de JSON quando possível. */
  readonly detalhe: unknown
  /** Nome da RPC que falhou, quando conhecido. */
  readonly rpc: string | null

  constructor(codigo: CodigoErro, mensagem: string, opcoes: { sqlstate?: string | null; detalhe?: unknown; rpc?: string | null } = {}) {
    super(mensagem)
    this.name = 'ErroRpc'
    this.codigo = codigo
    this.sqlstate = opcoes.sqlstate ?? null
    this.detalhe = opcoes.detalhe ?? null
    this.rpc = opcoes.rpc ?? null
  }
}

interface ErroBruto { code?: unknown; message?: unknown; details?: unknown; hint?: unknown; status?: unknown; name?: unknown }

function lerDetalhe(d: unknown): unknown {
  if (typeof d !== 'string' || d === '') return d ?? null
  try { return JSON.parse(d) } catch { return d }
}

const ehFalhaDeRede = (m: string) => /failed to fetch|networkerror|fetch failed|load failed|network request failed/i.test(m)

/** Lista de strings em `detalhe[chave]`, se houver. */
export function listaDoDetalhe(e: unknown, chave: string): string[] {
  const d = e instanceof ErroRpc ? e.detalhe : null
  if (d && typeof d === 'object' && Array.isArray((d as Record<string, unknown>)[chave])) {
    return ((d as Record<string, unknown>)[chave] as unknown[]).filter((x): x is string => typeof x === 'string')
  }
  return []
}

const listaTexto = (d: unknown, chave: string): string[] => {
  const v = d && typeof d === 'object' ? (d as Record<string, unknown>)[chave] : null
  return Array.isArray(v) ? v.map(String) : []
}

const textoDoDetalhe = (d: unknown, chave: string): string | null => {
  const v = d && typeof d === 'object' ? (d as Record<string, unknown>)[chave] : null
  return typeof v === 'string' && v ? v : null
}

const numeroDoDetalhe = (d: unknown, chave: string): number | null => {
  const v = d && typeof d === 'object' ? (d as Record<string, unknown>)[chave] : null
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function mensagemDoCodigo(codigo: CodigoErro, detalhe: unknown): string {
  if (codigo === 'CAMPOS_OBRIGATORIOS') {
    const campos = listaTexto(detalhe, 'campos')
    if (campos.length) return `Preencha os campos obrigatórios: ${campos.map(rotuloCampo).join(', ')}.`
  }
  if (codigo === 'VALIDACAO_FALHOU') {
    const v = listaTexto(detalhe, 'validacoes')
    if (v.length) return `Ainda falta: ${v.map((x) => doMapa(ROTULOS_VALIDACOES, x) ?? x.replace(/_/g, ' ')).join('; ')}.`
  }
  if (codigo === 'SIMULACAO_INVALIDA') {
    const m = listaTexto(detalhe, 'motivos')
    if (m.length) return `Simulação fora dos limites: ${m.map((x) => doMapa(ROTULOS_MOTIVOS_SIMULACAO, x) ?? x.replace(/_/g, ' ')).join('; ')}.`
  }
  if (codigo === 'DADOS_INVALIDOS') {
    const rotulos = rotulosConhecidos(listaTexto(detalhe, 'campos'))
    if (rotulos.length) return `Confira ${rotulos.length === 1 ? 'o campo' : 'os campos'}: ${rotulos.join(', ')}.`
  }
  if (codigo === 'DESTINO_INVALIDO') {
    const motivo = textoDoDetalhe(detalhe, 'motivo')
    const porMotivo = motivo ? doMapa(MENSAGENS_DESTINO, motivo) : undefined
    if (porMotivo) return porMotivo
    if (listaTexto(detalhe, 'campos').includes('responsavel_id')) return 'O responsável escolhido não tem acesso a este cliente.'
  }
  if (codigo === 'ARQUIVO_INVALIDO') {
    const motivo = textoDoDetalhe(detalhe, 'motivo')
    const base = (motivo ? doMapa(MENSAGENS_ARQUIVO, motivo) : undefined) ?? MENSAGENS.ARQUIVO_INVALIDO
    const max = numeroDoDetalhe(detalhe, 'max_bytes')
    const formatos = [...new Set(listaTexto(detalhe, 'formatos_aceitos').map((f) => doMapa(ROTULOS_FORMATOS, f) ?? f.toUpperCase()))]
    const extras = [
      max && (motivo === 'tamanho' || motivo === 'tamanho_ou_tipo') ? `Limite: ${megabytes(max)}.` : null,
      formatos.length && motivo === 'tipo' ? `Formatos aceitos: ${formatos.join(', ')}.` : null,
    ].filter(Boolean)
    return [base, ...extras].join(' ')
  }
  return MENSAGENS[codigo]
}

/** Mensagens nativas do Postgres (em inglês, com nomes internos): nunca vão para a tela. */
const ehMensagemNativa = (m: string) =>
  /violates|duplicate key|null value in column|invalid input|value too long|out of range|does not exist|is not present in table|permission denied|syntax error/i.test(m)

/** Converte qualquer erro vindo do supabase-js (ou lançado) em `ErroRpc` com mensagem em pt-BR. */
export function traduzirErro(e: unknown, rpc?: string): ErroRpc {
  if (e instanceof ErroRpc) return e
  const bruto: ErroBruto = e && typeof e === 'object' ? (e as ErroBruto) : { message: String(e ?? '') }
  const sqlstate = typeof bruto.code === 'string' && bruto.code !== '' ? bruto.code : null
  const mensagem = typeof bruto.message === 'string' ? bruto.message.trim() : ''
  const detalhe = lerDetalhe(bruto.details)
  const status = typeof bruto.status === 'number' ? bruto.status : null
  const cria = (codigo: CodigoErro, msg = mensagemDoCodigo(codigo, detalhe)) => new ErroRpc(codigo, msg, { sqlstate, detalhe, rpc })

  if (mensagem.includes('ACESSO_INATIVO')) return cria('ACESSO_INATIVO')
  if (sqlstate === '42501') return cria('SEM_ACESSO')
  if (sqlstate === '0A000' || sqlstate === 'PGRST202') return cria('NAO_IMPLEMENTADO')
  if (sqlstate === 'PGRST301' || sqlstate === 'PGRST303' || status === 401) return cria('SESSAO_EXPIRADA')
  if (ehCodigo(mensagem)) return cria(mensagem)
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(mensagem)) return cria('DESCONHECIDO', `${MENSAGENS.DESCONHECIDO} (${mensagem})`)
  if (sqlstate === '23505') return cria('REGISTRO_DUPLICADO')
  if (sqlstate === 'P0001' && mensagem) return cria('DESCONHECIDO', mensagem)
  // classes 22 (dados) e 23 (integridade): as regras dos gatilhos levantam frases em pt-BR, que vão para a tela;
  // as violações nativas (em inglês, com nomes de constraint) viram a mensagem genérica
  if (sqlstate && /^2[23]/.test(sqlstate)) return mensagem && !ehMensagemNativa(mensagem) ? cria('DADOS_INVALIDOS', mensagem) : cria('DADOS_INVALIDOS')
  if (!sqlstate && ehFalhaDeRede(mensagem)) return cria('SEM_CONEXAO')
  return cria('DESCONHECIDO')
}

/** Mensagem pronta para `toast.error`. */
export const mensagemErro = (e: unknown) => traduzirErro(e).message

export const ehSemAcesso = (e: unknown) => traduzirErro(e).codigo === 'SEM_ACESSO'
export const ehNaoImplementado = (e: unknown) => traduzirErro(e).codigo === 'NAO_IMPLEMENTADO'

/**
 * Erro de `supabase.functions.invoke`: as Edge Functions respondem `{ erro: string }` (pt-BR) no corpo.
 * Lê o corpo quando existir; senão, traduz o erro genérico.
 */
export async function mensagemErroEdge(e: unknown): Promise<string> {
  const contexto = (e as { context?: { json?: () => Promise<unknown> } } | null)?.context
  if (contexto?.json) {
    const corpo = await contexto.json().catch(() => null) as { erro?: unknown } | null
    if (corpo && typeof corpo.erro === 'string' && corpo.erro) return corpo.erro
  }
  return mensagemErro(e)
}

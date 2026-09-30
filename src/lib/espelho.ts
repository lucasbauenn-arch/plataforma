import type { StatusUnidade } from './types'

export interface LinhaEspelho {
  identificador: string
  metragem: number | null
  valor: number | null
  /** Status do arquivo; ausente ou desconhecido vale `disponivel`, mas só para unidade NOVA (ver `statusInformado`). */
  status: StatusUnidade
  /** O arquivo trazia um status reconhecido. Sem ele, o status de uma unidade que já existe NÃO é alterado. */
  statusInformado: boolean
  /** A coluna de status tinha texto que não é nenhum dos três status (ex.: "bloqueada"). */
  statusDesconhecido: boolean
}

const STATUS: StatusUnidade[] = ['disponivel', 'reservada', 'vendida']

/** Número no formato brasileiro ou americano: "R$ 280.000,00", "52,5", "1.250.000", "52.50" → number. */
export function numeroBR(v: string | null | undefined): number | null {
  if (!v) return null
  const limpo = v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (!limpo || limpo === '-' || limpo === '.') return null
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

/**
 * Espelho de vendas exportado de planilha (Excel/Notion): unidade; metragem; valor; status.
 * O separador é detectado no arquivo — ";" (Excel pt-BR), TAB ou "," — para não quebrar decimais como "52,5".
 * Ignora cabeçalho e linhas vazias; status ausente ou desconhecido vira "disponivel" para unidade nova, mas
 * `statusInformado` fica falso: a importação não usa esse valor para mexer numa unidade que já existe.
 */
export function lerEspelhoVendas(texto: string): LinhaEspelho[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim())
  const amostra = linhas.slice(0, 5).join('\n')
  const sep = amostra.includes(';') ? ';' : amostra.includes('\t') ? '\t' : ','
  return linhas
    .map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '').trim()))
    .filter((c) => c[0] && !/^(apto|apartamento|unidade|unid\.?)$/i.test(c[0]))
    .map((c) => {
      const s = (c[3] ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() as StatusUnidade
      const informado = STATUS.includes(s)
      return {
        identificador: c[0], metragem: numeroBR(c[1]), valor: numeroBR(c[2]),
        status: informado ? s : 'disponivel', statusInformado: informado, statusDesconhecido: !informado && s.length > 0,
      }
    })
}

// ---------- importação sem apagar nada ----------

/** Unidade como está no cadastro (só o que a importação compara). */
export interface UnidadeCadastrada { id: string; identificador: string; metragem: number | null; valor: number | null; status: StatusUnidade }

/** Campos que a importação altera numa unidade que já existe (só os que mudam de fato). */
export interface AlteracaoUnidade { metragem?: number; valor?: number; status?: StatusUnidade }

export interface PlanoImportacao {
  /** Unidades que o cadastro ainda não tem: viram INSERT. */
  criar: { identificador: string; metragem: number | null; valor: number | null; status: StatusUnidade }[]
  /** Unidades que já existem e mudam: viram UPDATE por id (nunca apagam nem recriam). */
  atualizar: { id: string; identificador: string; campos: AlteracaoUnidade }[]
  /** Já estão iguais ao arquivo. */
  semMudanca: number
  /** Nomes repetidos no arquivo (como estão escritos): a importação inteira é recusada. */
  repetidasNoArquivo: string[]
  /** Nomes do arquivo que casam com MAIS DE UMA unidade do cadastro: não são tocados (ajuste à mão). */
  ambiguas: string[]
  /** Unidades do cadastro que o arquivo não cita: continuam como estão (nunca são apagadas). */
  foraDoArquivo: number
  /** Linhas de unidades que já existem com status escrito mas desconhecido: o status atual foi mantido. */
  statusNaoReconhecido: number
}

/** Chave de comparação do nome da unidade: sem acento, sem espaços repetidos, sem diferença de maiúsculas. */
export const chaveUnidade = (identificador: string) =>
  identificador.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()

/** `a` e `b` são o mesmo número na precisão de `casas` (metragem e valor têm 2 casas no banco). */
const mesmoNumero = (a: number | null, b: number, casas = 2) => a !== null && Math.abs(a - b) < 0.5 / 10 ** casas

/**
 * Compara o arquivo com o cadastro atual e diz o que fazer SEM apagar nada (FUX-01). A versão antiga apagava todas as
 * unidades e reinseria: com contrato, o DELETE falha (FK) e o INSERT duplicava tudo; sem contrato, tirava a unidade
 * das propostas e dos negócios do portal (ON DELETE SET NULL). Regras:
 * - a unidade é reconhecida pelo nome (`chaveUnidade`); nome igual atualiza o registro que já existe;
 * - célula vazia (metragem ou valor) e status ausente ou desconhecido NÃO apagam nem trocam o dado atual;
 * - unidade que só existe no cadastro fica como está;
 * - nome repetido no arquivo recusa a importação; nome que casa com duas unidades do cadastro é ignorado.
 */
export function planejarImportacao(linhas: LinhaEspelho[], cadastro: UnidadeCadastrada[]): PlanoImportacao {
  const plano: PlanoImportacao = { criar: [], atualizar: [], semMudanca: 0, repetidasNoArquivo: [], ambiguas: [], foraDoArquivo: 0, statusNaoReconhecido: 0 }

  const contagem = new Map<string, number>()
  for (const l of linhas) {
    const k = chaveUnidade(l.identificador)
    contagem.set(k, (contagem.get(k) ?? 0) + 1)
  }
  if ([...contagem.values()].some((n) => n > 1)) {
    plano.repetidasNoArquivo = [...new Set(linhas.filter((l) => (contagem.get(chaveUnidade(l.identificador)) ?? 0) > 1).map((l) => l.identificador.trim()))]
    return plano
  }

  const porChave = new Map<string, UnidadeCadastrada[]>()
  for (const u of cadastro) {
    const k = chaveUnidade(u.identificador)
    porChave.set(k, [...(porChave.get(k) ?? []), u])
  }
  const citadas = new Set<string>()

  for (const l of linhas) {
    const existentes = porChave.get(chaveUnidade(l.identificador)) ?? []
    if (existentes.length === 0) {
      plano.criar.push({ identificador: l.identificador.trim(), metragem: l.metragem, valor: l.valor, status: l.status })
      continue
    }
    for (const u of existentes) citadas.add(u.id)
    if (existentes.length > 1) { plano.ambiguas.push(l.identificador.trim()); continue }
    const u = existentes[0]
    const campos: AlteracaoUnidade = {}
    if (l.metragem !== null && !mesmoNumero(u.metragem, l.metragem)) campos.metragem = l.metragem
    if (l.valor !== null && !mesmoNumero(u.valor, l.valor)) campos.valor = l.valor
    if (l.statusInformado && l.status !== u.status) campos.status = l.status
    if (l.statusDesconhecido) plano.statusNaoReconhecido++
    if (Object.keys(campos).length) plano.atualizar.push({ id: u.id, identificador: u.identificador, campos })
    else plano.semMudanca++
  }
  plano.foraDoArquivo = cadastro.filter((u) => !citadas.has(u.id)).length
  return plano
}

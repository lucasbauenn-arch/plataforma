// Espelho em TypeScript de `public.calcular_simulacao()` (migration 20260929000007, §3.6; FIN-1/FIN-2).
// O SQL é a ÚNICA fonte de verdade: este módulo serve só para a prévia instantânea no front (rotulada "prévia") e
// para formatar valores. Os dois são testados contra o MESMO arquivo de vetores (simulacao.vetores.json e o bloco
// VETORES do supabase/tests/contratos.test.sql); simulacao.sincronia.test.ts falha se divergirem.
//
// Módulo PURO: sem Deno.*, sem npm:, sem DOM. Roda no Deno, no Vitest (Node) e no navegador (alias @shared).
//
// Aritmética: decimal exato com BigInt (nunca float), reproduzindo o `numeric` do Postgres:
//   - round(x, n) arredonda metade para longe do zero;
//   - soma, subtração e multiplicação são exatas (escala = máx./soma das escalas);
//   - a divisão usa a escala de resultado de select_div_scale() do Postgres (NUMERIC_MIN_SIG_DIGITS = 16, dígitos em
//     base 10000) e arredonda metade para longe do zero nessa escala, como numeric_div. É por isso que
//     `round(base / n × (1 + taxa/100), 2)` dá o mesmo centavo que o banco em qualquer entrada.

export type FormaPagamento = 'parcelado' | 'flexivel'

/** Motivos de `SIMULACAO_INVALIDA` (mesma ordem de conferência do SQL). */
export type MotivoSimulacao =
  | 'forma_invalida' | 'produto_sem_valor' | 'percentual_invalido' | 'entrada_invalida' | 'valor_abaixo_do_minimo'
  | 'n_parcelas_fora_do_limite' | 'flexivel_sem_minimo' | 'entrada_maior_que_aporte'

/** Parâmetros de `calcular_simulacao(p_forma, p_valor, p_perc_aporte, p_entrada, p_n_parcelas, p_taxa, …)`. */
export interface EntradaSimulacao {
  forma: FormaPagamento | null
  /** Valor atual do produto (numeric(14,2)). */
  valor: number | null
  /** % de aporte próprio na unidade "%" (30 = 30%). */
  perc_aporte: number | null
  entrada: number | null
  n_parcelas: number | null
  /** `parametros_simulacao.taxa_aporte_proprio` (8.5 = 8,5%). */
  taxa: number | null
  parcela_minima: number | null
  parcela_maxima: number | null
  valor_minimo: number | null
  valor_minimo_flex: number | null
}

/** Mesmo formato do jsonb devolvido por `calcular_simulacao()`. */
export interface ValoresSimulacao {
  valor_imovel: number
  perc_aporte: number
  valor_aporte: number
  valor_entrada: number
  base_parcelada: number
  valor_restante: number
  n_parcelas: number | null
  taxa_aporte: number | null
  valor_parcela: number | null
  valor_total_parcelas: number | null
  residuo: number | null
  valor_minimo_flex: number | null
}

export type ResultadoSimulacao = { ok: true; valores: ValoresSimulacao } | { ok: false; motivos: MotivoSimulacao[] }

// ============ decimal exato (espelho do numeric do Postgres) ============

/** Valor = m / 10^s. `s` faz o papel do `dscale` do Postgres. */
export interface Decimal { readonly m: bigint; readonly s: number }

const DEZ = 10n
const pot10 = (n: number): bigint => DEZ ** BigInt(n)
const abs = (x: bigint) => (x < 0n ? -x : x)

/** Divisão inteira com arredondamento metade para longe do zero (den > 0 ou < 0). */
function dividirArredondando(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError('divisão por zero')
  const negativo = (num < 0n) !== (den < 0n)
  const n = abs(num)
  const d = abs(den)
  let q = n / d
  const r = n % d
  if (r * 2n >= d) q += 1n
  return negativo ? -q : q
}

/**
 * Converte a representação decimal de um número JS (a mais curta que o identifica: `String(x)`) em decimal exato.
 * `0.1` vira 1/10 e não 0,1000000000000000055…, que é o que o usuário digitou e o que o PostgREST manda ao banco.
 */
export function decimalDe(valor: number | string | bigint): Decimal {
  if (typeof valor === 'bigint') return { m: valor, s: 0 }
  if (typeof valor === 'number' && !Number.isFinite(valor)) throw new RangeError('número não finito')
  const texto = String(valor).trim()
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(texto)
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new RangeError(`número inválido: ${texto}`)
  const inteiro = m[2] || '0'
  const fracao = m[3] ?? ''
  const exp = m[4] ? Number(m[4]) : 0
  let mant = BigInt(inteiro + fracao)
  let escala = fracao.length - exp
  if (escala < 0) {
    mant *= pot10(-escala)
    escala = 0
  }
  return { m: m[1] === '-' ? -mant : mant, s: escala }
}

/** round(x, casas) do Postgres: metade para longe do zero; a escala do resultado é `casas`. */
export function arredondar(x: Decimal, casas: number): Decimal {
  if (x.s <= casas) return { m: x.m * pot10(casas - x.s), s: casas }
  return { m: dividirArredondando(x.m, pot10(x.s - casas)), s: casas }
}

function alinhar(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s)
  return [a.m * pot10(s - a.s), b.m * pot10(s - b.s), s]
}

export const somar = (a: Decimal, b: Decimal): Decimal => {
  const [x, y, s] = alinhar(a, b)
  return { m: x + y, s }
}
export const subtrair = (a: Decimal, b: Decimal): Decimal => {
  const [x, y, s] = alinhar(a, b)
  return { m: x - y, s }
}
export const multiplicar = (a: Decimal, b: Decimal): Decimal => ({ m: a.m * b.m, s: a.s + b.s })
export function comparar(a: Decimal, b: Decimal): number {
  const [x, y] = alinhar(a, b)
  return x < y ? -1 : x > y ? 1 : 0
}

/** Peso e primeiro dígito na base 10000 (NBASE) do Postgres; zero → (0, 0), como select_div_scale. */
function pesoPrimeiroDigito(x: Decimal): { peso: number; primeiro: bigint } {
  if (x.m === 0n) return { peso: 0, primeiro: 0n }
  const s4 = Math.ceil(x.s / 4) * 4
  let M = abs(x.m) * pot10(s4 - x.s)
  let n = 0
  let primeiro = 0n
  while (M > 0n) {
    primeiro = M % 10000n
    M /= 10000n
    n++
  }
  return { peso: n - 1 - s4 / 4, primeiro }
}

const NUMERIC_MIN_SIG_DIGITS = 16
const DEC_DIGITS = 4

/** Escala do resultado de a / b no Postgres (select_div_scale). */
export function escalaDivisao(a: Decimal, b: Decimal): number {
  const x = pesoPrimeiroDigito(a)
  const y = pesoPrimeiroDigito(b)
  let qpeso = x.peso - y.peso
  if (x.primeiro <= y.primeiro) qpeso--
  let r = NUMERIC_MIN_SIG_DIGITS - qpeso * DEC_DIGITS
  r = Math.max(r, a.s, b.s, 0)
  return Math.min(r, 1000)
}

/** a / b como numeric_div do Postgres: exato até a escala de select_div_scale, arredondado metade para longe do zero. */
export function dividir(a: Decimal, b: Decimal): Decimal {
  if (b.m === 0n) throw new RangeError('divisão por zero')
  const r = escalaDivisao(a, b)
  // a/b × 10^r = a.m × 10^(b.s + r) / (b.m × 10^a.s)
  return { m: dividirArredondando(a.m * pot10(b.s + r), b.m * pot10(a.s)), s: r }
}

/** Texto decimal canônico (sem zeros supérfluos à direita). */
export function textoDecimal(x: Decimal): string {
  const negativo = x.m < 0n
  let digitos = abs(x.m).toString()
  if (x.s > 0) {
    digitos = digitos.padStart(x.s + 1, '0')
    const i = digitos.length - x.s
    const frac = digitos.slice(i).replace(/0+$/, '')
    digitos = frac ? `${digitos.slice(0, i)}.${frac}` : digitos.slice(0, i)
  }
  return (negativo && digitos !== '0' ? '-' : '') + digitos
}

export const numeroDe = (x: Decimal): number => Number(textoDecimal(x))

// ============ cálculo (FIN-1 / FIN-2) ============

const ZERO: Decimal = { m: 0n, s: 0 }
const CEM: Decimal = { m: 100n, s: 0 }
const UM: Decimal = { m: 1n, s: 0 }

const decimalOuNulo = (v: number | null | undefined): Decimal | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : decimalDe(v)

/**
 * Mesmo cálculo e mesmas validações de `public.calcular_simulacao()`, na mesma ordem:
 *   valor_aporte = round(valor × perc / 100, 2); base = aporte − entrada;
 *   parcela = round(base / n × (1 + taxa / 100), 2); total = round(base × (1 + taxa / 100), 2);
 *   resíduo = total − parcela × n (vai para a última parcela na etapa financeira ⚑); restante = valor − aporte (N17).
 * Como na RPC, o valor do produto, o valor mínimo e o mínimo do flexível chegam como numeric(14,2) e a taxa como
 * numeric(7,4) (colunas de unidades/imoveis e parametros_simulacao): são arredondados a 2 e 4 casas antes de tudo.
 */
export function calcularSimulacao(e: EntradaSimulacao): ResultadoSimulacao {
  if (e.forma !== 'parcelado' && e.forma !== 'flexivel') return { ok: false, motivos: ['forma_invalida'] }
  const motivos: MotivoSimulacao[] = []
  const valorBruto = decimalOuNulo(e.valor)
  const valor = valorBruto ? arredondar(valorBruto, 2) : null
  const percBruto = decimalOuNulo(e.perc_aporte)
  const perc = percBruto ? arredondar(percBruto, 4) : null
  const entrada = arredondar(decimalOuNulo(e.entrada) ?? ZERO, 2)
  const taxaBruta = decimalOuNulo(e.taxa)
  const taxa = taxaBruta ? arredondar(taxaBruta, 4) : null
  const n = e.n_parcelas
  const nValido = n !== null && n !== undefined && Number.isInteger(n)

  if (!valor || valor.m <= 0n) motivos.push('produto_sem_valor')
  if (!perc || perc.m <= 0n || comparar(perc, CEM) > 0) motivos.push('percentual_invalido')
  if (entrada.m < 0n) motivos.push('entrada_invalida')
  const valorMinimoBruto = decimalOuNulo(e.valor_minimo)
  const valorMinimo = valorMinimoBruto ? arredondar(valorMinimoBruto, 2) : null
  if (valorMinimo && valor && comparar(valor, valorMinimo) < 0) motivos.push('valor_abaixo_do_minimo')
  if (e.forma === 'parcelado' && (!nValido || e.parcela_minima == null || e.parcela_maxima == null
      || (n as number) < e.parcela_minima || (n as number) > e.parcela_maxima || !taxa)) {
    motivos.push('n_parcelas_fora_do_limite')
  }
  if (e.forma === 'flexivel' && (e.valor_minimo_flex === null || e.valor_minimo_flex === undefined)) {
    motivos.push('flexivel_sem_minimo')
  }
  let aporte: Decimal | null = null
  if (motivos.length === 0) {
    aporte = arredondar(dividir(multiplicar(valor!, perc!), CEM), 2)
    if (comparar(entrada, aporte) > 0) motivos.push('entrada_maior_que_aporte')
  }
  if (motivos.length > 0) return { ok: false, motivos }

  const base = subtrair(aporte!, entrada)
  let parcela: Decimal | null = null
  let total: Decimal | null = null
  let residuo: Decimal | null = null
  if (e.forma === 'parcelado') {
    const nDec = decimalDe(n as number)
    const fator = somar(UM, dividir(taxa!, CEM))
    parcela = arredondar(multiplicar(dividir(base, nDec), fator), 2)
    total = arredondar(multiplicar(base, fator), 2)
    residuo = subtrair(total, multiplicar(parcela, nDec))
  }
  return {
    ok: true,
    valores: {
      valor_imovel: numeroDe(valor!),
      perc_aporte: numeroDe(perc!),
      valor_aporte: numeroDe(aporte!),
      valor_entrada: numeroDe(entrada),
      base_parcelada: numeroDe(base),
      valor_restante: numeroDe(subtrair(valor!, aporte!)),
      n_parcelas: e.forma === 'parcelado' ? (n as number) : null,
      taxa_aporte: e.forma === 'parcelado' ? numeroDe(taxa!) : null,
      valor_parcela: parcela ? numeroDe(parcela) : null,
      valor_total_parcelas: total ? numeroDe(total) : null,
      residuo: residuo ? numeroDe(residuo) : null,
      valor_minimo_flex: e.forma === 'flexivel' ? numeroDe(arredondar(decimalDe(e.valor_minimo_flex as number), 2)) : null,
    },
  }
}

// ============ formatação (pt-BR, sem Intl: mesmo resultado no Deno, no Node e no navegador) ============

function agruparMilhar(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** "R$ 1.808,33" (sempre com centavos, metade para longe do zero). */
export function formatarMoeda(valor: number | string): string {
  const c = arredondar(decimalDe(valor), 2)
  const negativo = c.m < 0n
  const digitos = abs(c.m).toString().padStart(3, '0')
  const inteiro = digitos.slice(0, -2)
  return `${negativo ? '-' : ''}R$ ${agruparMilhar(inteiro)},${digitos.slice(-2)}`
}

/** Percentual na unidade "%": 30 → "30%", 8.5 → "8,5%", 33.3333 → "33,3333%" (até 4 casas). */
export function formatarPercentual(valor: number | string): string {
  const p = arredondar(decimalDe(valor), 4)
  const [inteiro, frac] = textoDecimal(p).split('.')
  const negativo = inteiro.startsWith('-')
  const i = negativo ? inteiro.slice(1) : inteiro
  return `${negativo ? '-' : ''}${agruparMilhar(i)}${frac ? `,${frac}` : ''}%`
}

// Redução das fotos no navegador antes do envio [WP5] (docs/ARQUITETURA_EXPANSAO.md §3.10, §7.3):
// canvas → WebP com o maior lado ≤ 1920 px, mais uma miniatura de 480 px. Sem dependência nova.
// - A orientação EXIF é aplicada (createImageBitmap com imageOrientation 'from-image') e os metadados do arquivo
//   original (EXIF/GPS) não vão para o bucket: o canvas regrava só os pixels.
// - Navegador que não codifica WebP no canvas devolve outro tipo em toBlob: aí a foto sai em JPEG (o bucket e a RPC
//   aceitam jpeg), com fundo branco para não escurecer a transparência de PNG.
// - Se a foto passar do limite do servidor (`imovel_foto_max_bytes`), a qualidade baixa aos poucos antes de desistir.
// As funções puras (dimensões, validação, nomes, escolha da qualidade) são testadas em imagem.test.ts.

/** Erro da preparação da foto no navegador; a mensagem já está em pt-BR e vai direto para a tela. */
export class ErroImagem extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroImagem'
  }
}

export const LADO_MAXIMO = 1920
export const LADO_MINIATURA = 480
export const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp'] as const
/** Teto do arquivo original escolhido (a redução acontece antes do envio; acima disso o navegador sofre). */
export const ORIGINAL_MAX_BYTES = 40 * 1024 * 1024
/** Maior lado aceito no original (evita estourar a memória do canvas). */
export const ORIGINAL_MAX_LADO = 12000

const QUALIDADES_FOTO = [0.82, 0.74, 0.66, 0.58, 0.5] as const
const QUALIDADES_MINIATURA = [0.72, 0.6, 0.5] as const

export interface Dimensoes { largura: number; altura: number }

/** Mantém a proporção, nunca amplia; lados inteiros ≥ 1. */
export function dimensoesReduzidas(largura: number, altura: number, ladoMaximo: number): Dimensoes {
  if (!(largura > 0) || !(altura > 0)) throw new ErroImagem('A imagem tem dimensões inválidas.')
  const fator = Math.min(1, ladoMaximo / Math.max(largura, altura))
  return { largura: Math.max(1, Math.round(largura * fator)), altura: Math.max(1, Math.round(altura * fator)) }
}

/** Mensagem de erro para o arquivo escolhido (ou nulo se pode seguir para a redução). */
export function validarArquivo(a: { name?: string; type: string; size: number }): string | null {
  const nome = a.name ? `"${a.name}"` : 'O arquivo'
  if (!(TIPOS_ACEITOS as readonly string[]).includes(a.type)) return `${nome} não é uma imagem JPG, PNG ou WEBP.`
  if (a.size <= 0) return `${nome} está vazio.`
  if (a.size > ORIGINAL_MAX_BYTES) return `${nome} passa de ${Math.round(ORIGINAL_MAX_BYTES / 1024 / 1024)} MB.`
  return null
}

export type ExtensaoFoto = 'webp' | 'jpg'

/**
 * Caminhos no bucket `imoveis` (§3.10): `<imovel_id>/<uuid>.<ext>` e `<imovel_id>/<uuid>-min.<ext>`, sem dado pessoal
 * no nome. É o formato que a política de envio e `imovel_foto_registrar` exigem (`[0-9a-z-]{1,80}`).
 */
export function caminhosDaFoto(imovelId: string, id: string, ext: ExtensaoFoto): { principal: string; miniatura: string } {
  const base = id.toLowerCase()
  return { principal: `${imovelId}/${base}.${ext}`, miniatura: `${imovelId}/${base}-min.${ext}` }
}

/** Mesmo formato conferido no banco (`imovel_fotos.storage_path` e `imovel_foto_registrar`). */
export const RE_CAMINHO_FOTO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-z-]{1,80}\.(webp|jpg|jpeg|png)$/

/**
 * Codifica com a primeira qualidade que couber em `maxBytes`. `codificar` recebe a qualidade e devolve o Blob.
 * Nenhuma coube → erro com mensagem para a pessoa.
 */
export async function codificarNoLimite(
  codificar: (qualidade: number) => Promise<Blob>,
  qualidades: readonly number[],
  maxBytes: number,
): Promise<Blob> {
  for (const q of qualidades) {
    const b = await codificar(q)
    if (b.size > 0 && b.size <= maxBytes) return b
  }
  throw new ErroImagem(`A foto ficou maior que ${formatarBytes(maxBytes)} mesmo depois de reduzida. Tente outra imagem.`)
}

export function formatarBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export interface FotoReduzida {
  principal: Blob
  miniatura: Blob
  /** Dimensões da foto principal (vão como metadado do upload; informativas). */
  largura: number
  altura: number
  tipo: 'image/webp' | 'image/jpeg'
  extensao: ExtensaoFoto
}

// ---------- só no navegador ----------

function canvasCom(origem: CanvasImageSource, d: Dimensoes, fundo: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = d.largura
  c.height = d.altura
  const ctx = c.getContext('2d')
  if (!ctx) throw new ErroImagem('Não foi possível processar a imagem neste navegador.')
  if (fundo) {
    // JPEG não tem transparência: fundo branco (em vez de preto) para PNG com transparência
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, d.largura, d.altura)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(origem, 0, 0, d.largura, d.altura)
  return c
}

const paraBlob = (c: HTMLCanvasElement, tipo: string, qualidade: number) =>
  new Promise<Blob>((resolver, rejeitar) =>
    c.toBlob((b) => (b ? resolver(b) : rejeitar(new ErroImagem('Não foi possível gerar a imagem.'))), tipo, qualidade))

/** O navegador codifica WebP no canvas? (Os que não codificam devolvem PNG em toBlob.) */
async function suportaWebp(): Promise<boolean> {
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 1
  try {
    return (await paraBlob(c, 'image/webp', 0.8)).type === 'image/webp'
  } catch {
    return false
  }
}

/** Reduz a foto escolhida: principal ≤ 1920 px e miniatura de 480 px, cada uma com no máximo `maxBytes`. */
export async function reduzirImagem(arquivo: Blob, maxBytes: number): Promise<FotoReduzida> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
  } catch {
    throw new ErroImagem('Não foi possível ler esta imagem. Confira se o arquivo não está corrompido.')
  }
  try {
    if (Math.max(bitmap.width, bitmap.height) > ORIGINAL_MAX_LADO) {
      throw new ErroImagem(`A imagem é grande demais (mais de ${ORIGINAL_MAX_LADO} px). Reduza antes de enviar.`)
    }
    const webp = await suportaWebp()
    const tipo = webp ? 'image/webp' : 'image/jpeg'
    const d = dimensoesReduzidas(bitmap.width, bitmap.height, LADO_MAXIMO)
    const grande = canvasCom(bitmap, d, !webp)
    const principal = await codificarNoLimite((q) => paraBlob(grande, tipo, q), QUALIDADES_FOTO, maxBytes)
    // a miniatura sai da foto já reduzida (menos memória e o mesmo recorte)
    const pequena = canvasCom(grande, dimensoesReduzidas(d.largura, d.altura, LADO_MINIATURA), !webp)
    const miniatura = await codificarNoLimite((q) => paraBlob(pequena, tipo, q), QUALIDADES_MINIATURA, maxBytes)
    grande.width = 0
    pequena.width = 0
    return { principal, miniatura, largura: d.largura, altura: d.altura, tipo, extensao: webp ? 'webp' : 'jpg' }
  } finally {
    bitmap.close()
  }
}

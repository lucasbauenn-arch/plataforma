// Falha ao carregar um módulo (chunk lazy) depois de um deploy (FUX-02): quem está com o painel aberto pede um arquivo com
// hash antigo, o servidor responde a página inicial em vez do JavaScript e o `import()` falha. Duas defesas:
// 1. o evento `vite:preloadError` recarrega a página UMA vez (o carimbo no sessionStorage evita laço de recargas);
// 2. o ErrorBoundary (src/components/LimiteErro.tsx) mostra a mensagem com "Recarregar", em vez da tela escura vazia.
// Módulo puro (sem React): testado em modulos.test.ts.

export const CHAVE_RECARGA_MODULO = 'arken:recarga-modulo'
/** Nova recarga automática só depois de tanto tempo: se o arquivo continua falhando, quem decide é a pessoa. */
export const JANELA_RECARGA_MS = 60_000

const PADRAO_FALHA_DE_MODULO = /dynamically imported module|importing a module script failed|error loading dynamically|unable to preload css|chunkloaderror|loading chunk \d+ failed/i

/** O erro é a falha de carregar um módulo/chunk (mensagens do Chrome, Firefox, Safari e do Vite). */
export function ehFalhaDeModulo(erro: unknown): boolean {
  const objeto = erro && typeof erro === 'object' ? (erro as { name?: unknown; message?: unknown }) : null
  const mensagem = typeof erro === 'string'
    ? erro
    : `${typeof objeto?.name === 'string' ? objeto.name : ''} ${typeof objeto?.message === 'string' ? objeto.message : ''}`
  return PADRAO_FALHA_DE_MODULO.test(mensagem)
}

type Armazenamento = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Pode recarregar sozinho agora? Sim na primeira falha e depois de `JANELA_RECARGA_MS`; registra a tentativa. Sem
 * armazenamento (bloqueado ou indisponível) não recarrega: sem o carimbo não há como impedir um laço de recargas.
 */
export function podeRecarregarSozinho(armazenamento: Armazenamento | null, agora: number): boolean {
  if (!armazenamento) return false
  try {
    const ultima = Number(armazenamento.getItem(CHAVE_RECARGA_MODULO)) || 0
    if (ultima > 0 && agora >= ultima && agora - ultima < JANELA_RECARGA_MS) return false
    armazenamento.setItem(CHAVE_RECARGA_MODULO, String(agora))
    return true
  } catch {
    return false
  }
}

/**
 * Trata `vite:preloadError`: se pode, cancela o erro (`preventDefault`) e recarrega. Devolve se recarregou. Quando não
 * recarrega, o erro segue e o ErrorBoundary mostra a tela de falha.
 */
export function tratarFalhaDePreload(evento: { preventDefault: () => void }, armazenamento: Armazenamento | null, agora: number, recarregar: () => void): boolean {
  if (!podeRecarregarSozinho(armazenamento, agora)) return false
  evento.preventDefault()
  recarregar()
  return true
}

/** Liga a recarga automática no navegador. Chame uma vez, antes de renderizar. */
export function instalarRecargaPorModuloAntigo(): void {
  const guarda = (): Armazenamento | null => { try { return window.sessionStorage } catch { return null } }
  window.addEventListener('vite:preloadError', (ev) => {
    tratarFalhaDePreload(ev, guarda(), Date.now(), () => window.location.reload())
  })
}

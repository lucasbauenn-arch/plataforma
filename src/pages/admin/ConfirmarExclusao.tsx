import { toast } from 'sonner'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import type { AlvoExclusao } from './editorComum'

/** Modal de confirmação das exclusões do editor: erro do servidor vira aviso e o modal continua aberto. */
export function ConfirmarExclusao({ alvo, aoFechar, depois }: { alvo: AlvoExclusao | null; aoFechar: () => void; depois: () => void }) {
  return (
    <ConfirmarModal
      aberto={!!alvo} titulo={alvo?.titulo ?? ''} texto={alvo?.texto} rotuloConfirmar="Excluir" perigo
      aoConfirmar={async () => { await alvo?.excluir(); toast.success('Excluído'); depois() }}
      aoFechar={aoFechar}
    />
  )
}

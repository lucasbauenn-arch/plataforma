import { Loader2 } from 'lucide-react'

export const Carregando = ({ texto = 'Carregando…' }: { texto?: string }) => (
  <div className="flex items-center justify-center gap-2 py-24 text-muted"><Loader2 className="animate-spin" size={18} />{texto}</div>
)

export const Vazio = ({ titulo, texto }: { titulo: string; texto?: string }) => (
  <div className="border border-dashed border-line px-6 py-14 text-center">
    <p className="font-semibold">{titulo}</p>
    {texto && <p className="mt-1 text-sm text-muted">{texto}</p>}
  </div>
)

export const Erro = ({ texto = 'Não foi possível carregar os dados.' }: { texto?: string }) => (
  <div className="border border-red-500/30 bg-red-500/10 px-6 py-5 text-sm text-red-300">{texto}</div>
)

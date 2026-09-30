import type { ElementType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { STATUS_IMOVEL } from '@/lib/constants'
import { dataHora } from '@/lib/format'
import type { StatusImovel } from '@/lib/types'
import { Consulta } from '@/components/app/Consulta'
import { chavesImoveis, historicoImovel } from '../api'

const ORIGENS: Record<string, string> = {
  usuario: 'Pela tela', sistema: 'Automático (contrato)', webhook: 'Integração', migracao: 'Migração',
}
const rotuloStatus = (s: string | null) => (s ? STATUS_IMOVEL[s as StatusImovel]?.rotulo ?? s : '—')

/**
 * [WP5] Histórico de status do imóvel (`historico_status`, §3.8): só internos leem (política `is_admin`). Mostra
 * quem mudou, quando, de onde e a observação da devolução.
 */
export function HistoricoImovel({ imovelId, Titulo }: { imovelId: string; Titulo: ElementType }) {
  const historico = useQuery({ queryKey: chavesImoveis.historico(imovelId), queryFn: () => historicoImovel(imovelId) })
  return (
    <section className="card p-5" aria-labelledby="titulo-historico">
      <Titulo id="titulo-historico" className="mb-3 text-base font-semibold">Histórico de status</Titulo>
      <Consulta consulta={historico} tituloVazio="Sem mudanças de status" textoVazio="O imóvel continua no status em que foi cadastrado.">
        {(linhas) => (
          <ol className="grid gap-3 text-sm">
            {linhas.map((h) => (
              <li key={h.id} className="border-l-2 border-line pl-3">
                <p className="flex flex-wrap items-center gap-1 font-semibold">
                  {rotuloStatus(h.de)} <ArrowRight size={13} aria-label="para" className="text-muted" /> {rotuloStatus(h.para)}
                </p>
                <p className="text-xs text-muted">
                  {dataHora(h.ocorrido_em)} · {h.ator_nome ?? (h.origem === 'usuario' ? 'Usuário' : ORIGENS[h.origem] ?? h.origem)}
                  {h.origem !== 'usuario' && h.ator_nome ? ` · ${ORIGENS[h.origem] ?? h.origem}` : ''}
                </p>
                {h.motivo && <p className="mt-1 whitespace-pre-line text-stone/85">{h.motivo}</p>}
              </li>
            ))}
          </ol>
        )}
      </Consulta>
    </section>
  )
}

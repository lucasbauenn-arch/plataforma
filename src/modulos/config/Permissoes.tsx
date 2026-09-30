import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { mensagemErro, traduzirErro } from '@/lib/erros'
import { TIPOS_PARCEIRO } from '@/lib/constants'
import { Consulta } from '@/components/app/Consulta'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import type { AcaoRede, TipoParceiro } from '@/lib/types'
import type { PermissaoRede } from './tipos'

const CHAVE = ['config', 'permissoes'] as const
const TIPOS: TipoParceiro[] = ['imobiliaria', 'gerente', 'corretor']

const ROTULOS_ACAO: Record<AcaoRede, string> = {
  cadastrar_gerente: 'Cadastrar gerente',
  cadastrar_corretor: 'Cadastrar corretor',
  cadastrar_cliente: 'Cadastrar cliente',
  editar_subordinado: 'Editar quem está abaixo',
  inativar_subordinado: 'Inativar quem está abaixo',
  transferir_corretor: 'Transferir corretor de gerente',
  transferir_cliente: 'Transferir cliente',
  gerente_como_corretor: 'Gerente atende cliente (A1)',
  convite_por_link: 'Convite por link (WhatsApp/copiar)',
  criar_contrato: 'Criar contrato',
  analisar_documento: 'Analisar documento',
  cadastrar_imovel: 'Cadastrar imóvel',
}
const ORDEM = Object.keys(ROTULOS_ACAO) as AcaoRede[]

/**
 * Matriz de permissões da rede (permissoes_rede, area-parceiros §4): o Super liga ou desliga cada ação por tipo de
 * parceiro. Células que não se aplicam não existem ("—"). Internos podem tudo. Cada troca fica na auditoria.
 */
export default function Permissoes() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await supabase.from('permissoes_rede').select('acao, tipo, permitido, criado_em, atualizado_em, atualizado_por')
      if (error) throw error
      return (data ?? []) as PermissaoRede[]
    },
  })

  async function alternar(p: PermissaoRede) {
    const { data, error } = await supabase.from('permissoes_rede').update({ permitido: !p.permitido })
      .eq('acao', p.acao).eq('tipo', p.tipo).select('acao')
    if (error) return toast.error(mensagemErro(traduzirErro(error)))
    if (!data?.length) return toast.error('Sem permissão para alterar.')
    toast.success(`${ROTULOS_ACAO[p.acao]} · ${TIPOS_PARCEIRO[p.tipo]}: ${p.permitido ? 'desligado' : 'ligado'}.`)
    await qc.invalidateQueries({ queryKey: CHAVE })
  }

  return (
    <Consulta consulta={q} tituloVazio="Matriz vazia">
      {(linhas) => {
        const celula = (acao: AcaoRede, tipo: TipoParceiro) => linhas.find((l) => l.acao === acao && l.tipo === tipo)
        return (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Permissões por tipo de parceiro</caption>
              <thead className="bg-sand/50 text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Ação</th>
                  {TIPOS.map((t) => <th key={t} scope="col" className="px-4 py-3 text-center font-semibold">{TIPOS_PARCEIRO[t]}</th>)}
                </tr>
              </thead>
              <tbody className="[&_td]:px-4 [&_td]:py-3 [&_tr]:border-t [&_tr]:border-line">
                {ORDEM.filter((a) => linhas.some((l) => l.acao === a)).map((acao) => (
                  <tr key={acao}>
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      {ROTULOS_ACAO[acao]} <SeloProvisorio campo={`permissoes_rede.${acao}`} />
                    </th>
                    {TIPOS.map((tipo) => {
                      const c = celula(acao, tipo)
                      if (!c) return <td key={tipo} className="text-center text-muted" aria-label="Não se aplica">—</td>
                      return (
                        <td key={tipo} className="text-center">
                          <input
                            type="checkbox" className="h-4 w-4 accent-bronze" checked={c.permitido}
                            aria-label={`${ROTULOS_ACAO[acao]} — ${TIPOS_PARCEIRO[tipo]}`} onChange={() => void alternar(c)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }}
    </Consulta>
  )
}

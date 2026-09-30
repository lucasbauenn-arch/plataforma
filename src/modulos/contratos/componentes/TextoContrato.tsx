import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { contratoDadosModelo } from '@/lib/rpc'
import { renderizarModelo, ROTULOS_VARIAVEIS, VARIAVEIS_DO_CLIENTE, type NomeVariavel } from '@shared/modelo-contrato'
import { ErroConsulta } from '@/components/app/Consulta'
import { Carregando } from '@/components/Estados'
import { chavesContratos } from '../api'
import { BlocosContrato } from './BlocosContrato'

const rotulo = (v: string) => ROTULOS_VARIAVEIS[v as NomeVariavel] ?? v

/**
 * Prévia do texto do contrato com os dados atuais (contrato_dados_modelo, auditada: só carrega quando pedida).
 * Variáveis vazias viram a lista "complete na aba Dados" (dados do cliente) ou "fale com a equipe" (configuração).
 */
export function TextoContrato({ contratoId, clienteId, fichaBase }: { contratoId: string; clienteId: string; fichaBase: string }) {
  const [pedido, setPedido] = useState(false)
  const q = useQuery({
    queryKey: chavesContratos.texto(contratoId),
    queryFn: () => contratoDadosModelo({ p_id: contratoId }),
    enabled: pedido,
    staleTime: 0,
  })

  if (!pedido) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setPedido(true)}>
        <Eye size={16} aria-hidden /> Ver o texto com os dados atuais
      </button>
    )
  }
  if (q.isPending) return <Carregando />
  if (q.error) return <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} />

  const r = renderizarModelo(q.data.modelo.conteudo, q.data.variaveis)
  if (!r.ok) {
    const doCliente = r.vazias.filter((v) => (VARIAVEIS_DO_CLIENTE as readonly string[]).includes(v))
    const outras = r.vazias.filter((v) => !doCliente.includes(v))
    return (
      <div className="grid gap-3 border border-bronze/40 bg-bronze/5 p-4 text-sm">
        <p className="font-semibold">Faltam dados para montar o contrato.</p>
        {doCliente.length > 0 && (
          <div>
            <p>Complete na aba Dados do cliente: {doCliente.map(rotulo).join(', ')}.</p>
            <Link to={`${fichaBase}/crm/${clienteId}?aba=dados`} className="mt-1 inline-block text-bronze hover:underline">Abrir a ficha do cliente</Link>
          </div>
        )}
        {outras.length > 0 && <p>Configuração da Arken ou do contrato: {outras.map(rotulo).join(', ')}. Fale com a equipe Arken.</p>}
        {r.desconhecidas.length > 0 && <p>O modelo usa variáveis desconhecidas: {r.desconhecidas.join(', ')}.</p>}
      </div>
    )
  }
  return (
    <div className="max-h-[32rem] overflow-y-auto border border-line bg-ink p-5">
      <p className="eyebrow mb-3">Modelo {q.data.modelo.titulo} · versão {q.data.modelo.versao}</p>
      <BlocosContrato blocos={r.blocos} />
    </div>
  )
}

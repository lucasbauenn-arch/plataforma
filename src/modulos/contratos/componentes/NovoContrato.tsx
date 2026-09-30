import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { contratoCriar } from '@/lib/rpc'
import { ErroRpc } from '@/lib/erros'
import type { Ref } from '@/lib/types'
import { Modal } from '@/components/app/Modal'
import { SeletorCliente } from '@/components/app/SeletorCliente'
import { useBase } from '@/components/app/useBase'
import type { ClienteOpcao } from '@/modulos/crm/tipos'
import { chavesContratos, type ProdutoOpcao } from '../api'
import { argsCriar, type EscolhasSimulacao } from '../simulacao-form'
import { FormSimulacao } from './FormSimulacao'
import { SeletorProduto } from './SeletorProduto'

/**
 * Novo contrato (rascunho): cliente (fixo na ficha ou escolhido), produto e escolhas da simulação. O servidor lê o
 * valor do produto, recalcula tudo e confere escopo, permissão (criar_contrato) e um contrato ativo por produto.
 */
export function NovoContrato({ aberto, aoFechar, cliente: clienteFixo }: { aberto: boolean; aoFechar: () => void; cliente?: Ref }) {
  const [cliente, setCliente] = useState<ClienteOpcao | null>(null)
  const [produto, setProduto] = useState<ProdutoOpcao | null>(null)
  const navigate = useNavigate()
  const base = useBase()
  const qc = useQueryClient()

  function fechar() {
    setCliente(null)
    setProduto(null)
    aoFechar()
  }

  async function criar(e: EscolhasSimulacao) {
    const clienteId = clienteFixo?.id ?? cliente?.id
    if (!clienteId) throw new ErroRpc('DADOS_INVALIDOS', 'Escolha o cliente do contrato.')
    if (!produto) throw new ErroRpc('DADOS_INVALIDOS', 'Escolha o produto do contrato.')
    const id = await contratoCriar(argsCriar(clienteId, produto, e))
    toast.success('Contrato criado em rascunho.')
    await qc.invalidateQueries({ queryKey: chavesContratos.todos })
    fechar()
    navigate(`${base}/contratos/${id}`)
  }

  return (
    <Modal aberto={aberto} titulo="Novo contrato" aoFechar={fechar} largura="lg">
      <div className="grid gap-6">
        <section className="grid gap-2">
          <p className="label">Cliente</p>
          {clienteFixo
            ? <p className="text-sm font-semibold">{clienteFixo.nome}</p>
            : <SeletorCliente valor={cliente} aoMudar={setCliente} />}
        </section>
        <section className="grid gap-2">
          <p className="label">Produto</p>
          <SeletorProduto valor={produto} aoMudar={setProduto} />
        </section>
        <section className="grid gap-2">
          <p className="label">Simulação</p>
          <FormSimulacao valorProduto={produto?.valor ?? null} rotuloSalvar="Criar contrato" aoSalvar={criar} />
        </section>
      </div>
    </Modal>
  )
}

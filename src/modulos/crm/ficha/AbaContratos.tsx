import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { contratosListar } from '@/lib/rpc'
import { useEscopo } from '@/lib/escopo'
import { FORMAS_PAGAMENTO } from '@/lib/constants'
import { brlCentavos, codigoExibicao, data } from '@/lib/format'
import { Consulta } from '@/components/app/Consulta'
import { SeloStatus } from '@/components/app/Etiqueta'
import { Tabela } from '@/components/app/Tabela'
import { useBase } from '@/components/app/useBase'
import { chavesContratos } from '@/modulos/contratos/api'
import { NovoContrato } from '@/modulos/contratos/componentes/NovoContrato'
import type { ContratosFiltros } from '@/modulos/contratos/tipos'
import type { PropsAbaFicha } from '../tipos'

/**
 * Aba Contratos da ficha do cliente [WP4]: contratos do cliente (contratos_listar com cliente_id, auditada) e criação
 * (produto + simulação; o servidor recalcula tudo com o valor do produto).
 */
export default function AbaContratos({ clienteId, ficha }: PropsAbaFicha) {
  const { tem } = useEscopo()
  const base = useBase()
  const [novo, setNovo] = useState(false)
  const filtros: ContratosFiltros = { cliente_id: clienteId, limite: 50 }
  const q = useQuery({ queryKey: chavesContratos.lista(filtros), queryFn: () => contratosListar({ p_filtros: filtros }) })
  const nome = [ficha.cliente.nome, ficha.cliente.sobrenome].filter(Boolean).join(' ')
  const podeCriar = tem('contratos.criar') && !ficha.cliente.inativado_em

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Contratos</h3>
        {podeCriar && (
          <button type="button" className="btn-primary" onClick={() => setNovo(true)}><Plus size={16} aria-hidden /> Novo contrato</button>
        )}
      </div>
      <Consulta consulta={q} vazio={(d) => !d || d.itens.length === 0} tituloVazio="Nenhum contrato" textoVazio="Os contratos deste cliente aparecem aqui.">
        {(d) => (
          <Tabela legenda="Contratos do cliente" colunas={['Contrato', 'Produto', 'Forma', { rotulo: 'Valor', direita: true }, 'Status', 'Criado em']} minimo={640}>
            {d!.itens.map((k) => (
              <tr key={k.id}>
                <td><Link to={`${base}/contratos/${k.id}`} className="font-semibold text-bronze hover:underline">{codigoExibicao(k.codigo)}</Link></td>
                <td>{k.produto.nome}</td>
                <td>{FORMAS_PAGAMENTO[k.forma_pagamento]}{k.n_parcelas ? ` · ${k.n_parcelas}× de ${brlCentavos(k.valor_parcela)}` : ''}</td>
                <td className="text-right tabular-nums">{brlCentavos(k.valor_imovel)}</td>
                <td><SeloStatus tipo="contrato" valor={k.status} /></td>
                <td className="text-muted">{data(k.criado_em)}</td>
              </tr>
            ))}
          </Tabela>
        )}
      </Consulta>
      {podeCriar && <NovoContrato aberto={novo} aoFechar={() => setNovo(false)} cliente={{ id: clienteId, nome }} />}
    </section>
  )
}

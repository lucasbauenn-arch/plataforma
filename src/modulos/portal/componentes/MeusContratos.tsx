import { useState } from 'react'
import { toast } from 'sonner'
import { Download, FileSignature } from 'lucide-react'
import { portalContratoBaixar, urlDoDownload } from '@/lib/rpc'
import { ErroRpc, mensagemErro } from '@/lib/erros'
import { brlCentavos, codigoExibicao, dataHora } from '@/lib/format'
import { FORMAS_PAGAMENTO } from '@/lib/constants'
import { SeloStatus } from '@/components/app/Etiqueta'
import type { PortalContrato } from '../tipos'

/**
 * "Meu contrato" (portal_contratos): só a partir de assinatura_pendente; o download é só do PDF ASSINADO, por
 * portal_contrato_baixar (auditado) + Edge baixar-arquivo (URL curta).
 */
export function MeusContratos({ contratos }: { contratos: PortalContrato[] }) {
  if (contratos.length === 0) return null
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="portal-contratos">
      <h2 id="portal-contratos" className="flex items-center gap-2 font-semibold"><FileSignature size={18} className="text-bronze" aria-hidden /> {contratos.length === 1 ? 'Meu contrato' : 'Meus contratos'}</h2>
      <ul className="mt-4 divide-y divide-line">
        {contratos.map((k) => <ItemContrato key={k.id} k={k} />)}
      </ul>
    </section>
  )
}

function ItemContrato({ k }: { k: PortalContrato }) {
  const [baixando, setBaixando] = useState(false)

  async function baixar() {
    // abre a janela antes (bloqueio de pop-up) e troca o endereço quando a URL chegar
    const janela = window.open('', '_blank')
    if (janela) janela.opener = null
    setBaixando(true)
    try {
      const autorizacao = await portalContratoBaixar({ p_id: k.id })
      if (!autorizacao) throw new ErroRpc('SEM_ACESSO', 'O PDF assinado não está disponível.')
      const url = await urlDoDownload(autorizacao)
      if (janela) janela.location.href = url
      else window.location.assign(url)
    } catch (e) {
      janela?.close()
      toast.error(mensagemErro(e))
    } finally {
      setBaixando(false)
    }
  }

  const valores = [
    `Valor ${brlCentavos(k.valor_imovel)}`,
    FORMAS_PAGAMENTO[k.forma_pagamento],
    k.n_parcelas && k.valor_parcela != null ? `${k.n_parcelas}× de ${brlCentavos(k.valor_parcela)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm">
      <div className="min-w-0">
        <p className="font-semibold">{k.produto.nome} <span className="font-normal text-muted">{codigoExibicao(k.codigo)}</span></p>
        <p className="text-xs text-muted">{valores}</p>
        <p className="mt-1 text-xs text-muted">
          {k.status === 'assinado'
            ? `Assinado em ${dataHora(k.assinado_em)}`
            : `Enviado para assinatura em ${dataHora(k.enviado_assinatura_em)}. Você recebe o link por e-mail, da plataforma de assinatura.`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <SeloStatus tipo="contrato" valor={k.status} />
        {k.pdf_assinado_disponivel && (
          <button type="button" className="inline-flex items-center gap-1.5 font-semibold text-bronze disabled:opacity-50" onClick={baixar} disabled={baixando}>
            <Download size={15} aria-hidden /> {baixando ? 'Preparando…' : 'Baixar PDF assinado'}
          </button>
        )}
      </div>
    </li>
  )
}

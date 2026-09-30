import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, MessageCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { redeGerarCodigoIndicacao } from '@/lib/rpc'
import { useEscopo } from '@/lib/escopo'
import { mensagemErro } from '@/lib/erros'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { useTermoCliente } from '../api-clientes'

/** Endereço público do pré-cadastro para um código de indicação. */
const linkDoCodigo = (codigo: string) => `${window.location.origin}/pre-cadastro/cliente/${codigo}`

/**
 * Link de indicação do corretor (e do gerente com A1): copiar, enviar pelo WhatsApp e gerar um novo (o anterior deixa
 * de valer, rede_gerar_codigo_indicacao). Quem se cadastra pelo link entra na carteira de quem indicou, em NC, com os
 * documentos básicos solicitados; o portal não é liberado (N9).
 */
export default function Links() {
  const { escopo, recarregar } = useEscopo()
  const termo = useTermoCliente()
  const [confirmar, setConfirmar] = useState(false)
  const codigo = escopo?.parceiro?.codigo_indicacao ?? null
  const link = codigo ? linkDoCodigo(codigo) : null
  const semTermoRevisado = !termo.isPending && !termo.data?.revisado_juridico

  async function copiar() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link copiado.')
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.')
    }
  }

  async function gerar() {
    await redeGerarCodigoIndicacao()
    recarregar()
    toast.success(codigo ? 'Link novo gerado. O anterior não vale mais.' : 'Link gerado.')
  }

  return (
    <>
      <CabecalhoPagina
        eyebrow="CRM" titulo="Meu link de indicação"
        subtitulo="Envie para o cliente fazer o pré-cadastro. Ele entra na sua carteira como Novo contato, com os documentos básicos já solicitados."
      />
      {semTermoRevisado && (
        <div role="status" className="mb-6 flex gap-3 border border-bronze/40 bg-bronze/10 p-4 text-sm">
          <TriangleAlert size={20} className="shrink-0 text-bronze" aria-hidden />
          <p>
            O pré-cadastro público ainda não está aberto: o termo de consentimento está em revisão jurídica. O link pode ser
            compartilhado, mas quem abrir verá que o cadastro está indisponível por enquanto. <SeloProvisorio codigo="H4" />
          </p>
        </div>
      )}
      <section className="card grid gap-5 p-6">
        {link ? (
          <>
            <label className="block">
              <span className="label">Seu link</span>
              <input className="input font-mono text-sm" readOnly value={link} onFocus={(e) => e.target.select()} />
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn-primary" onClick={copiar}><Copy size={16} aria-hidden /> Copiar link</button>
              <a
                className="btn-ghost" target="_blank" rel="noreferrer"
                href={`https://wa.me/?text=${encodeURIComponent(`Olá! Faça seu pré-cadastro na Arken Incorporadora por este link: ${link}`)}`}
              >
                <MessageCircle size={16} aria-hidden /> Enviar pelo WhatsApp
              </a>
              <button type="button" className="btn-ghost" onClick={() => setConfirmar(true)}><RefreshCw size={16} aria-hidden /> Gerar novo link</button>
            </div>
          </>
        ) : (
          <div className="grid gap-4">
            <p className="text-sm text-muted">Você ainda não tem um link de indicação.</p>
            <button type="button" className="btn-primary justify-self-start" onClick={() => void gerar().catch((e: unknown) => toast.error(mensagemErro(e)))}>
              Gerar meu link
            </button>
          </div>
        )}
        <p className="text-xs text-muted">
          O cadastro pelo link não libera o acesso ao portal do cliente. <SeloProvisorio codigo="N9" />
        </p>
      </section>
      <ConfirmarModal
        aberto={confirmar} titulo="Gerar um link novo?"
        texto="O link atual deixa de funcionar na hora. Quem já recebeu o link antigo não conseguirá se cadastrar por ele."
        rotuloConfirmar="Gerar novo link" perigo aoConfirmar={gerar} aoFechar={() => setConfirmar(false)}
      />
    </>
  )
}

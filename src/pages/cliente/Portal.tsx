import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { FileText, LogOut, HardHat, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useInatividade } from '@/hooks/useInatividade'
import { ErroRpc, mensagemErro, traduzirErro } from '@/lib/erros'
import { portalContratos, portalDocumentos, portalMeuCorretor, portalMeusDados } from '@/lib/rpc'
import { Imagem } from '@/components/Imagem'
import { Carregando, Vazio } from '@/components/Estados'
import { ErroConsulta } from '@/components/app/Consulta'
import { midiaUrl } from '@/lib/midia'
import { brl, data } from '@/lib/format'
import { MeusDados } from '@/modulos/portal/componentes/MeusDados'
import { MeuCorretor } from '@/modulos/portal/componentes/MeuCorretor'
import { DocumentosSolicitados } from '@/modulos/portal/componentes/DocumentosSolicitados'
import { MeusContratos } from '@/modulos/portal/componentes/MeusContratos'
import type { ClienteArquivo, ClienteNegocio, ObraAtualizacao } from '@/lib/types'

function Andamento({ empreendimentoId }: { empreendimentoId: string }) {
  const q = useQuery({
    queryKey: ['obra', empreendimentoId],
    queryFn: async () => {
      const { data, error } = await supabase.from('obra_atualizacoes').select('*').eq('empreendimento_id', empreendimentoId).order('data', { ascending: false })
      if (error) throw traduzirErro(error)
      return (data ?? []) as ObraAtualizacao[]
    },
  })
  // falha só desta seção: o resto do portal continua (nunca a página em branco)
  if (q.isPending) return <p className="text-sm text-muted">Carregando o andamento da obra…</p>
  if (q.error) return <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} />
  const obras = q.data
  if (!obras.length) return <p className="text-sm text-muted">As atualizações da obra aparecerão aqui.</p>
  const pct = obras.find((o) => o.percentual != null)?.percentual ?? null
  return (
    <div className="grid gap-5">
      {pct != null && (
        <div>
          <div className="flex justify-between text-sm"><span className="font-semibold">Andamento geral</span><span>{pct}%</span></div>
          <div className="mt-2 h-2.5 overflow-hidden bg-sand"><div className="h-full bg-bronze" style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      <ol className="grid gap-4 border-l border-line pl-5">
        {obras.map((o) => (
          <li key={o.id} className="relative">
            <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 bg-bronze" />
            <p className="text-xs text-muted">{data(o.data)}</p>
            <p className="font-semibold">{o.titulo}</p>
            {o.descricao && <p className="text-sm text-stone/80">{o.descricao}</p>}
            {o.fotos.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {o.fotos.map((f) => (
                  <a key={f} href={midiaUrl(f)!} target="_blank" rel="noreferrer"><img src={midiaUrl(f)!} alt="" loading="lazy" className="aspect-square w-full object-cover" /></a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * Portal do cliente (login só por CPF). Dados pessoais e de CRM só pelas RPCs portal_* (docs/ARQUITETURA_EXPANSAO.md
 * §6.7, N1): meus dados, seu corretor, documentos solicitados (só envio) e contratos (a partir de assinatura_pendente;
 * download só do PDF assinado). Negócios, arquivos e obra continuam pelas tabelas de exibição (políticas por
 * meu_cliente_id). Cada leitura das RPCs é auditada no servidor.
 */
export default function PortalCliente() {
  const { sair } = useAuth()
  // H1 (SEG-8): o login só por CPF é o mais fraco; a sessão persistida encerra depois de `sessao_inatividade_horas` sem uso
  useInatividade()
  const [baixando, setBaixando] = useState<string | null>(null)
  const dados = useQuery({ queryKey: ['portal', 'dados'], queryFn: () => portalMeusDados() })
  const liberado = !!dados.data
  const clienteId = dados.data?.id ?? null
  const corretor = useQuery({ queryKey: ['portal', 'corretor'], queryFn: () => portalMeuCorretor(), enabled: liberado })
  const documentos = useQuery({ queryKey: ['portal', 'documentos'], queryFn: () => portalDocumentos(), enabled: liberado })
  const contratos = useQuery({ queryKey: ['portal', 'contratos'], queryFn: () => portalContratos(), enabled: liberado })
  // negócios e arquivos em consultas separadas: uma falha não some com a outra, e nunca vira "nenhum imóvel/arquivo"
  const negociosQ = useQuery({
    queryKey: ['portal', 'negocios', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data, error } = await supabase.from('cliente_negocios')
        .select('*, empreendimentos(nome, slug, capa_url), unidades(identificador, metragem)').eq('cliente_id', clienteId!).order('created_at')
      if (error) throw traduzirErro(error)
      return (data ?? []) as ClienteNegocio[]
    },
  })
  const arquivosQ = useQuery({
    queryKey: ['portal', 'arquivos', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data, error } = await supabase.from('cliente_arquivos').select('*').eq('cliente_id', clienteId!).order('created_at', { ascending: false })
      if (error) throw traduzirErro(error)
      return (data ?? []) as ClienteArquivo[]
    },
  })

  async function baixarArquivo(a: ClienteArquivo) {
    // abre a janela ANTES do await (o Safari do iPhone bloqueia pop-up aberto depois) e troca o endereço quando a URL chegar
    const janela = window.open('', '_blank')
    if (janela) janela.opener = null
    setBaixando(a.id)
    try {
      const { data: s, error } = await supabase.storage.from('cliente-arquivos').createSignedUrl(a.storage_path, 60)
      if (error || !s?.signedUrl) throw error ?? new ErroRpc('DESCONHECIDO', 'Não foi possível gerar o link do arquivo. Tente de novo.')
      if (janela) janela.location.href = s.signedUrl
      else window.location.assign(s.signedUrl)
    } catch (e) {
      janela?.close()
      toast.error(mensagemErro(e))
    } finally {
      setBaixando(null)
    }
  }

  if (dados.isPending) return <div className="pt-10"><Carregando /></div>
  if (dados.error) return <div className="container-x py-20"><ErroConsulta erro={dados.error} tentarDeNovo={dados.refetch} /></div>
  if (!dados.data) {
    return (
      <div className="container-x grid gap-6 py-20">
        <Vazio titulo="Cadastro não encontrado" texto="Fale com nosso atendimento para liberar o seu acesso ao portal." />
        <button onClick={sair} className="btn-ghost justify-self-center"><LogOut size={16} /> Sair</button>
      </div>
    )
  }

  const d = dados.data
  const negocios = negociosQ.data ?? []
  const arquivos = arquivosQ.data ?? []

  return (
    <section className="container-x py-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Portal do cliente</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Bem-vindo(a), {d.nome.split(' ')[0]}</h1>
        </div>
        <button onClick={sair} className="btn-ghost self-start"><LogOut size={16} /> Sair</button>
      </div>

      <div className="mt-10 grid gap-8">
        {negociosQ.isPending ? <Carregando /> : negociosQ.error ? <ErroConsulta erro={negociosQ.error} tentarDeNovo={negociosQ.refetch} /> : negocios.length === 0 ? <Vazio titulo="Nenhum imóvel vinculado ainda" /> : negocios.map((n) => (
          <article key={n.id} className="card overflow-hidden lg:grid lg:grid-cols-[360px_1fr]">
            <Imagem src={n.empreendimentos?.capa_url} alt={n.empreendimentos?.nome ?? ''} className="aspect-[16/10] h-full w-full object-cover" />
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="display text-3xl">{n.empreendimentos?.nome ?? n.descricao}</h2>
                  <p className="text-sm text-muted">
                    {[n.unidades?.identificador, n.unidades?.metragem && `${n.unidades.metragem} m²`, n.valor && brl(n.valor)].filter(Boolean).join(' · ') || n.descricao}
                  </p>
                </div>
                {n.empreendimentos?.slug && <Link to={`/empreendimentos/${n.empreendimentos.slug}`} className="text-sm font-semibold text-bronze">Ver empreendimento →</Link>}
              </div>
              <h3 className="mt-6 mb-4 flex items-center gap-2 font-semibold"><HardHat size={18} className="text-bronze" /> Andamento da obra</h3>
              {n.empreendimento_id ? <Andamento empreendimentoId={n.empreendimento_id} /> : <p className="text-sm text-muted">—</p>}
            </div>
          </article>
        ))}

        {contratos.error ? <ErroConsulta erro={contratos.error} tentarDeNovo={contratos.refetch} /> : contratos.data && <MeusContratos contratos={contratos.data} />}

        {documentos.isPending ? null : documentos.error
          ? <ErroConsulta erro={documentos.error} tentarDeNovo={documentos.refetch} />
          : <DocumentosSolicitados clienteId={d.id} documentos={documentos.data ?? []} />}

        <div className="card p-6 sm:p-8">
          <h2 className="flex items-center gap-2 font-semibold"><FileText size={18} className="text-bronze" /> Meus arquivos</h2>
          {arquivosQ.isPending ? <p className="mt-3 text-sm text-muted">Carregando…</p> : arquivosQ.error ? (
            <div className="mt-3"><ErroConsulta erro={arquivosQ.error} tentarDeNovo={arquivosQ.refetch} /></div>
          ) : arquivos.length === 0 ? <p className="mt-3 text-sm text-muted">Nenhum arquivo disponível.</p> : (
            <ul className="mt-4 divide-y divide-line">
              {arquivos.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3 text-sm">
                  <span>{a.nome}<span className="ml-2 text-xs text-muted">{data(a.created_at)}</span></span>
                  <button type="button" onClick={() => baixarArquivo(a)} disabled={baixando === a.id} aria-label={`Baixar ${a.nome}`}
                    className="flex items-center gap-1.5 font-semibold text-bronze disabled:opacity-50"><Download size={15} /> {baixando === a.id ? 'Preparando…' : 'Baixar'}</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <MeusDados d={d} />
          {corretor.data ? <MeuCorretor c={corretor.data} /> : corretor.error ? <ErroConsulta erro={corretor.error} tentarDeNovo={corretor.refetch} /> : null}
        </div>
      </div>
    </section>
  )
}

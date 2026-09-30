import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, FileText, Send } from 'lucide-react'
import { contratoAtualizarSimulacao, contratoDetalhe, contratoMudarStatus } from '@/lib/rpc'
import { ErroRpc, mensagemErro } from '@/lib/erros'
import { FORMAS_PAGAMENTO, MODELOS_CONTRATO, STATUS_CONTRATO } from '@/lib/constants'
import { codigoExibicao, dataHora } from '@/lib/format'
import type { StatusContrato } from '@/lib/types'
import { ROTULOS_VARIAVEIS, type NomeVariavel } from '@shared/modelo-contrato'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ErroConsulta } from '@/components/app/Consulta'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Etiqueta, SeloStatus } from '@/components/app/Etiqueta'
import { EstadoAcesso } from '@/components/app/EstadoAcesso'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { useBase } from '@/components/app/useBase'
import { Carregando } from '@/components/Estados'
import { abrirPdf, chavesContratos, ehUuid, gerarPdf } from '../api'
import { FormSimulacao } from '../componentes/FormSimulacao'
import { ModalEnvio } from '../componentes/ModalEnvio'
import { PainelAssinatura } from '../componentes/PainelAssinatura'
import { TextoContrato } from '../componentes/TextoContrato'
import { ValoresSimulacao } from '../componentes/ValoresSimulacao'
import { argsAtualizar, valoresDoContrato } from '../simulacao-form'
import type { ContratoDetalhe, DestinoStatusContrato } from '../tipos'

const ROTULO_DESTINO: Partial<Record<StatusContrato, string>> = {
  documentacao_pendente: 'Documentação pendente',
  em_analise: 'Enviar para análise',
  rascunho: 'Devolver para rascunho',
  arquivado: 'Arquivar',
}

function Secao({ titulo, children, acoes }: { titulo: string; children: ReactNode; acoes?: ReactNode }) {
  return (
    <section className="card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{titulo}</h3>
        {acoes}
      </div>
      {children}
    </section>
  )
}

/**
 * Contrato (§7.3): produto, simulação (prévia @shared/simulacao; valores oficiais do servidor), texto, PDF, envio para
 * análise (parceiros) ou assinatura (internos) e painel de assinaturas. Tudo por RPC/Edge com escopo e auditoria; as
 * permissões da tela vêm do servidor (contrato_detalhe) e são conferidas de novo em cada ação.
 */
export default function Contrato() {
  const { id = '' } = useParams()
  const base = useBase()
  const valido = ehUuid(id)
  const q = useQuery({ queryKey: chavesContratos.detalhe(id), queryFn: () => contratoDetalhe({ p_id: id }), enabled: valido })

  const semAcesso = (
    <EstadoAcesso tipo="sem_permissao" inline detalhe="Contrato não encontrado ou fora do seu escopo."
      acao={<Link to={`${base}/contratos`} className="btn-primary">Ver contratos</Link>} />
  )
  if (!valido) return semAcesso
  if (q.isPending) return <Carregando />
  if (q.error) return <ErroConsulta erro={q.error} tentarDeNovo={q.refetch} />
  if (!q.data) return semAcesso
  return <DetalheContrato k={q.data} />
}

function DetalheContrato({ k }: { k: ContratoDetalhe }) {
  const base = useBase()
  const qc = useQueryClient()
  const [destino, setDestino] = useState<DestinoStatusContrato | null>(null)
  const [envio, setEnvio] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [versao, setVersao] = useState<number | null>(null)
  const recarregar = () => qc.invalidateQueries({ queryKey: chavesContratos.todos })

  async function gerar() {
    setGerando(true)
    try {
      const r = await gerarPdf(k.id)
      toast.success(`PDF gerado (versão ${r.versao}).`)
      await recarregar()
    } catch (e) {
      const d = e instanceof ErroRpc ? (e.detalhe as { vazias?: string[]; desconhecidas?: string[] } | null) : null
      const faltando = [...(d?.vazias ?? []), ...(d?.desconhecidas ?? [])]
      toast.error(faltando.length
        ? `Faltam dados: ${faltando.map((v) => ROTULOS_VARIAVEIS[v as NomeVariavel] ?? v).join(', ')}.`
        : mensagemErro(e))
    } finally {
      setGerando(false)
    }
  }

  async function baixar(v: number | null) {
    try {
      await abrirPdf(k.id, 'minuta', v)
    } catch (e) {
      toast.error(mensagemErro(e))
    }
  }

  const destinos = k.destinos_status.filter((d) => d.para !== 'cancelado' && ROTULO_DESTINO[d.para])
  const emAndamento = ['rascunho', 'documentacao_pendente', 'em_analise'].includes(k.status)
  // versões anteriores guardadas no bucket (os números podem pular: a simulação alterada avança a versão esperada)
  const anteriores = (k.pdf.versoes ?? []).filter((v) => v !== k.pdf.versao)
  // envio para assinatura em andamento (trava de 15 min): o servidor recusa mudar status, gerar PDF e enviar de novo
  const enviando = k.status === 'em_analise' && k.envio_em_andamento

  return (
    <>
      <CabecalhoPagina
        voltar={{ para: `${base}/contratos`, rotulo: 'Contratos' }}
        eyebrow={MODELOS_CONTRATO[k.modelo.chave]}
        titulo={<span className="flex flex-wrap items-center gap-3">Contrato {codigoExibicao(k.codigo)} <SeloStatus tipo="contrato" valor={k.status} /></span>}
        subtitulo={
          <span>
            Cliente <Link to={`${base}/crm/${k.cliente.id}`} className="text-bronze hover:underline">{k.cliente.nome}</Link>
            {' · '}{k.produto.nome}{' · '}{FORMAS_PAGAMENTO[k.forma_pagamento]}
          </span>
        }
      />

      <div className="grid gap-4">
        {k.observacao && emAndamento && (
          <p className="border border-bronze/40 bg-bronze/5 px-4 py-3 text-sm"><span className="font-semibold">Devolvido pela equipe Arken:</span> {k.observacao}</p>
        )}
        {k.valor_produto_alterado && emAndamento && (
          <p className="border border-bronze/40 bg-bronze/5 px-4 py-3 text-sm">
            O valor do produto mudou depois da simulação (hoje {k.produto.valor == null ? 'sem valor' : k.produto.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).
            O envio para assinatura fica bloqueado até a simulação ser salva de novo em rascunho (N16).
          </p>
        )}
        {enviando && (
          <p className="border border-bronze/40 bg-bronze/5 px-4 py-3 text-sm" role="status">
            Envio para assinatura em andamento. Aguarde alguns instantes e atualize a página; enquanto isso o contrato não pode ser alterado.
          </p>
        )}
        {k.status === 'assinado' && (
          <p className="border border-sage/40 bg-sage/10 px-4 py-3 text-sm">
            Contrato assinado por todos em {dataHora(k.assinado_em)}. Geração de parcelas: etapa financeira (pendente).
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-6">
          <Secao titulo="Simulação" acoes={<SeloProvisorio codigo="N17" />}>
            {k.permissoes.editar_simulacao ? (
              <div className="grid gap-6">
                <FormSimulacao
                  valorProduto={k.produto.valor}
                  inicial={{ forma: k.forma_pagamento, perc_aporte: k.perc_aporte, entrada: k.valor_entrada, n_parcelas: k.n_parcelas }}
                  rotuloSalvar="Salvar simulação"
                  aoSalvar={async (e) => {
                    await contratoAtualizarSimulacao(argsAtualizar(k.id, e))
                    toast.success('Simulação salva. Os valores abaixo são os oficiais, calculados pelo servidor.')
                    await recarregar()
                  }}
                />
                <div>
                  <p className="eyebrow mb-3">Valores oficiais (servidor)</p>
                  <ValoresSimulacao v={valoresDoContrato(k)} rotulo="Valores oficiais do contrato" />
                </div>
              </div>
            ) : <ValoresSimulacao v={valoresDoContrato(k)} rotulo="Valores oficiais do contrato" />}
          </Secao>

          {emAndamento && k.permissoes.gerar_pdf && (
            <Secao titulo="Texto do contrato">
              <TextoContrato contratoId={k.id} clienteId={k.cliente.id} fichaBase={base} />
            </Secao>
          )}

          <Secao
            titulo="PDF da minuta"
            acoes={k.permissoes.gerar_pdf && (
              <button type="button" className="btn-primary" onClick={gerar} disabled={gerando}>
                <FileText size={16} aria-hidden /> {gerando ? 'Gerando…' : k.pdf.disponivel ? 'Gerar nova versão' : 'Gerar PDF'}
              </button>
            )}
          >
            {!k.pdf.disponivel ? <p className="text-sm text-muted">Ainda não há PDF gerado.</p> : (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>Versão {k.pdf.versao} · gerada em {dataHora(k.pdf.gerado_em)}</span>
                {k.pdf.desatualizado && <Etiqueta tom="alerta">Desatualizado</Etiqueta>}
                {k.permissoes.baixar_minuta && (
                  <>
                    {anteriores.length > 0 && (
                      <select className="input w-auto" aria-label="Versão para baixar" value={versao ?? ''} onChange={(e) => setVersao(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">Versão atual</option>
                        {anteriores.map((v) => <option key={v} value={v}>Versão {v}</option>)}
                      </select>
                    )}
                    <button type="button" className="btn-ghost" onClick={() => baixar(versao)}><Download size={16} aria-hidden /> Baixar</button>
                  </>
                )}
              </div>
            )}
          </Secao>

          {['assinatura_pendente', 'assinado', 'recusado', 'expirado', 'cancelado'].includes(k.status) && (
            <Secao titulo="Assinaturas (D4Sign)">
              <PainelAssinatura k={k} />
            </Secao>
          )}
        </div>

        <aside className="grid content-start gap-6">
          <Secao titulo="Ações">
            <div className="grid gap-3">
              {k.permissoes.enviar_assinatura && !enviando && (
                <button type="button" className="btn-primary" onClick={() => setEnvio(true)}><Send size={16} aria-hidden /> Enviar para assinatura</button>
              )}
              {destinos.map((d) => (
                <button key={d.para} type="button" className={d.para === 'em_analise' ? 'btn-primary' : 'btn-ghost'} onClick={() => setDestino(d)}>
                  {ROTULO_DESTINO[d.para]}
                </button>
              ))}
              {(!k.permissoes.enviar_assinatura || enviando) && !destinos.length && <p className="text-sm text-muted">Nenhuma ação disponível neste status.</p>}
              {k.status === 'em_analise' && !k.permissoes.enviar_assinatura && (
                <p className="text-xs text-muted">Em análise pela equipe Arken, que envia para assinatura.</p>
              )}
            </div>
          </Secao>

          <Secao titulo="Cadeia">
            <dl className="grid gap-2 text-sm">
              {k.cadeia.corretor && <div><dt className="text-muted">Corretor</dt><dd>{k.cadeia.corretor.nome}</dd></div>}
              {k.cadeia.gerente && <div><dt className="text-muted">Gerente</dt><dd>{k.cadeia.gerente.nome}</dd></div>}
              {k.cadeia.imobiliaria && <div><dt className="text-muted">Imobiliária</dt><dd>{k.cadeia.imobiliaria.nome}</dd></div>}
              {!emAndamento && <p className="text-xs text-muted">Congelada no envio para assinatura.</p>}
            </dl>
          </Secao>

          <Secao titulo="Histórico">
            <dl className="grid gap-2 text-sm">
              <div><dt className="text-muted">Criado</dt><dd>{dataHora(k.criado_em)}{k.criado_por ? ` · ${k.criado_por.nome}` : ''}</dd></div>
              {k.enviado_assinatura_em && <div><dt className="text-muted">Enviado para assinatura</dt><dd>{dataHora(k.enviado_assinatura_em)}{k.enviado_por ? ` · ${k.enviado_por.nome}` : ''}</dd></div>}
              {k.assinado_em && <div><dt className="text-muted">Assinado</dt><dd>{dataHora(k.assinado_em)}</dd></div>}
              {k.encerrado_em && <div><dt className="text-muted">Encerrado</dt><dd>{dataHora(k.encerrado_em)} · {STATUS_CONTRATO[k.status].rotulo}</dd></div>}
              <div><dt className="text-muted">Modelo</dt><dd>{k.modelo.titulo} · v{k.modelo.versao}{k.modelo.liberado_para_envio ? '' : ' (não liberado)'}</dd></div>
            </dl>
          </Secao>
        </aside>
      </div>

      <ConfirmarModal
        aberto={!!destino} aoFechar={() => setDestino(null)}
        titulo={destino ? ROTULO_DESTINO[destino.para] ?? 'Mudar status' : ''}
        texto={destino?.para === 'em_analise' ? 'A equipe Arken confere o contrato e envia para assinatura.' : destino?.para === 'arquivado' ? 'O contrato fica só como histórico e o produto volta a ficar disponível.' : undefined}
        perigo={destino?.para === 'arquivado'}
        motivo={destino?.exige_motivo ? { rotulo: destino.para === 'rascunho' ? 'Observação para quem vai corrigir' : 'Motivo', minimo: 3 } : undefined}
        aoConfirmar={async (motivo) => {
          if (!destino) return
          await contratoMudarStatus({ p_id: k.id, p_para: destino.para, p_motivo: motivo })
          toast.success('Status atualizado.')
          await recarregar()
        }}
      />
      {k.permissoes.enviar_assinatura && <ModalEnvio k={k} aberto={envio} aoFechar={() => setEnvio(false)} />}
    </>
  )
}

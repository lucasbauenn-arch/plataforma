import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, Upload } from 'lucide-react'
import { crmLiberarPortal } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import { mensagemErro, traduzirErro } from '@/lib/erros'
import { useEmpreendimentos } from '@/hooks/queries'
import { brl, data, dataHora, moedaParaNumero } from '@/lib/format'
import type { ClienteArquivo, ClienteNegocio, PortalAcesso } from '@/lib/types'
import { Carregando } from '@/components/Estados'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Etiqueta } from '@/components/app/Etiqueta'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { MarcosEquipe } from '@/modulos/portal/componentes/MarcosEquipe'
import { chavesPortal } from '@/modulos/portal/rotulos'
import { SolicitacoesEquipe } from '@/modulos/portal/componentes/SolicitacoesEquipe'
import type { PropsAbaFicha } from '../tipos'

type Remocao = { tipo: 'negocio'; item: ClienteNegocio } | { tipo: 'arquivo'; item: ClienteArquivo }

/**
 * Aba Portal [WP2] (só internos; é o antigo /admin/clientes): liberar ou fechar o portal por CPF
 * (crm_liberar_portal, auditada; só PF com CPF — N1/N9), últimos acessos (sem IP na tela: minimização), negócios e
 * arquivos exibidos ao cliente. Negócios e arquivos continuam como hoje: conteúdo que a Arken gerencia pela API, com a
 * RLS de admin (§1.3). Decisão do dono (29/09/2026): os marcos da compra de cada negócio (datas que o cliente vê na
 * linha do tempo do portal) e as solicitações que o cliente abriu pelo portal.
 */
export default function AbaPortal({ clienteId, ficha, recarregarFicha }: PropsAbaFicha) {
  const qc = useQueryClient()
  const { cliente, permissoes } = ficha
  const [alternar, setAlternar] = useState(false)
  const [remover, setRemover] = useState<Remocao | null>(null)
  const { data: emps = [] } = useEmpreendimentos()
  const chave = ['crm-portal', clienteId] as const
  const q = useQuery({
    queryKey: chave,
    enabled: permissoes.ver_portal,
    queryFn: async () => {
      const [neg, arq, ac] = await Promise.all([
        supabase.from('cliente_negocios').select('*, empreendimentos(nome, slug, capa_url)').eq('cliente_id', clienteId).order('created_at', { ascending: false }),
        supabase.from('cliente_arquivos').select('*').eq('cliente_id', clienteId).order('created_at', { ascending: false }),
        supabase.from('portal_acessos').select('id, sucesso, created_at').eq('cliente_id', clienteId).order('created_at', { ascending: false }).limit(10),
      ])
      for (const r of [neg, arq, ac]) if (r.error) throw traduzirErro(r.error)
      return {
        negocios: (neg.data ?? []) as ClienteNegocio[],
        arquivos: (arq.data ?? []) as ClienteArquivo[],
        acessos: (ac.data ?? []) as Pick<PortalAcesso, 'id' | 'sucesso' | 'created_at'>[],
      }
    },
  })
  const recarregar = () => Promise.all([
    qc.invalidateQueries({ queryKey: chave }),
    qc.invalidateQueries({ queryKey: chavesPortal.marcosEquipe(clienteId) }),
  ])

  if (!permissoes.ver_portal) return <p className="text-sm text-muted">Esta aba é só da equipe Arken.</p>

  async function confirmarAlternar() {
    await crmLiberarPortal({ p_id: clienteId, p_liberar: !cliente.portal_liberado })
    toast.success(cliente.portal_liberado ? 'Acesso ao portal fechado.' : 'Acesso ao portal liberado.')
    recarregarFicha()
  }

  async function adicionarNegocio(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const form = ev.currentTarget
    const f = new FormData(form)
    const valorTexto = String(f.get('valor') ?? '')
    const valor = valorTexto ? moedaParaNumero(valorTexto) : null
    if (valorTexto && valor === null) return toast.error('Valor inválido')
    const { error } = await supabase.from('cliente_negocios').insert({
      cliente_id: clienteId, empreendimento_id: (f.get('emp') as string) || null, descricao: (f.get('desc') as string)?.trim() || null, valor,
    })
    if (error) return toast.error(mensagemErro(error))
    form.reset()
    void recarregar()
  }

  async function enviarArquivos(ev: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(ev.target.files ?? [])
    for (const a of arquivos) {
      const caminho = `${clienteId}/${Date.now()}-${a.name.replace(/[^\w.-]+/g, '_')}`
      const up = await supabase.storage.from('cliente-arquivos').upload(caminho, a)
      if (up.error) { toast.error(`Falha ao enviar ${a.name}`); continue }
      const { error } = await supabase.from('cliente_arquivos').insert({ cliente_id: clienteId, nome: a.name, storage_path: caminho })
      if (error) toast.error(`Falha ao registrar ${a.name}`)
    }
    ev.target.value = ''
    void recarregar()
    if (arquivos.length) toast.success('Arquivos enviados.')
  }

  async function confirmarRemocao() {
    if (!remover) return
    if (remover.tipo === 'negocio') {
      const { error } = await supabase.from('cliente_negocios').delete().eq('id', remover.item.id)
      if (error) throw traduzirErro(error)
    } else {
      const st = await supabase.storage.from('cliente-arquivos').remove([remover.item.storage_path])
      if (st.error) throw traduzirErro(st.error)
      const { error } = await supabase.from('cliente_arquivos').delete().eq('id', remover.item.id)
      if (error) throw traduzirErro(error)
    }
    toast.success('Removido.')
    void recarregar()
  }

  const podeLiberar = permissoes.liberar_portal && !cliente.portal_liberado
  const podeFechar = cliente.portal_liberado

  return (
    <div className="grid gap-6">
      <section className="card grid gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Acesso ao portal</h3>
          <div className="flex items-center gap-3">
            {cliente.portal_liberado ? <Etiqueta tom="ok">Liberado</Etiqueta> : <Etiqueta>Fechado</Etiqueta>}
            {cliente.tem_login_portal ? <Etiqueta tom="neutro">Já entrou no portal</Etiqueta> : <span className="text-xs text-muted">Nunca entrou</span>}
          </div>
        </div>
        <p className="text-sm text-muted">
          O portal é acessado só com o CPF do titular. Libere apenas para compradores (pessoa física com CPF).
          <span className="ml-2"><SeloProvisorio codigo="N1" /></span>
        </p>
        {(podeLiberar || podeFechar) && (
          <button type="button" className={podeFechar ? 'btn-ghost justify-self-start' : 'btn-primary justify-self-start'} onClick={() => setAlternar(true)}>
            {podeFechar ? 'Fechar acesso ao portal' : 'Liberar acesso ao portal'}
          </button>
        )}
        {!podeLiberar && !podeFechar && (
          <p className="text-xs text-muted">O portal só pode ser liberado para pessoa física com CPF e cliente ativo.</p>
        )}
      </section>

      {q.isPending ? <Carregando /> : q.error ? <p className="text-sm text-perigo">{mensagemErro(q.error)}</p> : (
        <>
          <section className="card p-6">
            <h3 className="mb-4 text-lg font-semibold">Negócios / imóveis exibidos no portal</h3>
            <ul className="mb-4 grid gap-2 text-sm">
              {q.data.negocios.length === 0 && <li className="text-muted">Nenhum negócio.</li>}
              {q.data.negocios.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3 bg-sand/40 px-4 py-2">
                  <span>{n.empreendimentos?.nome ?? n.descricao ?? 'Negócio'}{n.valor ? ` · ${brl(n.valor)}` : ''}</span>
                  <button type="button" aria-label="Remover negócio" className="text-muted hover:text-perigo" onClick={() => setRemover({ tipo: 'negocio', item: n })}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
            <form onSubmit={adicionarNegocio} className="grid gap-2 sm:grid-cols-[1fr_1fr_160px_auto]">
              <label className="sr-only" htmlFor="portal-emp">Empreendimento</label>
              <select id="portal-emp" name="emp" className="input py-2"><option value="">Empreendimento…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
              <input name="desc" aria-label="Unidade ou descrição" className="input py-2" placeholder="Unidade / descrição" maxLength={200} />
              <input name="valor" aria-label="Valor" className="input py-2" placeholder="Valor (R$)" inputMode="decimal" />
              <button type="submit" className="btn-primary py-2"><Plus size={15} aria-hidden /> Adicionar</button>
            </form>
          </section>

          {q.data.negocios.length > 0 && <MarcosEquipe clienteId={clienteId} />}

          <section className="card p-6" aria-labelledby="solicitacoes-cliente">
            <h3 id="solicitacoes-cliente" className="mb-4 text-lg font-semibold">Solicitações pelo portal</h3>
            <SolicitacoesEquipe clienteId={clienteId} />
          </section>

          <section className="card p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">Arquivos do portal</h3>
              <label className="btn-ghost cursor-pointer py-2"><Upload size={15} aria-hidden /> Enviar arquivos
                <input type="file" multiple className="sr-only" onChange={(e) => void enviarArquivos(e)} />
              </label>
            </div>
            <ul className="divide-y divide-line text-sm">
              {q.data.arquivos.length === 0 && <li className="py-2 text-muted">Nenhum arquivo.</li>}
              {q.data.arquivos.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{a.nome} <span className="text-xs text-muted">{data(a.created_at)}</span></span>
                  <button type="button" aria-label="Remover arquivo" className="text-muted hover:text-perigo" onClick={() => setRemover({ tipo: 'arquivo', item: a })}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-6">
            <h3 className="mb-4 text-lg font-semibold">Últimos acessos</h3>
            {q.data.acessos.length === 0 ? <p className="text-sm text-muted">Nenhum acesso registrado.</p> : (
              <ul className="grid gap-1 text-sm">
                {q.data.acessos.map((a) => (
                  <li key={a.id} className="flex items-center gap-3">
                    <span className="text-muted">{dataHora(a.created_at)}</span>
                    {a.sucesso ? <Etiqueta tom="ok">Entrou</Etiqueta> : <Etiqueta tom="erro">Falhou</Etiqueta>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <ConfirmarModal
        aberto={alternar}
        titulo={cliente.portal_liberado ? 'Fechar o acesso ao portal?' : 'Liberar o acesso ao portal?'}
        texto={cliente.portal_liberado
          ? 'O cliente deixa de entrar no portal com o CPF. Os dados continuam guardados.'
          : 'O cliente passa a entrar no portal só com o CPF e verá documentos solicitados, contratos e o corretor.'}
        rotuloConfirmar={cliente.portal_liberado ? 'Fechar acesso' : 'Liberar acesso'}
        perigo={cliente.portal_liberado}
        aoConfirmar={confirmarAlternar} aoFechar={() => setAlternar(false)}
      />
      <ConfirmarModal
        aberto={!!remover} titulo={remover?.tipo === 'arquivo' ? 'Remover este arquivo?' : 'Remover este negócio?'} perigo rotuloConfirmar="Remover"
        texto="O cliente deixa de ver este item no portal."
        aoConfirmar={confirmarRemocao} aoFechar={() => setRemover(null)}
      />
    </div>
  )
}

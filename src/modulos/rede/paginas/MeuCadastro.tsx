import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { CircleAlert, Pencil, ScrollText } from 'lucide-react'
import { useEscopo } from '@/lib/escopo'
import { lgpdAceitarTermo } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { dataHora, mascaraCpf, mascaraTelefone } from '@/lib/format'
import { TIPOS_PARCEIRO } from '@/lib/constants'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { Consulta, ErroConsulta } from '@/components/app/Consulta'
import { Etiqueta } from '@/components/app/Etiqueta'
import { Carregando } from '@/components/Estados'
import { useParceiroDetalhe, useTermoParceiro } from '../api'
import { FormParceiro } from '../componentes/FormParceiro'

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{rotulo}</dt>
      <dd className="mt-1 break-words">{children || '—'}</dd>
    </div>
  )
}

/** Aceite do termo vigente de parceiro (pendência "termo": até aceitar, só esta tela abre no painel). */
function AceiteTermo({ aoAceitar }: { aoAceitar: () => void }) {
  const termo = useTermoParceiro()
  const [li, setLi] = useState(false)
  const [enviando, setEnviando] = useState(false)

  async function aceitar(id: string) {
    setEnviando(true)
    try {
      await lgpdAceitarTermo({ p_termo_id: id })
      toast.success('Termos aceitos. Obrigado!')
      aoAceitar()
    } catch (e) {
      toast.error(mensagemErro(e))
    } finally {
      setEnviando(false)
    }
  }

  if (termo.isPending) return <Carregando texto="Carregando os termos…" />
  if (termo.error) return <ErroConsulta erro={termo.error} tentarDeNovo={termo.refetch} />
  if (!termo.data) return <p className="text-sm text-muted">Nenhum termo vigente no momento.</p>
  const t = termo.data
  return (
    <div className="grid gap-4">
      <p className="text-sm text-stone/85">Versão <strong>{t.versao}</strong>, vigente desde {dataHora(t.vigente_desde)}.</p>
      <div className="max-h-80 overflow-y-auto border border-line bg-ink p-4 text-sm leading-relaxed whitespace-pre-line text-stone/85" tabIndex={0}>
        {t.texto}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 accent-bronze" checked={li} onChange={(e) => setLi(e.target.checked)} />
        Li e aceito os termos de uso e a política de privacidade da área do parceiro.
      </label>
      <button type="button" className="btn-primary justify-self-start" disabled={!li || enviando} onClick={() => aceitar(t.id)}>
        {enviando ? 'Registrando…' : 'Aceitar os termos'}
      </button>
    </div>
  )
}

/**
 * [WP1] Painel › Meu cadastro (§7.2): o parceiro completa CPF e CRECI (PAR-4; os legados migrados chegam com
 * pendência) e ajusta nome e telefone (rede_atualizar_meu_cadastro). Também é onde aceita o termo vigente
 * (lgpd_aceitar_termo) — com a pendência "termo", é a única tela que abre no painel.
 */
export default function MeuCadastro() {
  const { escopo, recarregar } = useEscopo()
  const [editar, setEditar] = useState(false)
  const pendencias = escopo?.pendencias ?? []
  const detalhe = useParceiroDetalhe(escopo?.parceiro_id)

  return (
    <section className="grid gap-8">
      <CabecalhoPagina titulo="Meu cadastro" subtitulo="Seus dados na rede de parceiros da Arken." />

      {pendencias.includes('termo') && (
        <div className="card p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold"><ScrollText size={18} aria-hidden className="text-bronze" /> Termos atualizados</h3>
          <AceiteTermo aoAceitar={recarregar} />
        </div>
      )}

      {(pendencias.includes('cpf') || pendencias.includes('creci')) && (
        <p className="flex items-start gap-3 border border-bronze/40 bg-bronze/10 px-4 py-3 text-sm">
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0 text-bronze" />
          <span>
            Complete seu cadastro: falta informar {[pendencias.includes('cpf') && 'o CPF', pendencias.includes('creci') && 'o CRECI'].filter(Boolean).join(' e ')}.
            {' '}É exigência para atuar como {escopo?.tipo ? TIPOS_PARCEIRO[escopo.tipo].toLowerCase() : 'parceiro'} (PAR-4).
          </span>
        </p>
      )}

      {!escopo?.parceiro_id ? (
        <div className="card p-6 text-sm text-muted">
          Seu acesso ainda não está vinculado a uma imobiliária na rede. A equipe Arken faz esse vínculo; depois disso seus dados aparecem aqui.
        </div>
      ) : (
        <Consulta consulta={detalhe} tituloVazio="Cadastro indisponível" textoVazio="Não foi possível carregar seus dados.">
          {(p) => p && (
            <div className="card p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Dados</h3>
                <button type="button" className="btn-ghost" onClick={() => setEditar(true)}><Pencil size={16} aria-hidden /> Atualizar</button>
              </div>
              <dl className="grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Dado rotulo="Nome">{p.nome}</Dado>
                <Dado rotulo="CPF">{p.cpf ? mascaraCpf(p.cpf) : <Etiqueta tom="alerta">Pendente</Etiqueta>}</Dado>
                <Dado rotulo="CRECI">{p.creci ?? (p.tipo === 'corretor' ? <Etiqueta tom="alerta">Pendente</Etiqueta> : null)}</Dado>
                <Dado rotulo="E-mail (login)">{p.email}</Dado>
                <Dado rotulo="Telefone">{p.telefone ? mascaraTelefone(p.telefone) : null}</Dado>
                <Dado rotulo="Imobiliária">{p.imobiliaria.da_casa ? 'Imobiliária Arken' : p.imobiliaria.nome}</Dado>
                <Dado rotulo="Perfil">{TIPOS_PARCEIRO[p.tipo]}</Dado>
                <Dado rotulo="Na rede desde">{dataHora(p.criado_em)}</Dado>
              </dl>
              <FormParceiro aberto={editar} modo={{ tipo: 'meu', atual: p }} aoFechar={() => setEditar(false)} aoSalvar={() => recarregar()} />
            </div>
          )}
        </Consulta>
      )}
    </section>
  )
}

import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeftRight, Building2, Mail, Pencil, RotateCcw, ShieldCheck, ShieldOff, UserMinus, Users,
} from 'lucide-react'
import { useEscopo } from '@/lib/escopo'
import { redeBloquearParceiro, redeDesbloquearParceiro, redeReativarParceiro } from '@/lib/rpc'
import { dataHora, mascaraCpf, mascaraTelefone } from '@/lib/format'
import { PAPEIS, STATUS_PARCEIRO, TIPOS_PARCEIRO } from '@/lib/constants'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Consulta } from '@/components/app/Consulta'
import { Etiqueta, SeloStatus } from '@/components/app/Etiqueta'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { Tabela } from '@/components/app/Tabela'
import { useArea, useBase } from '@/components/app/useBase'
import { chavesRede, useParceiroDetalhe } from '../api'
import { acoesDoParceiro } from '../regras'
import type { ParceiroDetalhe as TDetalhe } from '../tipos'
import { FormParceiro } from '../componentes/FormParceiro'
import { ModalConvite } from '../componentes/ModalConvite'
import {
  ModalInativar, ModalMudarImobiliaria, ModalRegularizar, ModalTransferirClientes, ModalTransferirCorretor,
} from '../componentes/AcoesParceiro'

type Janela = 'editar' | 'convidar' | 'inativar' | 'transferir_corretor' | 'mudar_imobiliaria' | 'regularizar'
  | 'transferir_clientes' | 'bloquear' | 'desbloquear' | 'reativar' | null

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{rotulo}</dt>
      <dd className="mt-1 break-words">{children || '—'}</dd>
    </div>
  )
}

/**
 * [WP1] Detalhe do parceiro (rede_parceiro_detalhe, auditada: inclui CPF), em /admin/rede/parceiros/:id e
 * /parceiros/painel/equipe/:id. Dados, acesso (login, convite), vínculos com vigência (PAR-3: nomes acima de quem
 * consulta ficam ocultos) e as ações que a matriz libera: editar, convidar, transferir clientes ou corretor, mudar de
 * imobiliária e regularizar (Super), bloquear/desbloquear e reativar (internos), inativar com destino.
 */
export default function ParceiroDetalhe() {
  const { id } = useParams<{ id: string }>()
  const consulta = useParceiroDetalhe(id)
  return (
    <Consulta consulta={consulta} tituloVazio="Parceiro não encontrado" textoVazio="Ele não existe ou está fora do seu acesso.">
      {(p) => p && <Detalhe p={p} />}
    </Consulta>
  )
}

function Detalhe({ p }: { p: TDetalhe }) {
  const base = useBase()
  const area = useArea()
  const qc = useQueryClient()
  const { escopo, tem } = useEscopo()
  const [janela, setJanela] = useState<Janela>(null)
  const fechar = () => setJanela(null)
  const voltar = area === 'admin' ? { para: '/admin/rede', rotulo: 'Rede' } : { para: `${base}/equipe`, rotulo: 'Equipe' }

  async function recarregar() {
    await qc.invalidateQueries({ queryKey: chavesRede.tudo })
  }

  const a = acoesDoParceiro(escopo, p)
  const statusAcesso = p.inativado_em ? 'inativo' : p.status_parceiro
  return (
    <section>
      <CabecalhoPagina
        voltar={voltar}
        eyebrow={TIPOS_PARCEIRO[p.tipo]}
        titulo={p.nome}
        subtitulo={p.imobiliaria.da_casa ? 'Imobiliária Arken (casa)' : p.imobiliaria.nome}
        acoes={
          <>
            {a.editar && <button type="button" className="btn-ghost" onClick={() => setJanela('editar')}><Pencil size={16} aria-hidden /> Editar</button>}
            {a.convidar && <button type="button" className="btn-primary" onClick={() => setJanela('convidar')}><Mail size={16} aria-hidden /> {p.convite_pendente ? 'Reenviar convite' : 'Convidar'}</button>}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {statusAcesso ? <SeloStatus tipo="parceiro" valor={statusAcesso} /> : <Etiqueta tom="alerta">Sem login</Etiqueta>}
        {p.convite_pendente && <Etiqueta tom="alerta">Convite pendente</Etiqueta>}
        {p.virtual && <Etiqueta>Virtual (sem login)</Etiqueta>}
        {p.migrado_legado && <Etiqueta tom="alerta" titulo="Migrado do cadastro antigo">Legado</Etiqueta>}
        {p.papel && <Etiqueta>{PAPEIS[p.papel]}</Etiqueta>}
      </div>

      <dl className="card mb-6 grid gap-5 p-6 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Dado rotulo="CPF">{p.cpf ? mascaraCpf(p.cpf) : p.tipo !== 'imobiliaria' && !p.virtual ? <Etiqueta tom="alerta">Pendente</Etiqueta> : null}</Dado>
        <Dado rotulo="CRECI">{p.creci ?? (p.tipo === 'corretor' && !p.virtual ? <Etiqueta tom="alerta">Pendente</Etiqueta> : null)}</Dado>
        <Dado rotulo="E-mail">{p.email}</Dado>
        <Dado rotulo="Telefone">{p.telefone ? mascaraTelefone(p.telefone) : null}</Dado>
        <Dado rotulo="Imobiliária">
          {area === 'admin'
            ? <Link to={`/admin/rede/imobiliarias/${p.imobiliaria.id}`} className="hover:text-bronze">{p.imobiliaria.nome}</Link>
            : p.imobiliaria.nome}
        </Dado>
        <Dado rotulo="Gerente">{p.tipo === 'corretor' ? p.gerente?.nome ?? <span className="text-muted">—</span> : null}</Dado>
        <Dado rotulo="Último acesso">{p.ultimo_acesso_em ? dataHora(p.ultimo_acesso_em) : p.tem_login ? 'Nunca entrou' : 'Sem login'}</Dado>
        <Dado rotulo="Cadastrado em">{dataHora(p.criado_em)}</Dado>
        {p.tipo === 'gerente' && <Dado rotulo="Corretores ativos">{String(p.corretores_ativos)}</Dado>}
        <Dado rotulo="Clientes ativos">{String(p.clientes_ativos)}</Dado>
        {p.codigo_indicacao && <Dado rotulo="Código de indicação"><code>{p.codigo_indicacao}</code></Dado>}
        {p.imobiliaria_declarada && <Dado rotulo="Imobiliária declarada">{p.imobiliaria_declarada}</Dado>}
        {p.inativado_em && (
          <div className="sm:col-span-2">
            <Dado rotulo="Inativado em">{`${dataHora(p.inativado_em)}${p.motivo_inativacao ? ` — ${p.motivo_inativacao}` : ''}`}</Dado>
          </div>
        )}
      </dl>

      {(a.transferirClientes || a.transferirCorretor || a.mudarImobiliaria || a.regularizar || a.bloquear || a.desbloquear || a.reativar || a.inativar) && (
        <div className="card mb-8 flex flex-wrap gap-3 p-4">
          {a.transferirClientes && <button type="button" className="btn-ghost" onClick={() => setJanela('transferir_clientes')}><Users size={16} aria-hidden /> Transferir clientes</button>}
          {a.transferirCorretor && <button type="button" className="btn-ghost" onClick={() => setJanela('transferir_corretor')}><ArrowLeftRight size={16} aria-hidden /> Trocar de gerente</button>}
          {a.mudarImobiliaria && <button type="button" className="btn-ghost" onClick={() => setJanela('mudar_imobiliaria')}><Building2 size={16} aria-hidden /> Mudar de imobiliária</button>}
          {a.regularizar && <button type="button" className="btn-ghost" onClick={() => setJanela('regularizar')}><ShieldCheck size={16} aria-hidden /> Regularizar legado <SeloProvisorio codigo="N3" /></button>}
          {a.bloquear && <button type="button" className="btn-ghost" onClick={() => setJanela('bloquear')}><ShieldOff size={16} aria-hidden /> Bloquear acesso</button>}
          {a.desbloquear && <button type="button" className="btn-ghost" onClick={() => setJanela('desbloquear')}><ShieldCheck size={16} aria-hidden /> Desbloquear</button>}
          {a.reativar && <button type="button" className="btn-ghost" onClick={() => setJanela('reativar')}><RotateCcw size={16} aria-hidden /> Reativar</button>}
          {a.inativar && <button type="button" className="btn-ghost" onClick={() => setJanela('inativar')}><UserMinus size={16} aria-hidden /> Inativar</button>}
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Vínculos</h2>
      <Tabela legenda="Histórico de vínculos" minimo={560} colunas={['Imobiliária', 'Gerente', 'De', 'Até', 'Motivo']} vazio="Sem histórico.">
        {p.historico.map((h, i) => (
          <tr key={`${h.vigente_de}-${i}`}>
            <td>{h.imobiliaria?.nome ?? <span className="text-muted">—</span>}</td>
            <td>{h.gerente?.nome ?? <span className="text-muted">—</span>}</td>
            <td className="whitespace-nowrap">{dataHora(h.vigente_de)}</td>
            <td className="whitespace-nowrap">{h.vigente_ate ? dataHora(h.vigente_ate) : <Etiqueta tom="ok">Atual</Etiqueta>}</td>
            <td className="text-muted">{h.motivo ?? '—'}</td>
          </tr>
        ))}
      </Tabela>

      {p.status_historico && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-semibold">Histórico do acesso</h2>
          <Tabela legenda="Histórico do acesso" minimo={560} colunas={['Quando', 'De', 'Para', 'Motivo']} vazio="Sem mudanças de acesso registradas.">
            {p.status_historico.map((s, i) => (
              <tr key={`${s.ocorrido_em}-${i}`}>
                <td className="whitespace-nowrap">{dataHora(s.ocorrido_em)}</td>
                <td>{s.de ? STATUS_PARCEIRO[s.de] : '—'}</td>
                <td>{STATUS_PARCEIRO[s.para]}</td>
                <td className="text-muted">{s.motivo ?? '—'}</td>
              </tr>
            ))}
          </Tabela>
        </>
      )}

      <FormParceiro aberto={janela === 'editar'} modo={{ tipo: 'editar', atual: p, interno: !!escopo?.interno }} aoFechar={fechar} />
      <ModalConvite aberto={janela === 'convidar'} aoFechar={fechar} podeLink={tem('rede.convite_por_link')}
        convidados={[{ id: p.id, nome: p.nome, telefone: p.telefone }]} />
      <ModalInativar aberto={janela === 'inativar'} parceiro={p} aoFechar={fechar} />
      <ModalTransferirCorretor aberto={janela === 'transferir_corretor'} parceiro={p} aoFechar={fechar} />
      <ModalMudarImobiliaria aberto={janela === 'mudar_imobiliaria'} parceiro={p} aoFechar={fechar} />
      <ModalRegularizar aberto={janela === 'regularizar'} parceiro={p} aoFechar={fechar} />
      <ModalTransferirClientes aberto={janela === 'transferir_clientes'} parceiro={p} entreImobiliarias={!!escopo?.super} aoFechar={fechar} />
      <ConfirmarModal
        aberto={janela === 'bloquear'} aoFechar={fechar} perigo rotuloConfirmar="Bloquear" titulo={`Bloquear ${p.nome}`}
        texto="O bloqueio é temporário: o parceiro perde o acesso na hora e mantém a carteira. Para desligar de vez, use Inativar."
        motivo={{ rotulo: 'Motivo (fica no histórico do acesso)', minimo: 5 }}
        aoConfirmar={async (m) => { await redeBloquearParceiro({ p_id: p.id, p_motivo: m ?? '' }); toast.success('Acesso bloqueado.'); await recarregar() }}
      />
      <ConfirmarModal
        aberto={janela === 'desbloquear'} aoFechar={fechar} rotuloConfirmar="Desbloquear" titulo={`Desbloquear ${p.nome}`}
        texto="O acesso volta a funcionar com o mesmo escopo de antes."
        aoConfirmar={async () => { await redeDesbloquearParceiro({ p_id: p.id }); toast.success('Acesso desbloqueado.'); await recarregar() }}
      />
      <ConfirmarModal
        aberto={janela === 'reativar'} aoFechar={fechar} rotuloConfirmar="Reativar" titulo={`Reativar ${p.nome}`}
        texto="O vínculo volta a valer e o acesso é liberado de novo. A imobiliária (e, para corretor, o gerente) precisa estar ativa."
        aoConfirmar={async () => { await redeReativarParceiro({ p_id: p.id }); toast.success('Parceiro reativado.'); await recarregar() }}
      />
    </section>
  )
}

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { crmEditarCliente, crmFicha, crmInativarCliente } from '@/lib/rpc'
import { MENSAGENS } from '@/lib/erros'
import { ESTADOS_CIVIS, GENEROS, ORIGENS_CLIENTE, TIPOS_PESSOA } from '@/lib/constants'
import { data, dataHora, mascaraCep, mascaraDocumento, mascaraTelefone } from '@/lib/format'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { Etiqueta } from '@/components/app/Etiqueta'
import { avaliarEdicao, chavesCrm, paraEdicao, valoresDaFicha, type ValoresCliente } from '../api-clientes'
import { FormCliente } from '../componentes/FormCliente'
import { chaveFicha, type ClienteFicha, type ConsentimentoCliente, type PropsAbaFicha } from '../tipos'

const ORIGENS_CONSENTIMENTO: Record<ConsentimentoCliente['origem'], string> = {
  pre_cadastro_link: 'Aceite no pré-cadastro', declarado: 'Declarado no cadastro', cadastro_parceiro: 'Cadastro de parceiro',
  portal: 'Aceite no portal', migracao: 'Migração (sem aceite registrado)',
}

/**
 * Aba Dados da ficha [WP2]: edição por crm_editar_cliente (só as chaves que mudaram), CEP automático, consentimentos
 * LGPD e, para internos, a inativação (sem contrato ativo). CPF/CNPJ: parceiro só preenche quando está vazio. Se o
 * documento informado já existir em outro cliente, o servidor não grava o documento (a tentativa fica registrada) e
 * a tela avisa relendo a ficha.
 */
export default function AbaDados({ clienteId, ficha, recarregarFicha }: PropsAbaFicha) {
  const qc = useQueryClient()
  const { cliente, permissoes } = ficha
  const [editando, setEditando] = useState(false)
  const [inativar, setInativar] = useState(false)
  const inicial = useMemo(() => valoresDaFicha(cliente), [cliente])

  async function salvar(v: ValoresCliente) {
    const edicao = paraEdicao(v, cliente, permissoes.editar_documento)
    if (Object.keys(edicao).length === 0) {
      toast.info('Nada mudou.')
      setEditando(false)
      return
    }
    await crmEditarCliente({ p_id: clienteId, p_dados: edicao })
    const campoDoc = cliente.tipo_pessoa === 'fisica' ? 'cpf' : 'cnpj'
    if (edicao[campoDoc]) {
      // o servidor não grava documento que já existe em outro cliente (A2): confere relendo a ficha DO SERVIDOR (nunca
      // do cache, que ainda tem o documento vazio) e já guarda a ficha nova no cache
      const nova = await crmFicha({ p_id: clienteId })
      qc.setQueryData(chaveFicha(clienteId), nova)
      const { documentoRecusado, outrosCampos } = avaliarEdicao(edicao, cliente.tipo_pessoa, nova?.cliente ?? null)
      if (documentoRecusado) {
        toast.error(outrosCampos > 0
          ? `${MENSAGENS.DOCUMENTO_INDISPONIVEL} As demais alterações foram salvas.`
          : MENSAGENS.DOCUMENTO_INDISPONIVEL)
      } else {
        toast.success('Dados salvos.')
      }
    } else {
      toast.success('Dados salvos.')
    }
    setEditando(false)
    recarregarFicha()
    void qc.invalidateQueries({ queryKey: chavesCrm.listas })
  }

  async function confirmarInativacao(motivo: string | null) {
    await crmInativarCliente({ p_id: clienteId, p_motivo: motivo ?? '' })
    toast.success('Cliente inativado.')
    recarregarFicha()
    void qc.invalidateQueries({ queryKey: chavesCrm.listas })
  }

  if (editando) {
    return (
      <FormCliente
        modo="edicao" inicial={inicial} podeEditarDocumento={permissoes.editar_documento}
        rotuloEnviar="Salvar alterações" aoEnviar={salvar} aoCancelar={() => setEditando(false)}
      />
    )
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {ORIGENS_CLIENTE[cliente.origem]} · cadastrado em {data(cliente.criado_em)}
          {cliente.atualizado_em && ` · atualizado em ${dataHora(cliente.atualizado_em)}`}
        </p>
        <div className="flex flex-wrap gap-3">
          {permissoes.editar && <button type="button" className="btn-primary" onClick={() => setEditando(true)}>Editar dados</button>}
          {permissoes.inativar && <button type="button" className="btn-ghost" onClick={() => setInativar(true)}>Inativar cliente</button>}
        </div>
      </div>
      {cliente.inativado_em && (
        <p className="border border-line bg-sand/40 px-4 py-3 text-sm">
          Inativado em {dataHora(cliente.inativado_em)}{cliente.motivo_inativacao ? `: ${cliente.motivo_inativacao}` : ''}.
        </p>
      )}
      <Dados cliente={cliente} />
      <Consentimentos itens={ficha.consentimentos} />
      <ConfirmarModal
        aberto={inativar} titulo="Inativar este cliente?" perigo rotuloConfirmar="Inativar"
        texto="O cliente sai das listas e do funil dos parceiros. Os dados e o histórico ficam guardados. Clientes com contrato ativo não podem ser inativados."
        motivo={{ rotulo: 'Motivo da inativação' }} aoConfirmar={confirmarInativacao} aoFechar={() => setInativar(false)}
      />
    </div>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted uppercase">{rotulo}</dt>
      <dd className="mt-0.5 break-words">{valor || <span className="text-muted">—</span>}</dd>
    </div>
  )
}

function Dados({ cliente: c }: { cliente: ClienteFicha }) {
  const pf = c.tipo_pessoa === 'fisica'
  const endereco = [c.logradouro, c.numero, c.complemento].filter(Boolean).join(', ')
  const cidade = [c.bairro, c.cidade, c.uf].filter(Boolean).join(' · ')
  return (
    <>
      <section className="card p-6">
        <h3 className="mb-4 text-lg font-semibold">Identificação</h3>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Linha rotulo="Tipo" valor={TIPOS_PESSOA[c.tipo_pessoa]} />
          <Linha rotulo={pf ? 'CPF' : 'CNPJ'} valor={mascaraDocumento(pf ? c.cpf : c.cnpj)} />
          {pf && <Linha rotulo="RG" valor={c.rg} />}
          {pf && <Linha rotulo="Nascimento" valor={c.data_nascimento ? data(`${c.data_nascimento}T12:00:00`) : null} />}
          {pf && <Linha rotulo="Gênero" valor={c.genero ? GENEROS[c.genero] : null} />}
          {pf && <Linha rotulo="Estado civil" valor={c.estado_civil ? ESTADOS_CIVIS[c.estado_civil] : null} />}
          {pf && <Linha rotulo="Nacionalidade" valor={c.nacionalidade} />}
        </dl>
      </section>
      <section className="card p-6">
        <h3 className="mb-4 text-lg font-semibold">Contato</h3>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Linha rotulo="Telefone" valor={c.telefone ? mascaraTelefone(c.telefone) : null} />
          <Linha rotulo="E-mail" valor={c.email} />
          <Linha rotulo="Outros telefones" valor={c.telefones_adicionais.map(mascaraTelefone).join(', ')} />
          <Linha rotulo="Outros e-mails" valor={c.emails_adicionais.join(', ')} />
          <Linha rotulo="Horário de contato" valor={c.horario_contato} />
        </dl>
      </section>
      <section className="card p-6">
        <h3 className="mb-4 text-lg font-semibold">Endereço</h3>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Linha rotulo="CEP" valor={c.cep ? mascaraCep(c.cep) : null} />
          <Linha rotulo="Endereço" valor={endereco} />
          <Linha rotulo="Bairro, cidade e UF" valor={cidade} />
          <Linha rotulo="País" valor={c.pais} />
        </dl>
      </section>
      <section className="card p-6">
        <h3 className="mb-4 text-lg font-semibold">Interesses</h3>
        {c.interesses.length ? (
          <div className="flex flex-wrap gap-2">{c.interesses.map((i) => <Etiqueta key={i}>{i}</Etiqueta>)}</div>
        ) : <p className="text-sm text-muted">Nenhum interesse registrado.</p>}
      </section>
    </>
  )
}

function Consentimentos({ itens }: { itens: ConsentimentoCliente[] }) {
  return (
    <section className="card p-6">
      <h3 className="mb-4 text-lg font-semibold">Consentimento (LGPD)</h3>
      {itens.length === 0 ? <p className="text-sm text-muted">Nenhum consentimento registrado.</p> : (
        <ul className="grid gap-3 text-sm">
          {itens.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
              <span>
                {ORIGENS_CONSENTIMENTO[c.origem]}{c.termo_versao ? ` · termo ${c.termo_versao}` : ''}
                <span className="block text-xs text-muted">
                  {dataHora(c.aceito_em)}{c.registrado_por ? ` · registrado por ${c.registrado_por.nome}` : ''}
                </span>
              </span>
              {c.revogado_em ? <Etiqueta tom="erro">Revogado em {data(c.revogado_em)}</Etiqueta> : <Etiqueta tom="ok">Vigente</Etiqueta>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

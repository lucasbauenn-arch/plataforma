import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ShieldAlert } from 'lucide-react'
import { crmCadastrarCliente, crmLiberarPortal } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import { useEscopo } from '@/lib/escopo'
import { ErroRpc, mensagemErro, traduzirErro } from '@/lib/erros'
import { Campo } from '@/components/Campo'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'
import { SeletorParceiro } from '@/components/app/SeletorParceiro'
import { useBase } from '@/components/app/useBase'
import { chavesCrm, paraClienteDados, TEXTO_TRANSFERIDO, textoIndisponivel, useTermoCliente, type ValoresCliente } from '../api-clientes'
import { FormCliente } from '../componentes/FormCliente'

const EU_MESMO = 'eu'

/**
 * Cadastro de cliente (crm_cadastrar_cliente, §4.4/§4.5): o servidor decide o responsável e aplica a A2.
 * - corretor: sempre para si;
 * - gerente: para um corretor da equipe ou para si (A1);
 * - imobiliária: escolhe o corretor (ou gerente) da imobiliária;
 * - interno: escolhe qualquer um; sem escolha = Carteira Arken. Com `?portal=1`, libera o portal em seguida
 *   ("Novo cliente do portal", antigo /admin/clientes).
 * Documento já existente (A2, decisão do dono de 29/09/2026): "já na sua carteira" (abre a ficha); de outro parceiro
 * dentro da exclusividade, "Este CPF já está na carteira de outro parceiro, com exclusividade até dd/mm/aaaa" (nunca o
 * dono); com a exclusividade vencida (180 dias sem atividade), o servidor transfere e a ficha abre com o aviso.
 */
export default function NovoCliente() {
  const { escopo } = useEscopo()
  const base = useBase()
  const navegar = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const termo = useTermoCliente()
  const [corretor, setCorretor] = useState<string | null>(null)
  const [indisponivel, setIndisponivel] = useState<string | null>(null)

  const interno = !!escopo?.interno
  const tipo = escopo?.tipo ?? null
  const gerenteA1 = tipo === 'gerente' && !!escopo?.permissoes.includes('crm.links')
  const portal = interno && params.get('portal') === '1'
  const precisaEscolher = tipo === 'imobiliaria' || (tipo === 'gerente' && !gerenteA1)

  async function cadastrar(v: ValoresCliente) {
    setIndisponivel(null)
    if (!termo.data) throw new ErroRpc('DESCONHECIDO', 'O termo de consentimento ainda não carregou. Tente de novo.')
    if (precisaEscolher && !corretor) {
      toast.error('Escolha o corretor responsável.')
      return
    }
    let r
    try {
      r = await crmCadastrarCliente({ p_dados: paraClienteDados(v), p_corretor_id: corretor, p_termo_id: termo.data.id })
    } catch (e) {
      if (e instanceof ErroRpc && e.codigo === 'TERMO_DESATUALIZADO') void termo.refetch()
      throw e
    }
    void qc.invalidateQueries({ queryKey: chavesCrm.listas })
    if (r.situacao === 'indisponivel' || !r.id) {
      setIndisponivel(textoIndisponivel(r, v.tipo_pessoa))
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (r.situacao === 'ja_na_sua_carteira') {
      toast.info('Este cliente já está na sua carteira. Abrimos a ficha dele.')
    } else if (r.situacao === 'transferido') {
      toast.success(TEXTO_TRANSFERIDO, { duration: 10_000 })
    } else {
      toast.success('Cliente cadastrado.')
      if (portal) {
        try {
          await crmLiberarPortal({ p_id: r.id, p_liberar: true })
          toast.success('Portal do cliente liberado.')
        } catch (e) {
          toast.error(`Cliente cadastrado, mas o portal não foi liberado: ${mensagemErro(e)}`)
        }
      }
    }
    navegar(`${base}/crm/${r.id}${portal ? '?aba=portal' : ''}`)
  }

  const escolhaCorretor = interno || tipo === 'gerente' || tipo === 'imobiliaria' ? (
    <section className="card grid gap-4 p-6 sm:grid-cols-2">
      <h3 className="text-lg font-semibold sm:col-span-2">Responsável</h3>
      <Campo label="Corretor responsável" obrigatorio={precisaEscolher}>
        {tipo === 'gerente' && gerenteA1 ? (
          <CorretoresDaEquipe gerenteId={escopo?.parceiro_id ?? null} valor={corretor} aoMudar={setCorretor} />
        ) : tipo === 'gerente' ? (
          <SeletorParceiro valor={corretor} aoMudar={setCorretor} tipos={['corretor']} gerenteId={escopo?.parceiro_id} vazio="Selecione o corretor" />
        ) : (
          <SeletorParceiro
            valor={corretor} aoMudar={setCorretor} tipos={['corretor', 'gerente']}
            imobiliariaId={interno ? null : escopo?.imobiliaria_id}
            vazio={interno ? 'Carteira Arken (padrão)' : 'Selecione o corretor'}
          />
        )}
      </Campo>
      <p className="self-end text-xs text-muted">
        {interno ? 'Sem escolha, o cliente fica na Carteira Arken. ' : ''}
        A exclusividade do cliente vale enquanto houver atividade: o prazo recomeça a cada etapa, nota, tarefa, documento, proposta ou contrato.
      </p>
    </section>
  ) : null

  return (
    <>
      <CabecalhoPagina
        voltar={{ para: `${base}/crm/lista`, rotulo: 'Clientes' }}
        eyebrow="CRM"
        titulo={portal ? 'Novo cliente do portal' : 'Novo cliente'}
        subtitulo="O CPF/CNPJ é conferido em toda a base: uma pessoa, um cadastro."
      />
      {indisponivel && (
        <div role="alert" className="mb-6 flex gap-3 border border-bronze/40 bg-bronze/10 p-4 text-sm">
          <ShieldAlert size={20} className="shrink-0 text-bronze" aria-hidden />
          <p>{indisponivel} Se precisar de ajuda, fale com a equipe Arken.</p>
        </div>
      )}
      {termo.error && (
        <p className="mb-6 text-sm text-perigo">Não foi possível carregar o termo de consentimento: {mensagemErro(termo.error)}</p>
      )}
      {!termo.isPending && !termo.error && !termo.data ? (
        <p className="card p-6 text-sm text-muted">Não há termo de consentimento publicado. Fale com a equipe Arken.</p>
      ) : (
        <FormCliente
          modo="cadastro" versaoTermo={termo.data?.versao ?? null} antesDosBotoes={escolhaCorretor}
          rotuloEnviar="Cadastrar cliente" aoEnviar={cadastrar} aoCancelar={() => navegar(`${base}/crm/lista`)}
        />
      )}
      {!interno && tipo === 'corretor' && (
        <p className="mt-6 text-xs text-muted">
          O cliente também pode se cadastrar pelo seu <Link to={`${base}/links`} className="text-bronze">link de indicação</Link>.
        </p>
      )}
    </>
  )
}

/** Gerente com A1: "Eu mesmo" (nulo = o próprio gerente, decidido pelo servidor) ou um corretor da equipe (RLS). */
function CorretoresDaEquipe({ gerenteId, valor, aoMudar }: { gerenteId: string | null; valor: string | null; aoMudar: (v: string | null) => void }) {
  const q = useQuery({
    queryKey: ['crm-corretores-equipe', gerenteId],
    enabled: !!gerenteId,
    queryFn: async () => {
      const { data, error } = await supabase.from('parceiros').select('id, nome').is('inativado_em', null).eq('tipo', 'corretor')
        .eq('gerente_id', gerenteId!).order('nome')
      if (error) throw traduzirErro(error)
      return data as { id: string; nome: string }[]
    },
  })
  return (
    <select className="input" value={valor ?? EU_MESMO} onChange={(e) => aoMudar(e.target.value === EU_MESMO ? null : e.target.value)}>
      <option value={EU_MESMO}>Eu mesmo (gerente como corretor)</option>
      {(q.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
    </select>
  )
}

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { equipeDefinirPapel } from '@/lib/rpc'
import { useAuth } from '@/lib/auth'
import { PAPEIS } from '@/lib/constants'
import { Consulta } from '@/components/app/Consulta'
import { Tabela } from '@/components/app/Tabela'
import { ConfirmarModal } from '@/components/app/ConfirmarModal'
import { SeloProvisorio } from '@/components/app/SeloProvisorio'
import { Etiqueta } from '@/components/app/Etiqueta'
import type { Papel } from '@/lib/types'

const CHAVE = ['config', 'equipe'] as const
const INTERNOS: Papel[] = ['super', 'admin', 'colaborador']

interface Membro { id: string; nome: string; email: string | null; papel: Papel; status_parceiro: string; inativado_em: string | null }

const DESCRICAO: Record<string, string> = {
  super: 'Tudo, inclusive configurações, termos, papéis e anonimização.',
  admin: 'Operação completa, sem as configurações do Super.',
  colaborador: 'Sem acesso por enquanto (Capital Humano ainda não existe).',
}

/**
 * Equipe interna (N2): o Super troca o papel entre Super, Admin e Colaborador pela `equipe_definir_papel`, que nunca
 * deixa o sistema sem Super e registra a troca na auditoria (segurança). Ninguém vira interno por aqui a partir de um
 * parceiro ou cliente: a inclusão de gente nova na equipe é feita pelo runbook.
 */
export default function Equipe() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [troca, setTroca] = useState<{ m: Membro; para: Papel } | null>(null)
  const q = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, nome, email, papel, status_parceiro, inativado_em')
        .in('papel', INTERNOS).order('nome')
      if (error) throw error
      return (data ?? []) as Membro[]
    },
  })

  async function confirmar() {
    if (!troca) return
    await equipeDefinirPapel({ p_profile_id: troca.m.id, p_papel: troca.para })
    toast.success(`${troca.m.nome || troca.m.email} agora é ${PAPEIS[troca.para]}.`)
    await qc.invalidateQueries({ queryKey: CHAVE })
  }

  return (
    <section aria-labelledby="equipe-titulo">
      <h3 id="equipe-titulo" className="mb-2 flex flex-wrap items-center gap-2 text-lg font-semibold">
        <Users size={18} className="text-bronze" aria-hidden /> Equipe interna <SeloProvisorio codigo="N2" />
      </h3>
      <p className="mb-5 max-w-3xl text-sm text-muted">
        {INTERNOS.map((p) => <span key={p} className="block"><strong className="text-stone">{PAPEIS[p]}:</strong> {DESCRICAO[p]}</span>)}
      </p>
      <Consulta consulta={q} tituloVazio="Nenhum interno cadastrado">
        {(membros) => (
          <Tabela colunas={['Nome', 'E-mail', 'Situação', 'Papel']} legenda="Equipe interna" minimo={640}>
            {membros.map((m) => {
              const inativo = !!m.inativado_em || m.status_parceiro === 'inativo'
              return (
                <tr key={m.id}>
                  <td>{m.nome || '—'}{m.id === profile?.id && <span className="ml-2 text-xs text-muted">(você)</span>}</td>
                  <td className="break-all text-muted">{m.email ?? '—'}</td>
                  <td>{inativo ? <Etiqueta tom="neutro">Inativo</Etiqueta> : <Etiqueta tom="ok">Ativo</Etiqueta>}</td>
                  <td>
                    <select
                      aria-label={`Papel de ${m.nome || m.email}`} className="input w-auto py-2" value={m.papel}
                      onChange={(e) => setTroca({ m, para: e.target.value as Papel })}
                    >
                      {INTERNOS.map((p) => <option key={p} value={p} disabled={inativo && p !== 'colaborador' && p !== m.papel}>{PAPEIS[p]}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
          </Tabela>
        )}
      </Consulta>

      <ConfirmarModal
        aberto={!!troca} titulo="Trocar o papel?" rotuloConfirmar="Trocar" perigo={troca?.para === 'super' || troca?.m.papel === 'super'}
        texto={troca && (
          <>
            <strong>{troca.m.nome || troca.m.email}</strong>: {PAPEIS[troca.m.papel]} → <strong>{PAPEIS[troca.para]}</strong>.{' '}
            {troca.m.id === profile?.id && troca.m.papel === 'super' && troca.para !== 'super' && 'Você perde o acesso às configurações na hora. '}
            A troca fica registrada na auditoria.
          </>
        )}
        aoConfirmar={confirmar} aoFechar={() => setTroca(null)}
      />
    </section>
  )
}

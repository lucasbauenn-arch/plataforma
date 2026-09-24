import { Fragment, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, MessageCircle, Pencil, UserPlus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { data, mascaraCpf, mascaraTelefone, waLink, whatsappBR } from '@/lib/format'
import { lerListaConvites, mensagemConvite } from '@/lib/convites'
import { Campo } from '@/components/Campo'
import type { ParceiroCliente, Profile, StatusParceiro } from '@/lib/types'
import { Titulo, Tabela, Badge } from './ui'

const TOM = { pendente: 'alerta', aprovado: 'ok', bloqueado: 'erro' } as const

interface ResultadoConvite { email: string; nome: string; telefone: string | null; status: 'convidado' | 'ja_existe' | 'erro'; link?: string; erro?: string }
const TOM_CONVITE = { convidado: 'ok', ja_existe: 'alerta', erro: 'erro' } as const

function Convidar({ fechar }: { fechar: () => void }) {
  const qc = useQueryClient()
  const [texto, setTexto] = useState('')
  const [porEmail, setPorEmail] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultados, setResultados] = useState<ResultadoConvite[] | null>(null)
  const linhas = lerListaConvites(texto)

  async function convidar() {
    setEnviando(true)
    const { data: r, error } = await supabase.functions.invoke('convidar-parceiros', {
      body: { parceiros: linhas, enviarEmail: porEmail, origem: location.origin },
    })
    setEnviando(false)
    if (error) {
      const msg = await error.context?.json?.().then((j: { erro?: string }) => j.erro).catch(() => null)
      return toast.error(msg ?? 'Não foi possível gerar os convites')
    }
    setResultados(r.resultados)
    qc.invalidateQueries({ queryKey: ['admin-parceiros'] })
  }

  if (resultados) {
    return (
      <div className="card mb-8 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Convites gerados</h2>
          <button className="text-sm text-muted hover:text-stone" onClick={fechar}>Fechar</button>
        </div>
        {!porEmail && <p className="mb-4 text-sm text-muted">Envie o link de cada parceiro pelo WhatsApp ou copie. O link vale 24 h e só pode ser usado uma vez — se expirar, convide de novo.</p>}
        <Tabela cab={['Nome', 'E-mail', 'Status', '']}>
          {resultados.map((r) => {
            const wa = whatsappBR(r.telefone)
            return (
              <tr key={r.email}>
                <td className="font-medium">{r.nome || '—'}</td>
                <td>{r.email}</td>
                <td><Badge tom={TOM_CONVITE[r.status]}>{r.status === 'convidado' ? (porEmail ? 'e-mail enviado' : 'link gerado') : r.status === 'ja_existe' ? 'já tem conta' : 'erro'}</Badge>{r.erro && <span className="ml-2 text-xs text-muted">{r.erro}</span>}</td>
                <td className="space-x-3 whitespace-nowrap text-right text-xs font-semibold">
                  {r.link && wa && <a className="inline-flex items-center gap-1 text-sage" target="_blank" rel="noreferrer" href={waLink(wa, mensagemConvite(r.nome, r.link))}><MessageCircle size={14} /> WhatsApp</a>}
                  {r.link && <button className="inline-flex items-center gap-1 text-bronze" onClick={() => navigator.clipboard.writeText(r.link!).then(() => toast.success('Link copiado'))}><Copy size={14} /> Copiar link</button>}
                </td>
              </tr>
            )
          })}
        </Tabela>
      </div>
    )
  }

  return (
    <div className="card mb-8 grid gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Convidar parceiros</h2>
        <button className="text-sm text-muted hover:text-stone" onClick={fechar}>Cancelar</button>
      </div>
      <p className="text-sm text-muted">
        Uma pessoa por linha: <strong className="text-stone">nome; e-mail; telefone; CRECI; imobiliária</strong> (pode colar direto de uma planilha).
        Os convidados entram já aprovados e recebem um link para definir a senha.
      </p>
      <textarea className="input font-mono text-xs" rows={8} value={texto} onChange={(e) => setTexto(e.target.value)}
        placeholder={'Maria Souza; maria@imobiliaria.com.br; (11) 98888-7777; 123456-F; Imobiliária Centro\nJoão Lima; joao@gmail.com; 11977776666'} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-bronze" checked={porEmail} onChange={(e) => setPorEmail(e.target.checked)} />
        Enviar também por e-mail <span className="text-muted">(só funciona com o SMTP próprio configurado)</span>
      </label>
      <div className="flex items-center gap-4">
        <button className="btn-primary" disabled={enviando || linhas.length === 0} onClick={convidar}>
          <UserPlus size={16} /> {enviando ? 'Gerando…' : `Convidar ${linhas.length || ''}`}
        </button>
        {linhas.some((l) => !l.email.includes('@')) && <span className="text-xs text-red-400">Há linhas sem e-mail válido — elas serão ignoradas pelo servidor.</span>}
      </div>
    </div>
  )
}

function EditarParceiro({ p, salvo, cancelar }: { p: Profile; salvo: (p: Profile) => void; cancelar: () => void }) {
  async function salvar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>
    const upd = { nome: f.nome, telefone: f.telefone || null, creci: f.creci || null, imobiliaria: f.imobiliaria || null }
    const { error } = await supabase.from('profiles').update(upd).eq('id', p.id)
    if (error) return toast.error('Erro ao salvar')
    toast.success('Dados atualizados'); salvo({ ...p, ...upd })
  }
  return (
    <tr className="bg-sand/30">
      <td colSpan={6} className="p-4">
        <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-5">
          <Campo label="Nome"><input name="nome" required defaultValue={p.nome} className="input !py-2" /></Campo>
          <Campo label="Telefone"><input name="telefone" defaultValue={p.telefone ?? ''} className="input !py-2" onChange={(e) => (e.target.value = mascaraTelefone(e.target.value))} /></Campo>
          <Campo label="CRECI"><input name="creci" defaultValue={p.creci ?? ''} className="input !py-2" /></Campo>
          <Campo label="Imobiliária"><input name="imobiliaria" defaultValue={p.imobiliaria ?? ''} className="input !py-2" /></Campo>
          <div className="flex items-end gap-3"><button className="btn-primary !py-2">Salvar</button><button type="button" onClick={cancelar} className="btn-ghost !py-2"><X size={15} /></button></div>
          <p className="text-xs text-muted sm:col-span-5">O e-mail de login ({p.email}) não é editável aqui.</p>
        </form>
      </td>
    </tr>
  )
}

export default function Parceiros() {
  const qc = useQueryClient()
  const [ver, setVer] = useState<Profile | null>(null)
  const [editando, setEditando] = useState<Profile | null>(null)
  const [convidando, setConvidando] = useState(false)
  const { data: lista = [] } = useQuery({
    queryKey: ['admin-parceiros'],
    queryFn: async () => (await supabase.from('profiles').select('*').in('papel', ['parceiro', 'admin']).order('created_at', { ascending: false })).data as Profile[],
  })
  const { data: clientes = [] } = useQuery({
    queryKey: ['admin-pc', ver?.id], enabled: !!ver,
    queryFn: async () => (await supabase.from('parceiro_clientes').select('*').eq('parceiro_id', ver!.id).order('created_at', { ascending: false })).data as ParceiroCliente[],
  })

  async function status(p: Profile, s: StatusParceiro) {
    const { error } = await supabase.from('profiles').update({ status_parceiro: s }).eq('id', p.id)
    if (error) return toast.error('Erro ao atualizar')
    toast.success(`${p.nome || p.email}: ${s}`)
    qc.invalidateQueries({ queryKey: ['admin-parceiros'] })
  }

  return (
    <>
      <Titulo acao={!convidando && <button className="btn-primary" onClick={() => setConvidando(true)}><UserPlus size={16} /> Convidar parceiros</button>}>Parceiros</Titulo>
      {convidando && <Convidar fechar={() => setConvidando(false)} />}
      <Tabela cab={['Nome', 'Contato', 'CRECI / Imobiliária', 'Cadastro', 'Status', '']}>
        {lista.map((p) => (
          <Fragment key={p.id}>
            <tr>
              <td className="font-medium">{p.nome || '—'}{p.papel === 'admin' && <Badge>admin</Badge>}</td>
              <td>{p.email}<br /><span className="text-muted">{p.telefone}</span></td>
              <td>{p.creci ?? '—'}<br /><span className="text-muted">{p.imobiliaria}</span></td>
              <td className="text-muted">{data(p.created_at)}</td>
              <td><Badge tom={TOM[p.status_parceiro]}>{p.status_parceiro}</Badge></td>
              <td className="space-x-3 whitespace-nowrap text-right text-xs font-semibold">
                {p.status_parceiro !== 'aprovado' && <button className="text-sage" onClick={() => status(p, 'aprovado')}>Aprovar</button>}
                {p.status_parceiro !== 'bloqueado' && p.papel !== 'admin' && <button className="text-red-400" onClick={() => status(p, 'bloqueado')}>Bloquear</button>}
                <button className="inline-flex items-center gap-1 text-bronze" onClick={() => setEditando(editando?.id === p.id ? null : p)}><Pencil size={13} /> Editar</button>
                <button className="text-bronze" onClick={() => setVer(p)}>Clientes</button>
              </td>
            </tr>
            {editando?.id === p.id && (
              <EditarParceiro p={p} cancelar={() => setEditando(null)}
                salvo={(atualizado) => { setEditando(null); qc.setQueryData<Profile[]>(['admin-parceiros'], (l) => l?.map((x) => (x.id === atualizado.id ? atualizado : x))) }} />
            )}
          </Fragment>
        ))}
      </Tabela>
      {ver && (
        <div className="mt-10">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Clientes de {ver.nome || ver.email}</h2><button className="text-sm text-muted" onClick={() => setVer(null)}>Fechar</button></div>
          <Tabela cab={['Nome', 'CPF', 'Telefone', 'Interesses', 'Anotações', 'Data']}>
            {clientes.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.nome}</td><td>{c.cpf ? mascaraCpf(c.cpf) : '—'}</td><td>{c.telefone}</td>
                <td className="max-w-xs text-xs">{c.interesses.join(', ')}</td><td className="max-w-xs text-xs">{c.anotacoes}</td><td className="text-muted">{data(c.created_at)}</td>
              </tr>
            ))}
          </Tabela>
        </div>
      )}
    </>
  )
}

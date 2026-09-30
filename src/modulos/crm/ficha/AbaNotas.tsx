import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'
import { crmNotaCriar, crmNotas } from '@/lib/rpc'
import { mensagemErro } from '@/lib/erros'
import { dataHora } from '@/lib/format'
import { Campo } from '@/components/Campo'
import { Consulta } from '@/components/app/Consulta'
import { Etiqueta } from '@/components/app/Etiqueta'
import { chavesFunil } from '../api-funil'
import type { PropsAbaFicha } from '../tipos'

const esquema = z.object({
  texto: z.string().trim().min(1, 'Escreva o texto da nota.').max(10000, 'A nota pode ter no máximo 10.000 caracteres.'),
})
type FormNota = z.infer<typeof esquema>

/**
 * [WP3] Aba Notas (§3.5, §7.3): somente inclusão — sem editar nem excluir. O texto é exibido como texto (o React
 * escapa; nada de HTML). Autores acima ou ao lado de quem consulta aparecem com nome genérico (PAR-3, decidido no servidor).
 */
export default function AbaNotas({ clienteId, ficha, recarregarFicha }: PropsAbaFicha) {
  const qc = useQueryClient()
  const consulta = useQuery({ queryKey: chavesFunil.notas(clienteId), queryFn: () => crmNotas({ p_id: clienteId }) })
  const podeCriar = ficha.permissoes.criar_nota && !ficha.cliente.inativado_em
  const form = useForm<FormNota>({ resolver: zodResolver(esquema), defaultValues: { texto: '' } })
  const criar = useMutation({
    mutationFn: (d: FormNota) => crmNotaCriar({ p_cliente_id: clienteId, p_texto: d.texto }),
    onSuccess: () => {
      toast.success('Nota adicionada.')
      form.reset({ texto: '' })
      void qc.invalidateQueries({ queryKey: chavesFunil.notas(clienteId) })
      void qc.invalidateQueries({ queryKey: chavesFunil.timeline(clienteId) })
      recarregarFicha()
    },
    onError: (e) => toast.error(mensagemErro(e)),
  })

  return (
    <section aria-labelledby="titulo-notas">
      <h3 id="titulo-notas" className="mb-4 text-lg font-semibold">Notas</h3>
      {podeCriar && (
        <form onSubmit={form.handleSubmit((d) => criar.mutate(d))} className="card mb-6 grid gap-3 p-4" noValidate>
          <Campo label="Nova nota" erro={form.formState.errors.texto?.message}>
            <textarea
              className="input" rows={4} maxLength={10000} placeholder="Registre o contato, o combinado, a próxima ação…"
              aria-invalid={!!form.formState.errors.texto || undefined} {...form.register('texto')}
            />
          </Campo>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Lock size={12} aria-hidden /> Notas não podem ser editadas nem excluídas.
            </p>
            <button type="submit" className="btn-primary" disabled={criar.isPending}>{criar.isPending ? 'Salvando…' : 'Adicionar nota'}</button>
          </div>
        </form>
      )}
      <Consulta consulta={consulta} tituloVazio="Nenhuma nota" textoVazio="As notas do atendimento aparecem aqui, da mais nova para a mais antiga.">
        {(notas) => (
          <ol className="grid gap-3">
            {notas!.map((n) => (
              <li key={n.id} className="card p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-semibold text-stone">{n.autor_nome ?? 'Sistema'}</span>
                  {n.minha && <Etiqueta>Você</Etiqueta>}
                  <span>{dataHora(n.criado_em)}</span>
                  {n.migrado_legado && <Etiqueta>Migrada</Etiqueta>}
                  {n.removido_lgpd && <Etiqueta>Removida (LGPD)</Etiqueta>}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{n.texto}</p>
              </li>
            ))}
          </ol>
        )}
      </Consulta>
    </section>
  )
}

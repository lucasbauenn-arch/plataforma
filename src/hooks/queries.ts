import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Empreendimento, EmpreendimentoCompleto, Unidade } from '@/lib/types'

export function useEmpreendimentos() {
  return useQuery({
    queryKey: ['empreendimentos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empreendimentos')
        .select('*')
        .eq('publicado', true)
        .order('ordem')
        .order('nome')
      if (error) throw error
      return data as Empreendimento[]
    },
  })
}

export function useEmpreendimento(slug: string | undefined) {
  return useQuery({
    queryKey: ['empreendimento', slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empreendimentos')
        .select('*, empreendimento_midias(*), empreendimento_lazer(*), empreendimento_proximidades(*), empreendimento_ficha(*)')
        .eq('slug', slug!)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const e = data as EmpreendimentoCompleto
      const byOrdem = (a: { ordem: number }, b: { ordem: number }) => a.ordem - b.ordem
      e.empreendimento_midias.sort(byOrdem)
      e.empreendimento_lazer.sort(byOrdem)
      e.empreendimento_proximidades.sort(byOrdem)
      e.empreendimento_ficha.sort(byOrdem)
      return e
    },
  })
}

export function useUnidades(empreendimentoId: string | undefined) {
  return useQuery({
    queryKey: ['unidades', empreendimentoId],
    enabled: !!empreendimentoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unidades')
        .select('*')
        .eq('empreendimento_id', empreendimentoId!)
        .order('identificador')
      if (error) throw error
      return data as Unidade[]
    },
  })
}

export function useMaterial(empreendimentoId: string | undefined) {
  return useQuery({
    queryKey: ['material', empreendimentoId],
    enabled: !!empreendimentoId,
    queryFn: async () => {
      const { data } = await supabase
        .from('empreendimento_materiais')
        .select('drive_url, observacoes')
        .eq('empreendimento_id', empreendimentoId!)
        .maybeSingle()
      return data as { drive_url: string | null; observacoes: string | null } | null
    },
  })
}

// Entrada e saída da importação do espelho de vendas (CSV). A regra de o que fazer está em src/lib/espelho.ts
// (`planejarImportacao`, testada); aqui só se lê o cadastro atual e se grava o plano. NADA é apagado (FUX-01).

import { supabase } from '@/lib/supabase'
import { mensagemErro, traduzirErro } from '@/lib/erros'
import type { PlanoImportacao, UnidadeCadastrada } from '@/lib/espelho'

/** O PostgREST devolve no máximo 1000 linhas por requisição (`max_rows`): lê em páginas, para nunca planejar sobre uma lista cortada. */
const PAGINA = 1000
const LOTE_INSERT = 200
const EM_PARALELO = 6

/** Todas as unidades do empreendimento, lidas do servidor agora (não do cache da tela). */
export async function lerCadastroDeUnidades(empreendimentoId: string): Promise<UnidadeCadastrada[]> {
  const todas: UnidadeCadastrada[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase.from('unidades').select('id, identificador, metragem, valor, status')
      .eq('empreendimento_id', empreendimentoId).order('id').range(de, de + PAGINA - 1)
    if (error) throw traduzirErro(error)
    const linhas = (data ?? []) as UnidadeCadastrada[]
    todas.push(...linhas)
    if (linhas.length < PAGINA) return todas
  }
}

export interface ResultadoImportacao {
  criadas: number
  atualizadas: number
  /** Unidades que não foram gravadas, com o motivo em pt-BR. */
  falhas: { identificador: string; motivo: string }[]
}

/**
 * Grava o plano: INSERT das novas (em lotes) e UPDATE por id só dos campos que mudam. Não é uma transação: se algo
 * falhar, o resultado diz o que entrou e o que não entrou. Refazer a importação com o arquivo de novo é seguro (um
 * plano novo é calculado sobre o cadastro do momento); repetir o MESMO plano não é, e por isso quem chama não repete.
 */
export async function aplicarPlanoDeImportacao(empreendimentoId: string, plano: PlanoImportacao): Promise<ResultadoImportacao> {
  const r: ResultadoImportacao = { criadas: 0, atualizadas: 0, falhas: [] }

  for (let i = 0; i < plano.criar.length; i += LOTE_INSERT) {
    const lote = plano.criar.slice(i, i + LOTE_INSERT)
    const { data, error } = await supabase.from('unidades')
      .insert(lote.map((l) => ({ empreendimento_id: empreendimentoId, ...l }))).select('id')
    if (error) {
      const motivo = mensagemErro(error)
      r.falhas.push(...lote.map((l) => ({ identificador: l.identificador, motivo })))
    } else if ((data ?? []).length !== lote.length) {
      r.falhas.push(...lote.map((l) => ({ identificador: l.identificador, motivo: 'O servidor não confirmou a gravação.' })))
    } else {
      r.criadas += lote.length
    }
  }

  for (let i = 0; i < plano.atualizar.length; i += EM_PARALELO) {
    await Promise.all(plano.atualizar.slice(i, i + EM_PARALELO).map(async (a) => {
      const { data, error } = await supabase.from('unidades').update(a.campos)
        .eq('id', a.id).eq('empreendimento_id', empreendimentoId).select('id')
      if (error) r.falhas.push({ identificador: a.identificador, motivo: mensagemErro(error) })
      // sem erro e sem linha: a política de acesso barrou em silêncio, ou a unidade foi removida por outra pessoa
      else if (!data?.length) r.falhas.push({ identificador: a.identificador, motivo: 'A unidade não foi encontrada ou você não pode alterá-la.' })
      else r.atualizadas++
    }))
  }
  return r
}

/** "A, B, C e mais 4" (para mensagens). */
export function listaCurta(nomes: string[], max = 5): string {
  return nomes.length <= max ? nomes.join(', ') : `${nomes.slice(0, max).join(', ')} e mais ${nomes.length - max}`
}

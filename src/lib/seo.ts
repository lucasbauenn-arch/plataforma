import seo from '@/content/seo.json'
import { ESTAGIOS } from './constants'
import type { Empreendimento } from './types'

type Base = Pick<Empreendimento, 'slug' | 'nome' | 'estagio' | 'bairro' | 'cidade' | 'dormitorios' | 'metragem' | 'tagline' | 'descricao' | 'capa_url'>

// mesmas regras de scripts/gerar-seo.mjs (o HTML pré-renderizado e o SPA mostram o mesmo texto)
const limpa = (s: string | null | undefined) => (s ? s.replace(/\s+/g, ' ').trim() : null)
const local = (e: Base) => limpa(e.bairro) ?? limpa(e.cidade) ?? 'São Paulo'

export function descricaoEmpreendimento(e: Base) {
  const detalhes = [e.dormitorios, e.metragem].filter(Boolean).join(' · ')
  const texto = [`${e.nome}: ${ESTAGIOS[e.estagio].toLowerCase()} em ${local(e)}.`, detalhes && `${detalhes}.`, limpa(e.tagline) ?? limpa(e.descricao)]
    .filter(Boolean).join(' ')
  return texto.length > 158 ? texto.slice(0, 155).replace(/\s+\S*$/, '') + '…' : texto
}

export const tituloEmpreendimento = (e: Base) => `${e.nome} — ${ESTAGIOS[e.estagio]} em ${local(e)} | ${seo.nome}`
export const ogEmpreendimento = (e: Base) => `${seo.site}/og/${e.capa_url ? e.slug : 'padrao'}.jpg`

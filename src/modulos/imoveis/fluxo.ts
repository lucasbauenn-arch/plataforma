// Quem faz o quê no imóvel [WP5] (docs/ARQUITETURA_EXPANSAO.md §1.1 E2/E4, §3.8, §4.2). Módulo puro, testado em
// fluxo.test.ts. Espelha as regras do servidor só para montar a tela (botões, campos travados): quem decide de
// verdade são a RLS (`imoveis: editar`), `pode_editar_imovel()` e `_transicionar()`.

import { ehPapelInterno, ehPapelParceiro } from '@/lib/menu'
import type { Escopo, StatusImovel } from '@/lib/types'
import type { StatusTransicao } from '@/modulos/config/tipos'
import type { Imovel } from './tipos'

/** Quem está usando a tela (sai de `meu_escopo()`). */
export interface Usuario {
  profileId: string | null
  papel: Escopo['papel'] | null
  /** `is_admin()` (com 2FA quando exigida). */
  interno: boolean
  /** `is_parceiro_aprovado()`: interno, ou papel de parceiro aprovado e não inativado. */
  aprovado: boolean
}

export function usuarioDoEscopo(e: Escopo | null): Usuario {
  if (!e) return { profileId: null, papel: null, interno: false, aprovado: false }
  const aprovado = e.interno || (ehPapelParceiro(e.papel) && e.status_parceiro === 'aprovado' && !e.inativado)
  return { profileId: e.profile_id, papel: e.papel, interno: e.interno, aprovado }
}

type ImovelMinimo = Pick<Imovel, 'status' | 'criado_por' | 'inativado_em'>

const EDITAVEL_PELO_CRIADOR: StatusImovel[] = ['rascunho', 'pendente']

const ehCriador = (i: ImovelMinimo, u: Usuario) => !!u.profileId && i.criado_por === u.profileId && u.aprovado

/**
 * Campos editáveis (política `imoveis: editar`): internos; o criador aprovado em RA/PE. Imóvel inativado fica só
 * para leitura na tela (caminho conservador: a inativação encerra o fluxo).
 */
export function podeEditarDados(i: ImovelMinimo, u: Usuario): boolean {
  if (i.inativado_em) return false
  return u.interno || (ehCriador(i, u) && EDITAVEL_PELO_CRIADOR.includes(i.status))
}

/** Enviar e reordenar fotos (`pode_editar_imovel()`; as RPCs recusam imóvel inativado). */
export const podeEditarFotos = podeEditarDados

/** Remover foto: como editar, e o interno também no imóvel inativado (retirar conteúdo impróprio). */
export function podeRemoverFotos(i: ImovelMinimo, u: Usuario): boolean {
  return podeEditarDados(i, u) || (u.interno && !!i.inativado_em)
}

/** IMV-3: em `no_contrato` o valor não muda (gatilho `imoveis_valor_bloqueado`). */
export const valorTravado = (i: Pick<Imovel, 'status'>) => i.status === 'no_contrato'

/**
 * Transições que o usuário pode acionar a partir do status atual, pela tabela `status_transicoes` (o Super pode mudar
 * papéis, motivo e `ativa`): linha ativa, e papel do usuário na lista (interno com `is_admin()`, parceiro aprovado)
 * ou `permite_criador` com o próprio criador. As só do sistema (AP ↔ NC) nunca aparecem.
 */
export function transicoesPermitidas(i: ImovelMinimo, transicoes: readonly StatusTransicao[], u: Usuario): StatusTransicao[] {
  if (i.inativado_em || !u.papel) return []
  const papel = u.papel
  const porPapel = (t: StatusTransicao) =>
    t.papeis.includes(papel) && (ehPapelInterno(papel) ? u.interno : ehPapelParceiro(papel) ? u.aprovado : false)
  return transicoes.filter((t) =>
    t.entidade === 'imovel' && t.ativa && t.de === i.status && (porPapel(t) || (t.permite_criador && ehCriador(i, u))))
}

/** Rótulo do botão de cada transição (§7.3); as demais usam "Mover para <status>". */
export function rotuloTransicao(t: Pick<StatusTransicao, 'de' | 'para'>): string {
  const chave = `${t.de}>${t.para}`
  const rotulos: Record<string, string> = {
    'rascunho>pendente': 'Finalizar cadastro',
    'pendente>em_revisao': 'Iniciar revisão',
    'em_revisao>aprovado': 'Aprovar',
    'em_revisao>rascunho': 'Devolver com observação',
  }
  return rotulos[chave] ?? `Mover para ${ROTULO_STATUS[t.para as StatusImovel] ?? t.para}`
}

const ROTULO_STATUS: Record<StatusImovel, string> = {
  rascunho: 'Rascunho', pendente: 'Pendente', em_revisao: 'Em revisão', aprovado: 'Aprovado', no_contrato: 'No contrato',
}

/** Mínimo de caracteres da observação obrigatória (igual a `_transicionar`). */
export const OBSERVACAO_MINIMA = 3
/** Mínimo do motivo de inativação (igual a `imovel_inativar`). */
export const MOTIVO_INATIVACAO_MINIMO = 5

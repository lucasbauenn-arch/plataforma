// Peças comuns às abas do editor de empreendimento (EmpreendimentoEditor.tsx e as seções em arquivos próprios).

import { supabase } from '@/lib/supabase'
import { traduzirErro } from '@/lib/erros'

/** Item à espera de confirmação para excluir (mensagem do modal + a exclusão em si). */
export interface AlvoExclusao { titulo: string; texto: string; excluir: () => Promise<void> }

/**
 * DELETE por id. O erro do servidor vira exceção (o `ConfirmarModal` mostra no aviso e mantém o modal aberto) e também
 * "nenhuma linha apagada": sem erro e sem linha significa que a política de acesso barrou em silêncio.
 */
export async function apagarLinha(tabela: string, id: string) {
  const { data, error } = await supabase.from(tabela).delete().eq('id', id).select('id')
  if (error) throw traduzirErro(error)
  if (!data?.length) throw traduzirErro({ code: '42501', message: 'Sem acesso a este registro' })
}

import { FluxoSenha } from '../componentes/FluxoSenha'

/**
 * [WP1] /parceiros/definir-senha (pública): link do convite (e-mail ou WhatsApp) e reenvio. Consome o `token_hash` só
 * no clique em "Continuar" (verifyOtp) e então pede a senha (docs/ARQUITETURA_EXPANSAO.md §6.2).
 */
export default function DefinirSenha() {
  return (
    <FluxoSenha
      aceitos={['invite', 'recovery']}
      eyebrow="Área do parceiro"
      titulo="Ative seu acesso"
      textoInicio="Você foi convidado(a) para a área do parceiro da Arken Incorporadora. Clique em Continuar para criar sua senha."
    />
  )
}

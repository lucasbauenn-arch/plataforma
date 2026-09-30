import { FluxoSenha } from '@/modulos/rede/componentes/FluxoSenha'

/**
 * [WP1] /parceiros/nova-senha: recuperação de senha (template recuperar-senha.html). Como o convite, só consome o
 * `token_hash` no clique em "Continuar". Os links antigos (sessão no endereço) continuam funcionando.
 */
export default function NovaSenha() {
  return (
    <FluxoSenha
      aceitos={['recovery']}
      eyebrow="Área do parceiro"
      titulo="Nova senha"
      textoInicio="Clique em Continuar para criar uma nova senha para a sua conta."
      aceitarSessaoAtual
    />
  )
}

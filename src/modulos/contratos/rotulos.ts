// Textos da tela de contratos: bloqueios do envio (§7.3 "o modal explica cada bloqueio") e motivos da simulação.
import type { BloqueioEnvio, MotivoSimulacaoInvalida } from './tipos'

export const BLOQUEIOS_ENVIO: Record<BloqueioEnvio, { titulo: string; como: string }> = {
  pdf_gerado: { titulo: 'PDF da minuta', como: 'Gere o PDF de novo: ele ainda não existe ou ficou desatualizado depois de uma mudança.' },
  modelo_liberado: { titulo: 'Modelo liberado', como: 'O modelo de contrato ainda não foi liberado para envio pelo Super (revisão jurídica).' },
  signatarios_configurados: {
    titulo: 'Signatários',
    como: 'Falta configurar os signatários (e-mail do representante da Arken) em Configurações › Signatários.',
  },
  vendedora_configurada: { titulo: 'Dados da vendedora', como: 'Falta a razão social, o CNPJ ou o endereço da Arken em Configurações › Geral (N7).' },
  email_cliente: { titulo: 'E-mail do cliente', como: 'Cadastre um e-mail válido na aba Dados do cliente.' },
  valor_produto_atual: {
    titulo: 'Valor do produto',
    como: 'O valor do produto mudou depois da simulação (ou ele não está mais disponível). Devolva para rascunho e salve a simulação de novo.',
  },
}

export const MOTIVOS_SIMULACAO: Record<MotivoSimulacaoInvalida, string> = {
  n_parcelas_fora_do_limite: 'Número de parcelas fora do limite.',
  entrada_maior_que_aporte: 'A entrada é maior que o aporte.',
  entrada_invalida: 'Entrada inválida.',
  valor_abaixo_do_minimo: 'O valor do produto está abaixo do mínimo.',
  flexivel_sem_minimo: 'O plano flexível ainda não tem valor mínimo configurado (N14).',
  percentual_invalido: 'Percentual de aporte inválido.',
  produto_sem_valor: 'O produto não tem valor de tabela.',
  forma_invalida: 'Forma de pagamento inválida.',
}

export const motivoSimulacao = (m: string) => MOTIVOS_SIMULACAO[m as MotivoSimulacaoInvalida] ?? m.replace(/_/g, ' ')

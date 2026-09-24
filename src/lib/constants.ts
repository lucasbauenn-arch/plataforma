import type { Estagio, StatusProposta, StatusUnidade } from './types'

export const EMPRESA = {
  nome: 'Arken Incorporadora',
  endereco: 'Edif. City Tower — R. Cel. Irineu de Castro, 43, Jardim Anália Franco, São Paulo – SP, 03333-050',
  telefone: '(11) 93200-4821',
  whatsapp: (import.meta.env.VITE_WHATSAPP as string | undefined) ?? '5511932004821',
  email: 'vendas@arkenincorporadora.com.br',
  instagram: 'https://instagram.com/',
  facebook: 'https://facebook.com/',
  youtube: 'https://youtube.com/',
}

export const ESTAGIOS: Record<Estagio, string> = {
  futuro_lancamento: 'Breve lançamento',
  lancamento: 'Lançamento',
  obras_iniciadas: 'Obras iniciadas',
  obras_aceleradas: 'Obras aceleradas',
  em_construcao: 'Em construção',
  pronto_para_morar: 'Pronto para morar',
  portfolio: 'Portfólio',
}

export const STATUS_PROPOSTA: Record<StatusProposta, string> = {
  enviada: 'Enviada', em_analise: 'Em análise', aprovada: 'Aprovada', recusada: 'Recusada',
}

export const STATUS_UNIDADE: Record<StatusUnidade, string> = {
  disponivel: 'Disponível', reservada: 'Reservada', vendida: 'Vendida',
}

// Mesmas opções do formulário "Cadastrar Clientes" do site atual, agrupadas
export const INTERESSES: { grupo: string; opcoes: string[] }[] = [
  { grupo: 'Faixa de valor', opcoes: ['Até 100 mil', 'De 101 a 200 mil', 'De 201 a 300 mil', 'De 301 a 400 mil', 'Acima de 400 mil', 'Acima de 1 milhão'] },
  { grupo: 'Dormitórios', opcoes: ['1 dormitório', '2 dormitórios', '3 dormitórios'] },
  { grupo: 'Região', opcoes: ['Zona leste', 'Zona norte', 'Zona sul', 'Centro', 'Guarulhos', 'Poá', 'Suzano', 'Mairiporã', 'Mogi Mirim'] },
  { grupo: 'Tipo de imóvel', opcoes: ['Apartamento', 'Casa', 'Casa de condomínio', 'Terreno'] },
  { grupo: 'Estágio', opcoes: ['Apartamento na planta/lançamento', 'Apartamento em obras', 'Apartamento pronto'] },
  { grupo: 'Outros', opcoes: ['Não tem interesse'] },
]

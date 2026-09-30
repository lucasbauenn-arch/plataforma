import type {
  CategoriaAuditoria, Estagio, EstadoCivil, EtapaFunil, FormaPagamento, FormatoDocumento, Genero, ModeloChave, OrigemCliente,
  Papel, PapelSignatario, StatusAssinatura, StatusContrato, StatusDocumento, StatusImovel, StatusLead, StatusParceiro,
  StatusProposta, StatusTarefa, StatusUnidade, TipoParceiro, TipoPessoa,
} from './types'
import type { AdicionalImovel } from '@/modulos/imoveis/tipos'

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

// ---------- expansão (docs/ARQUITETURA_EXPANSAO.md §3.2): rótulos em pt-BR e códigos do legado, só para exibição ----------

export const PAPEIS: Record<Papel, string> = {
  super: 'Super', admin: 'Administrador', colaborador: 'Colaborador', imobiliaria: 'Imobiliária', gerente: 'Gerente',
  corretor: 'Corretor', parceiro: 'Parceiro', cliente: 'Cliente',
}

/** Papéis internos (equipe Arken) e de parceiro (rede). `parceiro` = legado/autocadastro. */
export const PAPEIS_INTERNOS: Papel[] = ['super', 'admin']
export const PAPEIS_PARCEIRO: Papel[] = ['imobiliaria', 'gerente', 'corretor', 'parceiro']

export const STATUS_PARCEIRO: Record<StatusParceiro, string> = {
  pendente: 'Pendente', aprovado: 'Aprovado', bloqueado: 'Bloqueado', inativo: 'Inativo',
}

export const TIPOS_PARCEIRO: Record<TipoParceiro, string> = { imobiliaria: 'Imobiliária', gerente: 'Gerente', corretor: 'Corretor' }

export const TIPOS_PESSOA: Record<TipoPessoa, string> = { fisica: 'Pessoa física', juridica: 'Pessoa jurídica' }

export const GENEROS: Record<Genero, string> = { masculino: 'Masculino', feminino: 'Feminino', outros: 'Outros' }

export const ESTADOS_CIVIS: Record<EstadoCivil, string> = {
  solteiro: 'Solteiro(a)', casado: 'Casado(a)', divorciado: 'Divorciado(a)', viuvo: 'Viúvo(a)', uniao_estavel: 'União estável',
}

/** Etapas do funil na ordem das colunas do kanban (Perdidos por último), com o código do legado. */
export const ETAPAS: Record<EtapaFunil, { rotulo: string; codigo: string; ordem: number }> = {
  novo_contato: { rotulo: 'Novo contato', codigo: 'NC', ordem: 1 },
  contato_iniciado: { rotulo: 'Contato iniciado', codigo: 'CI', ordem: 2 },
  documentacao: { rotulo: 'Documentação', codigo: 'DO', ordem: 3 },
  finalizado: { rotulo: 'Finalizado', codigo: 'FI', ordem: 4 },
  perdido: { rotulo: 'Perdido', codigo: 'PE', ordem: 5 },
}
export const ORDEM_ETAPAS = (Object.keys(ETAPAS) as EtapaFunil[]).sort((a, b) => ETAPAS[a].ordem - ETAPAS[b].ordem)

export const ORIGENS_CLIENTE: Record<OrigemCliente, string> = {
  cadastro_interno: 'Cadastro interno', pre_cadastro_link: 'Link de indicação', lead_site: 'Contato do site',
  portal_admin: 'Portal (equipe)', migracao_parceiro_clientes: 'Migração', importacao: 'Importação',
}

export const STATUS_LEAD: Record<StatusLead, string> = { novo: 'Novo', convertido: 'Convertido', descartado: 'Descartado' }

export const STATUS_TAREFA: Record<StatusTarefa, string> = { pendente: 'Pendente', concluida: 'Concluída' }

export const STATUS_DOCUMENTO: Record<StatusDocumento, { rotulo: string; codigo: string }> = {
  pendente: { rotulo: 'Pendente', codigo: 'P' },
  em_analise: { rotulo: 'Em análise', codigo: 'EA' },
  aprovado: { rotulo: 'Aprovado', codigo: 'A' },
  rejeitado: { rotulo: 'Rejeitado', codigo: 'R' },
}

/** Formatos aceitos numa solicitação de documento, com os MIME do bucket `crm-documentos`. */
export const FORMATOS_DOCUMENTO: Record<FormatoDocumento, { rotulo: string; mimes: string[]; extensoes: string[] }> = {
  jpeg: { rotulo: 'JPEG', mimes: ['image/jpeg'], extensoes: ['jpg', 'jpeg'] },
  png: { rotulo: 'PNG', mimes: ['image/png'], extensoes: ['png'] },
  pdf: { rotulo: 'PDF', mimes: ['application/pdf'], extensoes: ['pdf'] },
  doc: {
    rotulo: 'DOC/DOCX',
    mimes: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    extensoes: ['doc', 'docx'],
  },
  planilha: {
    rotulo: 'Planilha',
    mimes: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
    extensoes: ['xls', 'xlsx', 'csv'],
  },
}

export const FORMAS_PAGAMENTO: Record<FormaPagamento, string> = { parcelado: 'Parcelado', flexivel: 'Flexível' }

export const MODELOS_CONTRATO: Record<ModeloChave, string> = {
  parcelado: 'Aquisição — parcelado', flexivel: 'Aquisição — flexível',
  servico_corretor: 'Serviço — corretor (só prévia)', servico_imobiliaria: 'Serviço — imobiliária (só prévia)',
}

export const STATUS_CONTRATO: Record<StatusContrato, { rotulo: string; codigo: string | null }> = {
  rascunho: { rotulo: 'Rascunho', codigo: 'R' },
  documentacao_pendente: { rotulo: 'Documentação pendente', codigo: 'P' },
  em_analise: { rotulo: 'Em análise', codigo: 'EA' },
  assinatura_pendente: { rotulo: 'Assinatura pendente', codigo: 'AP' },
  assinado: { rotulo: 'Assinado', codigo: 'A' },
  recusado: { rotulo: 'Recusado', codigo: null },
  expirado: { rotulo: 'Expirado', codigo: null },
  cancelado: { rotulo: 'Cancelado', codigo: null },
  arquivado: { rotulo: 'Arquivado', codigo: 'AQ' },
}
/** Status em que o contrato ainda "ocupa" o produto (os demais liberam; índice único parcial no banco). */
export const STATUS_CONTRATO_ATIVO: StatusContrato[] = ['rascunho', 'documentacao_pendente', 'em_analise', 'assinatura_pendente', 'assinado']

export const PAPEIS_SIGNATARIO: Record<PapelSignatario, string> = {
  cliente: 'Cliente', representante_arken: 'Representante Arken', corretor: 'Corretor', testemunha: 'Testemunha',
}

export const STATUS_ASSINATURA: Record<StatusAssinatura, string> = { pendente: 'Pendente', assinado: 'Assinado', recusado: 'Recusado' }

export const STATUS_IMOVEL: Record<StatusImovel, { rotulo: string; codigo: string }> = {
  rascunho: { rotulo: 'Rascunho', codigo: 'RA' },
  pendente: { rotulo: 'Pendente', codigo: 'PE' },
  em_revisao: { rotulo: 'Em revisão', codigo: 'RE' },
  aprovado: { rotulo: 'Aprovado', codigo: 'AP' },
  no_contrato: { rotulo: 'No contrato', codigo: 'NC' },
}

/** `imoveis.adicionais` (E5: "Chip" fica fora). */
export const ADICIONAIS_IMOVEL: Record<AdicionalImovel, string> = {
  churrasqueira: 'Churrasqueira', ar_condicionado: 'Ar-condicionado', perto_metro: 'Perto do metrô',
  perto_parque: 'Perto de parque', perto_onibus: 'Perto de ponto de ônibus', piscina: 'Piscina', aceita_pet: 'Aceita pet',
}

export const CATEGORIAS_AUDITORIA: Record<CategoriaAuditoria, string> = {
  acesso: 'Acesso', operacao: 'Operação', configuracao: 'Configuração', seguranca: 'Segurança', integracao: 'Integração', lgpd: 'LGPD',
}

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS',
  'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

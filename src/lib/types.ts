export type Papel = 'admin' | 'parceiro' | 'cliente'
export type StatusParceiro = 'pendente' | 'aprovado' | 'bloqueado'
export type Estagio =
  | 'futuro_lancamento' | 'lancamento' | 'obras_iniciadas' | 'obras_aceleradas'
  | 'em_construcao' | 'pronto_para_morar' | 'portfolio'
export type TipoMidia = 'fachada' | 'area_comum' | 'planta' | 'decorado' | 'obra'
export type StatusUnidade = 'disponivel' | 'reservada' | 'vendida'
export type StatusProposta = 'enviada' | 'em_analise' | 'aprovada' | 'recusada'

export interface Profile {
  id: string
  papel: Papel
  nome: string
  email: string | null
  telefone: string | null
  cpf: string | null
  creci: string | null
  imobiliaria: string | null
  status_parceiro: StatusParceiro
  created_at: string
}

export interface Empreendimento {
  id: string
  slug: string
  nome: string
  chamada: string | null
  titulo_hero: string | null
  descricao: string | null
  descricao_lazer: string | null
  estagio: Estagio
  pais: string
  categoria: string | null
  construtora: string | null
  endereco: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  latitude: number | null
  longitude: number | null
  texto_localizacao: string | null
  dormitorios: string | null
  metragem: string | null
  previsao_entrega: string | null
  tagline: string | null
  titulo_lazer: string | null
  titulo_localizacao: string | null
  perspectiva_url: string | null
  tour_virtual_url: string | null
  waze_url: string | null
  mostrar_no_portfolio: boolean
  vagas: string | null
  total_unidades: number | null
  aceita_fgts: boolean
  capa_url: string | null
  logo_url: string | null
  videos: string[]
  destaque_home: boolean
  publicado: boolean
  ordem: number
}

export interface Midia { id: string; empreendimento_id: string; tipo: TipoMidia; url: string; legenda: string | null; ordem: number }
export interface Lazer { id: string; empreendimento_id: string; titulo: string; descricao: string | null; icone: string | null; imagem_url: string | null; ordem: number }
export interface Proximidade { id: string; empreendimento_id: string; nome: string; distancia: string | null; tempo_pe: string | null; tempo_carro: string | null; tempo_transporte: string | null; tempo_bike: string | null; foto_url: string | null; ordem: number }
export interface FichaItem { id: string; empreendimento_id: string; titulo: string; descricao: string | null; icone_url: string | null; ordem: number }
export interface ObraAtualizacao { id: string; empreendimento_id: string; percentual: number | null; titulo: string; descricao: string | null; fotos: string[]; data: string }

export interface EmpreendimentoCompleto extends Empreendimento {
  empreendimento_midias: Midia[]
  empreendimento_lazer: Lazer[]
  empreendimento_proximidades: Proximidade[]
  empreendimento_ficha: FichaItem[]
}

export interface Unidade {
  id: string
  empreendimento_id: string
  identificador: string
  metragem: number | null
  valor: number | null
  dormitorios: number | null
  andar: string | null
  status: StatusUnidade
}

export interface ParceiroCliente {
  id: string
  parceiro_id: string
  nome: string
  rg: string | null
  cpf: string | null
  telefone: string
  anotacoes: string | null
  interesses: string[]
  created_at: string
}

export interface Proposta {
  id: string
  parceiro_id: string
  empreendimento_id: string
  parceiro_cliente_id: string | null
  texto: string
  status: StatusProposta
  resposta_admin: string | null
  created_at: string
  empreendimentos?: { nome: string } | null
  parceiro_clientes?: { nome: string } | null
  profiles?: { nome: string; email: string | null } | null
}

export interface Cliente { id: string; user_id: string | null; nome: string; cpf: string; email: string | null; telefone: string | null; created_at: string }
export interface ClienteNegocio { id: string; cliente_id: string; empreendimento_id: string | null; unidade_id: string | null; descricao: string | null; status: string | null; valor: number | null; created_at: string; empreendimentos?: { nome: string; slug: string; capa_url: string | null } | null; unidades?: { identificador: string; metragem: number | null } | null }
export interface PortalAcesso { id: number; cliente_id: string | null; ip: string | null; user_agent: string | null; sucesso: boolean; created_at: string }
export interface ClienteArquivo { id: string; cliente_id: string; negocio_id: string | null; nome: string; storage_path: string; created_at: string }
export interface Lead { id: string; nome: string; email: string | null; telefone: string | null; mensagem: string | null; empreendimento_id: string | null; origem: string | null; created_at: string }

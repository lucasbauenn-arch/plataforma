import {
  Armchair, Baby, Bath, Bike, Blocks, BookOpen, Building2, Bus, Church, Clapperboard, Coffee, Croissant, Dumbbell,
  EvCharger, Flame, Flower2, Footprints, Fuel, Gamepad2, GraduationCap, HeartPulse, Hospital, Landmark, Laptop,
  PartyPopper, PawPrint, Pill, Plane, Route, School, ShieldCheck, ShoppingBag, ShoppingBasket, ShoppingCart, Sprout,
  Stethoscope, Sun, Sunset, ThermometerSun, TrainFront, TrainFrontTunnel, TreePalm, Trees, Trophy, UtensilsCrossed,
  ChefHat, ToyBrick, WashingMachine, Waves, type LucideIcon,
} from 'lucide-react'

/**
 * Catálogo de ícones do empreendimento (itens de lazer e categorias de proximidade). O banco guarda só a CHAVE
 * (`icone_catalogo`, formato `^[a-z][a-z0-9_]{0,39}$`, migration 20260929000021); o desenho vem daqui. Chave nova pode
 * ser acrescentada; chave existente NÃO muda de nome (os registros gravados deixariam de achar o ícone).
 */
export interface ItemCatalogo { chave: string; rotulo: string; Icone: LucideIcon }

export const CATALOGO_LAZER: ItemCatalogo[] = [
  { chave: 'piscina', rotulo: 'Piscina', Icone: Waves },
  { chave: 'piscina_infantil', rotulo: 'Piscina infantil', Icone: Baby },
  { chave: 'academia', rotulo: 'Academia', Icone: Dumbbell },
  { chave: 'churrasqueira', rotulo: 'Churrasqueira', Icone: Flame },
  { chave: 'salao_festas', rotulo: 'Salão de festas', Icone: PartyPopper },
  { chave: 'playground', rotulo: 'Playground', Icone: Blocks },
  { chave: 'brinquedoteca', rotulo: 'Brinquedoteca', Icone: ToyBrick },
  { chave: 'quadra', rotulo: 'Quadra', Icone: Trophy },
  { chave: 'espaco_gourmet', rotulo: 'Espaço gourmet', Icone: ChefHat },
  { chave: 'pet_place', rotulo: 'Pet place', Icone: PawPrint },
  { chave: 'coworking', rotulo: 'Coworking', Icone: Laptop },
  { chave: 'bicicletario', rotulo: 'Bicicletário', Icone: Bike },
  { chave: 'lavanderia', rotulo: 'Lavanderia', Icone: WashingMachine },
  { chave: 'sauna', rotulo: 'Sauna', Icone: ThermometerSun },
  { chave: 'solarium', rotulo: 'Solarium', Icone: Sun },
  { chave: 'redario', rotulo: 'Redário', Icone: TreePalm },
  { chave: 'horta', rotulo: 'Horta', Icone: Sprout },
  { chave: 'portaria_24h', rotulo: 'Portaria 24h', Icone: ShieldCheck },
  { chave: 'rooftop', rotulo: 'Rooftop', Icone: Sunset },
  { chave: 'cinema', rotulo: 'Cinema', Icone: Clapperboard },
  { chave: 'salao_jogos', rotulo: 'Salão de jogos', Icone: Gamepad2 },
  { chave: 'spa', rotulo: 'Spa', Icone: Bath },
  { chave: 'espaco_zen', rotulo: 'Espaço zen', Icone: Flower2 },
  { chave: 'pista_cooper', rotulo: 'Pista de cooper', Icone: Footprints },
  { chave: 'lounge', rotulo: 'Lounge', Icone: Armchair },
  { chave: 'minimercado', rotulo: 'Minimercado', Icone: ShoppingBasket },
  { chave: 'carregador_eletrico', rotulo: 'Carregador de carro elétrico', Icone: EvCharger },
  { chave: 'jardim', rotulo: 'Jardim', Icone: Trees },
]

export const CATALOGO_PROXIMIDADE: ItemCatalogo[] = [
  { chave: 'mercado', rotulo: 'Mercado', Icone: ShoppingCart },
  { chave: 'escola', rotulo: 'Escola', Icone: School },
  { chave: 'universidade', rotulo: 'Universidade', Icone: GraduationCap },
  { chave: 'hospital', rotulo: 'Hospital', Icone: Hospital },
  { chave: 'clinica', rotulo: 'Clínica', Icone: Stethoscope },
  { chave: 'farmacia', rotulo: 'Farmácia', Icone: Pill },
  { chave: 'metro', rotulo: 'Metrô', Icone: TrainFrontTunnel },
  { chave: 'trem', rotulo: 'Trem', Icone: TrainFront },
  { chave: 'onibus', rotulo: 'Ônibus', Icone: Bus },
  { chave: 'shopping', rotulo: 'Shopping', Icone: ShoppingBag },
  { chave: 'parque', rotulo: 'Parque', Icone: Trees },
  { chave: 'academia', rotulo: 'Academia', Icone: Dumbbell },
  { chave: 'restaurante', rotulo: 'Restaurante', Icone: UtensilsCrossed },
  { chave: 'cafe', rotulo: 'Café', Icone: Coffee },
  { chave: 'banco', rotulo: 'Banco', Icone: Landmark },
  { chave: 'padaria', rotulo: 'Padaria', Icone: Croissant },
  { chave: 'posto', rotulo: 'Posto de combustível', Icone: Fuel },
  { chave: 'igreja', rotulo: 'Igreja', Icone: Church },
  { chave: 'biblioteca', rotulo: 'Biblioteca', Icone: BookOpen },
  { chave: 'saude', rotulo: 'Posto de saúde', Icone: HeartPulse },
  { chave: 'aeroporto', rotulo: 'Aeroporto', Icone: Plane },
  { chave: 'rodovia', rotulo: 'Rodovia / avenida', Icone: Route },
  { chave: 'comercio', rotulo: 'Comércio', Icone: Building2 },
]

const indice = (lista: ItemCatalogo[]) => new Map(lista.map((i) => [i.chave, i]))
const LAZER = indice(CATALOGO_LAZER)
const PROXIMIDADE = indice(CATALOGO_PROXIMIDADE)

export type TipoCatalogo = 'lazer' | 'proximidade'

/** Item do catálogo pela chave gravada; `null` para chave vazia ou desconhecida (a tela cai no ícone padrão). */
export function itemDoCatalogo(tipo: TipoCatalogo, chave: string | null | undefined): ItemCatalogo | null {
  if (!chave) return null
  return (tipo === 'lazer' ? LAZER : PROXIMIDADE).get(chave) ?? null
}

/** Texto comparável: sem acento, sem caixa e sem espaço sobrando ("Salão de Festas " = "salao de festas"). */
export function normalizarRotulo(t: string) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Qual item do catálogo um registro representa: a chave gravada vale; sem chave (itens antigos, do WordPress), o título
 * igual ao rótulo do catálogo também conta, para o chip aparecer ligado e ninguém cadastrar o mesmo item duas vezes.
 */
export function chaveDoRegistro(tipo: TipoCatalogo, registro: { icone_catalogo?: string | null; titulo?: string | null }): string | null {
  if (registro.icone_catalogo) return itemDoCatalogo(tipo, registro.icone_catalogo)?.chave ?? null
  if (!registro.titulo) return null
  const alvo = normalizarRotulo(registro.titulo)
  const lista = tipo === 'lazer' ? CATALOGO_LAZER : CATALOGO_PROXIMIDADE
  return lista.find((i) => normalizarRotulo(i.rotulo) === alvo)?.chave ?? null
}

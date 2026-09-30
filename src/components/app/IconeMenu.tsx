import {
  ArrowRightLeft, BarChart3, Building2, ClipboardList, Contact, Copy, DatabaseBackup, FileSignature, FileText, History, Home, IdCard,
  Inbox, KeyRound, LayoutDashboard, Network, Settings, ShieldCheck, SquareKanban, UserCheck, Users, type LucideIcon,
} from 'lucide-react'
import type { IconeMenu as NomeIcone } from '@/lib/menu'

const ICONES: Record<NomeIcone, LucideIcon> = {
  empreendimentos: Building2,
  funil: SquareKanban,
  clientes: Contact,
  tarefas: ClipboardList,
  contratos: FileSignature,
  imoveis: Home,
  propostas: FileText,
  equipe: Users,
  links: Copy,
  cadastro: IdCard,
  visao_geral: LayoutDashboard,
  relatorios: BarChart3,
  rede: Network,
  pendentes: UserCheck,
  duplicidades: ArrowRightLeft,
  leads: Inbox,
  auditoria: History,
  migracao: DatabaseBackup,
  configuracoes: Settings,
  seguranca: ShieldCheck,
  portal: KeyRound,
}

export function IconeMenu({ nome, tamanho = 17 }: { nome: NomeIcone; tamanho?: number }) {
  const I = ICONES[nome]
  return <I size={tamanho} aria-hidden />
}

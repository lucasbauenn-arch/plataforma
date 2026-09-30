import { useLocation } from 'react-router-dom'
import { BASE, type AreaApp } from '@/lib/menu'

/** Área da rota atual: admin ou área de parceiros. */
export function useArea(): AreaApp {
  return useLocation().pathname.startsWith(BASE.admin) ? 'admin' : 'painel'
}

/**
 * Prefixo das rotas da área atual (`/admin` ou `/parceiros/painel`). Os módulos compartilhados (ficha, kanban,
 * contratos, imóveis) montam os links com ele, então o mesmo componente serve às duas áreas.
 */
export function useBase(): string {
  return BASE[useArea()]
}

import { Outlet } from 'react-router-dom'
import { AbasRota } from '@/components/app/Abas'
import { CabecalhoPagina } from '@/components/app/CabecalhoPagina'

const BASE = '/admin/configuracoes'

const SECOES = [
  { para: BASE, rotulo: 'Regras provisórias', exato: true },
  { para: `${BASE}/geral`, rotulo: 'Geral' },
  { para: `${BASE}/simulacao`, rotulo: 'Simulação' },
  { para: `${BASE}/modelos`, rotulo: 'Modelos' },
  { para: `${BASE}/signatarios`, rotulo: 'Signatários' },
  { para: `${BASE}/transicoes`, rotulo: 'Transições' },
  { para: `${BASE}/permissoes`, rotulo: 'Permissões' },
  { para: `${BASE}/notificacoes`, rotulo: 'Notificações' },
  { para: `${BASE}/termos`, rotulo: 'Termos' },
  { para: `${BASE}/equipe`, rotulo: 'Equipe' },
  { para: `${BASE}/anonimizacao`, rotulo: 'Anonimização' },
]

/** Casca de /admin/configuracoes (só o Super: rota protegida por `config.ver` e cada RPC confere `is_super()`). */
export default function Configuracoes() {
  return (
    <>
      <CabecalhoPagina
        titulo="Configurações"
        subtitulo='Só o Super altera. Os campos com o selo "Provisório" seguem decisões que o negócio ainda precisa confirmar.'
      />
      <AbasRota abas={SECOES} rotulo="Seções das configurações" />
      <div className="mt-8"><Outlet /></div>
    </>
  )
}

import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SiteLayout } from '@/components/Layout'
import { Protegido } from '@/components/Protegido'
import { Carregando } from '@/components/Estados'
import { SeoRotas } from '@/components/Seo'
import Home from '@/pages/Home'

const Empreendimentos = lazy(() => import('@/pages/Empreendimentos'))
const Empreendimento = lazy(() => import('@/pages/Empreendimento'))
const QuemSomos = lazy(() => import('@/pages/QuemSomos'))
const Portfolio = lazy(() => import('@/pages/Portfolio'))
const Legal = lazy(() => import('@/pages/Legal'))
const NaoEncontrada = lazy(() => import('@/pages/NaoEncontrada'))
const LoginParceiro = lazy(() => import('@/pages/parceiros/Login'))
const CadastroParceiro = lazy(() => import('@/pages/parceiros/Cadastro'))
const RecuperarSenha = lazy(() => import('@/pages/parceiros/RecuperarSenha'))
const NovaSenha = lazy(() => import('@/pages/parceiros/NovaSenha'))
const PainelParceiro = lazy(() => import('@/pages/parceiros/Painel'))
const EmpsParceiro = lazy(() => import('@/pages/parceiros/painel/Empreendimentos'))
const ClientesParceiro = lazy(() => import('@/pages/parceiros/painel/Clientes'))
const PropostasParceiro = lazy(() => import('@/pages/parceiros/painel/Propostas'))
const LoginCliente = lazy(() => import('@/pages/cliente/Login'))
const PortalCliente = lazy(() => import('@/pages/cliente/Portal'))
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'))
const Dashboard = lazy(() => import('@/pages/admin/Dashboard'))
const Relatorios = lazy(() => import('@/pages/admin/Relatorios'))
const EmpsAdmin = lazy(() => import('@/pages/admin/Empreendimentos'))
const EmpEditor = lazy(() => import('@/pages/admin/EmpreendimentoEditor'))
const ParceirosAdmin = lazy(() => import('@/pages/admin/Parceiros'))
const PropostasAdmin = lazy(() => import('@/pages/admin/Propostas'))
const ClientesAdmin = lazy(() => import('@/pages/admin/Clientes'))
const Leads = lazy(() => import('@/pages/admin/Leads'))

export default function App() {
  return (
    <BrowserRouter>
      <SeoRotas />
      <Suspense fallback={<div className="pt-32"><Carregando /></div>}>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<Home />} />
            <Route path="empreendimentos" element={<Empreendimentos />} />
            <Route path="empreendimentos/:slug" element={<Empreendimento />} />
            <Route path="quem-somos" element={<QuemSomos />} />
            <Route path="portfolio" element={<Portfolio />} />
            <Route path="termos-de-uso" element={<Legal tipo="termos" />} />
            <Route path="politica-de-privacidade" element={<Legal tipo="privacidade" />} />
            <Route path="politica-de-cookies" element={<Legal tipo="cookies" />} />

            <Route path="parceiros" element={<LoginParceiro />} />
            <Route path="parceiros/cadastro" element={<CadastroParceiro />} />
            <Route path="parceiros/recuperar-senha" element={<RecuperarSenha />} />
            <Route path="parceiros/nova-senha" element={<NovaSenha />} />
            <Route path="parceiros/painel" element={<Protegido papeis={['parceiro', 'admin']} redirecionar="/parceiros"><PainelParceiro /></Protegido>}>
              <Route index element={<EmpsParceiro />} />
              <Route path="clientes" element={<ClientesParceiro />} />
              <Route path="propostas" element={<PropostasParceiro />} />
            </Route>

            <Route path="portal-do-cliente" element={<LoginCliente />} />
            <Route path="portal-do-cliente/meus-imoveis" element={<Protegido papeis={['cliente']} redirecionar="/portal-do-cliente"><PortalCliente /></Protegido>} />

            {/* URLs antigas do WordPress */}
            <Route path="login-parceiros" element={<Navigate to="/parceiros" replace />} />
            <Route path="cadastro-parceiro" element={<Navigate to="/parceiros/cadastro" replace />} />
            <Route path="portfolio-brasil" element={<Navigate to="/portfolio" replace />} />
            <Route path="empreendimento" element={<Navigate to="/parceiros/painel" replace />} />
            <Route path="cliente" element={<Navigate to="/portal-do-cliente" replace />} />
            <Route path="*" element={<NaoEncontrada />} />
          </Route>

          <Route path="admin" element={<Protegido papeis={['admin']} redirecionar="/parceiros"><AdminLayout /></Protegido>}>
            <Route index element={<Dashboard />} />
            <Route path="relatorios" element={<Relatorios />} />
            <Route path="empreendimentos" element={<EmpsAdmin />} />
            <Route path="empreendimentos/:id" element={<EmpEditor />} />
            <Route path="parceiros" element={<ParceirosAdmin />} />
            <Route path="propostas" element={<PropostasAdmin />} />
            <Route path="clientes" element={<ClientesAdmin />} />
            <Route path="leads" element={<Leads />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SiteLayout } from '@/components/Layout'
import { Protegido } from '@/components/Protegido'
import { Carregando } from '@/components/Estados'
import { LimiteErroDeRotas } from '@/components/LimiteErro'
import { SeoRotas } from '@/components/Seo'
import Home from '@/pages/Home'
import type { Papel, Permissao } from '@/lib/types'

// site público
const Empreendimentos = lazy(() => import('@/pages/Empreendimentos'))
const Empreendimento = lazy(() => import('@/pages/Empreendimento'))
const QuemSomos = lazy(() => import('@/pages/QuemSomos'))
const Portfolio = lazy(() => import('@/pages/Portfolio'))
const Legal = lazy(() => import('@/pages/Legal'))
const NaoEncontrada = lazy(() => import('@/pages/NaoEncontrada'))
// pré-cadastro público [WP2]: o arquivo roteado é este (no lugar de src/pages/publicas/PreCadastro.tsx da §8.3)
const PreCadastro = lazy(() => import('@/modulos/crm/paginas/PreCadastro'))

// parceiros: acesso
const LoginParceiro = lazy(() => import('@/pages/parceiros/Login'))
const CadastroParceiro = lazy(() => import('@/pages/parceiros/Cadastro'))
const RecuperarSenha = lazy(() => import('@/pages/parceiros/RecuperarSenha'))
const NovaSenha = lazy(() => import('@/pages/parceiros/NovaSenha'))
const DefinirSenha = lazy(() => import('@/modulos/rede/paginas/DefinirSenha'))

// área de parceiros
const PainelLayout = lazy(() => import('@/pages/parceiros/PainelLayout'))
const EmpsParceiro = lazy(() => import('@/pages/parceiros/painel/Empreendimentos'))
const PropostasParceiro = lazy(() => import('@/pages/parceiros/painel/Propostas'))
const Equipe = lazy(() => import('@/modulos/rede/paginas/Equipe'))
const MeuCadastro = lazy(() => import('@/modulos/rede/paginas/MeuCadastro'))
const Links = lazy(() => import('@/modulos/crm/paginas/Links'))

// módulos compartilhados entre admin e área de parceiros (o escopo é decidido pelo servidor)
const Funil = lazy(() => import('@/modulos/crm/paginas/Funil'))
const ListaClientes = lazy(() => import('@/modulos/crm/paginas/Lista'))
const NovoCliente = lazy(() => import('@/modulos/crm/paginas/NovoCliente'))
const Ficha = lazy(() => import('@/modulos/crm/ficha/Ficha'))
const Tarefas = lazy(() => import('@/modulos/crm/paginas/Tarefas'))
const Contratos = lazy(() => import('@/modulos/contratos/paginas/Contratos'))
const Contrato = lazy(() => import('@/modulos/contratos/paginas/Contrato'))
const Imoveis = lazy(() => import('@/modulos/imoveis/paginas/Imoveis'))
const Imovel = lazy(() => import('@/modulos/imoveis/paginas/Imovel'))
const ParceiroDetalhe = lazy(() => import('@/modulos/rede/paginas/ParceiroDetalhe'))

// portal do cliente
const LoginCliente = lazy(() => import('@/pages/cliente/Login'))
const PortalCliente = lazy(() => import('@/pages/cliente/Portal'))

// admin
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'))
const Dashboard = lazy(() => import('@/pages/admin/Dashboard'))
const Relatorios = lazy(() => import('@/pages/admin/Relatorios'))
const EmpsAdmin = lazy(() => import('@/pages/admin/Empreendimentos'))
const EmpEditor = lazy(() => import('@/pages/admin/EmpreendimentoEditor'))
const PropostasAdmin = lazy(() => import('@/pages/admin/Propostas'))
const ClientesAdmin = lazy(() => import('@/pages/admin/Clientes'))
const Leads = lazy(() => import('@/pages/admin/Leads'))
const Rede = lazy(() => import('@/modulos/rede/paginas/Rede'))
const Imobiliaria = lazy(() => import('@/modulos/rede/paginas/Imobiliaria'))
const Pendentes = lazy(() => import('@/modulos/rede/paginas/Pendentes'))
const Duplicidades = lazy(() => import('@/modulos/crm/paginas/Duplicidades'))
const Auditoria = lazy(() => import('@/modulos/governanca/paginas/Auditoria'))
const Migracao = lazy(() => import('@/modulos/governanca/paginas/Migracao'))
const Seguranca = lazy(() => import('@/modulos/governanca/paginas/Seguranca'))

// configurações (Super)
const Configuracoes = lazy(() => import('@/modulos/config/Configuracoes'))
const RegrasProvisorias = lazy(() => import('@/modulos/config/RegrasProvisorias'))
const CfgGeral = lazy(() => import('@/modulos/config/Geral'))
const CfgSimulacao = lazy(() => import('@/modulos/config/Simulacao'))
const CfgModelos = lazy(() => import('@/modulos/config/Modelos'))
const CfgSignatarios = lazy(() => import('@/modulos/config/Signatarios'))
const CfgTransicoes = lazy(() => import('@/modulos/config/Transicoes'))
const CfgPermissoes = lazy(() => import('@/modulos/config/Permissoes'))
const CfgNotificacoes = lazy(() => import('@/modulos/config/Notificacoes'))
const CfgTermos = lazy(() => import('@/modulos/config/Termos'))
const CfgEquipe = lazy(() => import('@/modulos/config/Equipe'))
const CfgAnonimizacao = lazy(() => import('@/modulos/config/Anonimizacao'))

const PAPEIS_PAINEL: Papel[] = ['imobiliaria', 'gerente', 'corretor', 'parceiro', 'admin', 'super']
const PAPEIS_ADMIN: Papel[] = ['admin', 'super']

/** Rota filha que exige uma permissão de `meu_escopo()` (o layout já conferiu o papel). */
const Exige = ({ p, children }: { p: Permissao; children: ReactNode }) => <Protegido permissao={p}>{children}</Protegido>

export default function App() {
  return (
    <BrowserRouter>
      <SeoRotas />
      <LimiteErroDeRotas>
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
            <Route path="pre-cadastro/cliente/:codigo" element={<PreCadastro />} />

            <Route path="parceiros" element={<LoginParceiro />} />
            <Route path="parceiros/cadastro" element={<CadastroParceiro />} />
            <Route path="parceiros/recuperar-senha" element={<RecuperarSenha />} />
            <Route path="parceiros/nova-senha" element={<NovaSenha />} />
            <Route path="parceiros/definir-senha" element={<DefinirSenha />} />

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

          {/* área de parceiros: fora do SiteLayout, com barra lateral */}
          <Route path="parceiros/painel" element={<Protegido papeis={PAPEIS_PAINEL} redirecionar="/parceiros"><PainelLayout /></Protegido>}>
            <Route index element={<Exige p="empreendimentos.ver"><EmpsParceiro /></Exige>} />
            <Route path="crm" element={<Exige p="crm.ver"><Funil /></Exige>} />
            <Route path="crm/lista" element={<Exige p="crm.ver"><ListaClientes /></Exige>} />
            <Route path="crm/novo" element={<Exige p="crm.cadastrar"><NovoCliente /></Exige>} />
            <Route path="crm/:id" element={<Exige p="crm.ver"><Ficha /></Exige>} />
            <Route path="tarefas" element={<Exige p="crm.ver"><Tarefas /></Exige>} />
            {/* telas antigas substituídas: a lista de parceiro_clientes virou o CRM [WP2] */}
            <Route path="clientes" element={<Navigate to="/parceiros/painel/crm/lista" replace />} />
            <Route path="equipe" element={<Exige p="rede.ver"><Equipe /></Exige>} />
            <Route path="equipe/:id" element={<Exige p="rede.ver"><ParceiroDetalhe /></Exige>} />
            <Route path="contratos" element={<Exige p="contratos.ver"><Contratos /></Exige>} />
            <Route path="contratos/:id" element={<Exige p="contratos.ver"><Contrato /></Exige>} />
            <Route path="imoveis" element={<Exige p="imoveis.ver"><Imoveis /></Exige>} />
            <Route path="imoveis/novo" element={<Exige p="imoveis.cadastrar"><Imovel /></Exige>} />
            <Route path="imoveis/:id" element={<Exige p="imoveis.ver"><Imovel /></Exige>} />
            <Route path="propostas" element={<Exige p="propostas.ver"><PropostasParceiro /></Exige>} />
            <Route path="links" element={<Exige p="crm.links"><Links /></Exige>} />
            <Route path="meu-cadastro" element={<Exige p="meu_cadastro.editar"><MeuCadastro /></Exige>} />
            <Route path="*" element={<Navigate to="/parceiros/painel" replace />} />
          </Route>

          <Route path="admin" element={<Protegido papeis={PAPEIS_ADMIN} redirecionar="/parceiros"><AdminLayout /></Protegido>}>
            <Route index element={<Exige p="admin.acessar"><Dashboard /></Exige>} />
            <Route path="relatorios" element={<Exige p="relatorios.ver"><Relatorios /></Exige>} />
            <Route path="empreendimentos" element={<Exige p="empreendimentos.gerenciar"><EmpsAdmin /></Exige>} />
            <Route path="empreendimentos/:id" element={<Exige p="empreendimentos.gerenciar"><EmpEditor /></Exige>} />
            {/* telas antigas substituídas: Parceiros virou Rede (convite em lote pelo v2) [WP1] */}
            <Route path="parceiros" element={<Navigate to="/admin/rede" replace />} />
            <Route path="propostas" element={<Exige p="propostas.responder"><PropostasAdmin /></Exige>} />
            <Route path="clientes" element={<Exige p="crm.portal"><ClientesAdmin /></Exige>} />
            <Route path="leads" element={<Exige p="leads.ver"><Leads /></Exige>} />
            <Route path="crm" element={<Exige p="crm.ver"><Funil /></Exige>} />
            <Route path="crm/lista" element={<Exige p="crm.ver"><ListaClientes /></Exige>} />
            <Route path="crm/novo" element={<Exige p="crm.cadastrar"><NovoCliente /></Exige>} />
            <Route path="crm/:id" element={<Exige p="crm.ver"><Ficha /></Exige>} />
            <Route path="tarefas" element={<Exige p="crm.ver"><Tarefas /></Exige>} />
            <Route path="rede" element={<Exige p="rede.ver"><Rede /></Exige>} />
            <Route path="rede/imobiliarias/:id" element={<Exige p="rede.ver"><Imobiliaria /></Exige>} />
            <Route path="rede/parceiros/:id" element={<Exige p="rede.ver"><ParceiroDetalhe /></Exige>} />
            <Route path="rede/pendentes" element={<Exige p="rede.aprovar"><Pendentes /></Exige>} />
            <Route path="duplicidades" element={<Exige p="crm.duplicidades"><Duplicidades /></Exige>} />
            <Route path="contratos" element={<Exige p="contratos.ver"><Contratos /></Exige>} />
            <Route path="contratos/:id" element={<Exige p="contratos.ver"><Contrato /></Exige>} />
            <Route path="imoveis" element={<Exige p="imoveis.ver"><Imoveis /></Exige>} />
            <Route path="imoveis/novo" element={<Exige p="imoveis.cadastrar"><Imovel /></Exige>} />
            <Route path="imoveis/:id" element={<Exige p="imoveis.ver"><Imovel /></Exige>} />
            <Route path="auditoria" element={<Exige p="auditoria.ver"><Auditoria /></Exige>} />
            <Route path="migracao" element={<Exige p="migracao.ver"><Migracao /></Exige>} />
            {/* sem permissão: abre também com 2FA pendente (aal1), para o interno concluir o TOTP */}
            <Route path="seguranca" element={<Seguranca />} />
            <Route path="configuracoes" element={<Exige p="config.ver"><Configuracoes /></Exige>}>
              <Route index element={<RegrasProvisorias />} />
              <Route path="geral" element={<CfgGeral />} />
              <Route path="simulacao" element={<CfgSimulacao />} />
              <Route path="modelos" element={<CfgModelos />} />
              <Route path="signatarios" element={<CfgSignatarios />} />
              <Route path="transicoes" element={<CfgTransicoes />} />
              <Route path="permissoes" element={<CfgPermissoes />} />
              <Route path="notificacoes" element={<CfgNotificacoes />} />
              <Route path="termos" element={<CfgTermos />} />
              <Route path="equipe" element={<CfgEquipe />} />
              <Route path="anonimizacao" element={<CfgAnonimizacao />} />
            </Route>
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
        </Routes>
      </Suspense>
      </LimiteErroDeRotas>
    </BrowserRouter>
  )
}

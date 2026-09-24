import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Header } from './Header'
import { Footer } from './Footer'
import { WhatsappFlutuante } from './WhatsappFlutuante'

export function SiteLayout() {
  const { pathname } = useLocation()
  // chaves: no Chromium recente scrollTo retorna Promise, e o React trata retorno de efeito como cleanup
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  const sobreposto = pathname === '/' || pathname.startsWith('/empreendimentos/')
  return (
    <>
      <Header sobreposto={sobreposto} />
      <main className={sobreposto ? '' : 'pt-18'}>
        <Outlet />
      </main>
      <Footer />
      <WhatsappFlutuante />
    </>
  )
}

import '@/lib/zod-config' // primeiro de todos: precisa valer antes de qualquer schema (ver o arquivo)
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/lib/auth'
import { instalarRecargaPorModuloAntigo } from '@/lib/modulos'
import { LimiteErro } from '@/components/LimiteErro'
import App from './App'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } } })

// depois de um deploy, um chunk com hash antigo falha ao carregar: recarrega a página uma vez (FUX-02)
instalarRecargaPorModuloAntigo()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LimiteErro>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
          <Toaster position="top-center" theme="dark" richColors />
        </AuthProvider>
      </QueryClientProvider>
    </LimiteErro>
  </StrictMode>,
)

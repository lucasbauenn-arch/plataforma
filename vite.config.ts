/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // @shared: SÓ os módulos puros das Edge Functions (sem Deno.* nem npm:), usados na prévia do front
      // (simulação e modelo de contrato, §6). Os demais arquivos de _shared são código Deno e não entram no bundle.
      { find: /^@shared\/(simulacao|modelo-contrato)$/, replacement: path.resolve(import.meta.dirname, 'supabase/functions/_shared/$1.ts') },
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
    ],
  },
  build: {
    rolldownOptions: {
      output: {
        // o chunk de entrada passava de 500 kB (aviso do build): as bibliotecas que quase nunca mudam ganham arquivos
        // próprios (cache do navegador entre deploys) e o código do app fica pequeno
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'vendor-router', test: /node_modules[\\/](react-router|react-router-dom)[\\/]/, priority: 20 },
            { name: 'vendor-query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  // permite acessar o `npm run dev` por um túnel (cloudflared/ngrok) para testar em outro dispositivo — só afeta o servidor local
  server: { allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'] },
  // unitários (Vitest) em src/, nos módulos puros das Edge Functions (_shared e os fluxo/dados/modelos de cada função,
  // sem Deno.* nem npm:) e nos scripts de deploy (scripts/*.test.mjs); fluxos ponta a ponta (Playwright) ficam em e2e/
  test: { include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts', 'scripts/**/*.test.mjs'], environment: 'node' },
})

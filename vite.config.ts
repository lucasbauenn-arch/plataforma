/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // permite acessar o `npm run dev` por um túnel (cloudflared/ngrok) para testar em outro dispositivo — só afeta o servidor local
  server: { allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'] },
  // unitários (Vitest) em src/; fluxos ponta a ponta (Playwright) ficam em e2e/
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})

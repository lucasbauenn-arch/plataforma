import { defineConfig } from '@playwright/test'

// Fluxos ponta a ponta com a rede do Supabase simulada (e2e/apoio.ts) — nada é gravado no banco real.
// Usa o Chrome instalado na máquina (sem download de navegador).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5190', channel: 'chrome', headless: true, locale: 'pt-BR', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --port 5190 --strictPort', url: 'http://localhost:5190', reuseExistingServer: true, timeout: 60_000 },
})

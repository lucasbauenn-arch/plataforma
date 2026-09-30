import { defineConfig } from '@playwright/test'

// Fluxos REAIS contra a stack Supabase LOCAL completa (fora da suíte normal: o playwright.config.ts da raiz só lê
// e2e/). O front sobe em `vite --mode stack`, que lê o .env.stack.local gerado pelo verificar.sh (URL e chave da
// stack local). Nada é simulado; a guarda de e2e-real/apoio.ts derruba qualquer chamada a um Supabase na nuvem.
// uso: STACK_ESTADO=… STACK_SENHA=… npx playwright test -c e2e-real/playwright.config.ts
const PORTA = Number(process.env.E2E_PORTA ?? 5232)

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: process.env.E2E_SAIDA ?? '../test-results/e2e-real',
  use: { baseURL: `http://localhost:${PORTA}`, channel: 'chrome', headless: true, locale: 'pt-BR', trace: 'retain-on-failure', actionTimeout: 30_000 },
  webServer: {
    command: `npx vite --mode stack --port ${PORTA} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORTA}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

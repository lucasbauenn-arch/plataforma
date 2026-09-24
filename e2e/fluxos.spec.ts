import { expect, test } from '@playwright/test'
import { empreendimentoTeste, entrarComo, jwtFalso, responderRest, simularTurnstile, usuario } from './apoio'

test('visitante envia contato pela home (com Turnstile)', async ({ page }) => {
  await simularTurnstile(page)
  let corpo: Record<string, unknown> = {}
  await page.route('**/functions/v1/enviar-lead', async (r) => {
    corpo = r.request().postDataJSON()
    await r.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.goto('/')
  const form = page.locator('form', { hasText: 'Quero ser atendido' })
  await form.getByLabel('Nome').fill('Visitante E2E')
  await form.getByLabel('Telefone / WhatsApp').fill('11988887777')
  await form.getByLabel('Mensagem').fill('Quero saber sobre o FGTS')
  await form.getByRole('button', { name: 'Quero ser atendido' }).click()
  await expect(page.getByText('Recebemos seu contato.')).toBeVisible()
  expect(corpo).toMatchObject({ nome: 'Visitante E2E', telefone: '(11) 98888-7777', captcha: 'token-e2e' })
})

test('corretor faz o cadastro de parceiro (com Turnstile e aceite de termos)', async ({ page }) => {
  await simularTurnstile(page)
  let corpo: { email?: string; data?: Record<string, string>; gotrue_meta_security?: { captcha_token?: string } } = {}
  await page.route('**/auth/v1/signup**', async (r) => {
    corpo = r.request().postDataJSON()
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(usuario('22222222-2222-2222-2222-222222222222', 'corretor@e2e.com')) })
  })
  await page.goto('/parceiros/cadastro')
  await page.getByLabel('Nome completo').fill('Corretor E2E')
  await page.getByLabel('E-mail').fill('corretor@e2e.com')
  await page.getByLabel('Telefone / WhatsApp').fill('11977776666')
  await page.getByLabel('CRECI').fill('123456-F')
  await page.getByLabel('Senha').fill('senha-de-teste-e2e')
  await page.getByRole('button', { name: 'Criar cadastro' }).click()
  await expect(page.getByText('Aceite os termos para continuar')).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Criar cadastro' }).click()
  await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible()
  expect(corpo.email).toBe('corretor@e2e.com')
  expect(corpo.data).toMatchObject({ nome: 'Corretor E2E', creci: '123456-F' })
  expect(corpo.gotrue_meta_security?.captcha_token).toBe('token-e2e')
})

test('cliente entra no portal só com CPF e vê imóvel e andamento da obra', async ({ page }) => {
  const id = '33333333-3333-3333-3333-333333333333'
  let cpfEnviado = ''
  await page.route('**/functions/v1/cliente-login', async (r) => {
    cpfEnviado = r.request().postDataJSON().cpf
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ access_token: jwtFalso(id, 'c@e2e'), refresh_token: 'r' }) })
  })
  await page.route('**/auth/v1/user', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(usuario(id, 'c@e2e')) }))
  await page.route('**/rest/v1/profiles**', (r) => responderRest(r, [{ id, papel: 'cliente', nome: 'Cliente E2E', status_parceiro: 'pendente' }]))
  await page.route('**/rest/v1/clientes**', (r) => responderRest(r, [{ id: 'c1', user_id: id, nome: 'Cliente E2E', cpf: '52998224725' }]))
  await page.route('**/rest/v1/cliente_negocios**', (r) => responderRest(r, [{
    id: 'n1', cliente_id: 'c1', empreendimento_id: empreendimentoTeste.id, valor: 280000, descricao: null, created_at: '2026-09-01',
    empreendimentos: { nome: 'Residencial E2E', slug: 'residencial-e2e', capa_url: null }, unidades: { identificador: 'APTO 12', metragem: 45 },
  }]))
  await page.route('**/rest/v1/cliente_arquivos**', (r) => responderRest(r, []))
  await page.route('**/rest/v1/obra_atualizacoes**', (r) => responderRest(r, [{ id: 'o1', percentual: 35, titulo: 'Estrutura', descricao: null, fotos: [], data: '2026-09-10' }]))

  await page.goto('/portal-do-cliente')
  await page.getByLabel('CPF').fill('52998224725')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Bem-vindo(a), Cliente' })).toBeVisible()
  await expect(page.getByText('Residencial E2E')).toBeVisible()
  await expect(page.getByText('35%')).toBeVisible()
  expect(cpfEnviado).toBe('529.982.247-25')
})

test('CPF inválido nem chega ao servidor', async ({ page }) => {
  let chamou = false
  await page.route('**/functions/v1/cliente-login', (r) => { chamou = true; return r.fulfill({ status: 500 }) })
  await page.goto('/portal-do-cliente')
  await page.getByLabel('CPF').fill('22222222222')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('CPF inválido')).toBeVisible()
  expect(chamou).toBe(false)
})

test('parceiro aprovado envia proposta', async ({ page }) => {
  const id = '44444444-4444-4444-4444-444444444444'
  await entrarComo(page, id, 'parceiro@e2e.com')
  await page.route('**/rest/v1/profiles**', (r) => responderRest(r, [{ id, papel: 'parceiro', status_parceiro: 'aprovado', nome: 'Parceira E2E' }]))
  await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, [empreendimentoTeste]))
  await page.route('**/rest/v1/parceiro_clientes**', (r) => responderRest(r, []))
  const propostas: Record<string, unknown>[] = []
  await page.route('**/rest/v1/propostas**', async (r) => {
    if (r.request().method() === 'POST') {
      const p = r.request().postDataJSON()
      propostas.push({ ...p, id: 'p1', status: 'enviada', created_at: new Date().toISOString(), empreendimentos: { nome: 'Residencial E2E' }, parceiro_clientes: null })
      return r.fulfill({ status: 201, contentType: 'application/json', body: '' })
    }
    return responderRest(r, propostas)
  })

  await page.goto('/parceiros/painel/propostas')
  await expect(page.getByRole('heading', { name: 'Olá, Parceira' })).toBeVisible()
  await page.getByLabel('Empreendimento').selectOption({ label: 'Residencial E2E' })
  await page.getByLabel('Proposta').fill('APTO 12, entrada de 10% + FGTS, financiamento Caixa.')
  await page.getByRole('button', { name: 'Enviar proposta' }).click()
  await expect(page.getByText('Proposta enviada!')).toBeVisible()
  await expect(page.locator('li', { hasText: 'Residencial E2E' }).getByText('Enviada')).toBeVisible()
  expect(propostas[0]).toMatchObject({ parceiro_id: id, empreendimento_id: empreendimentoTeste.id })
})

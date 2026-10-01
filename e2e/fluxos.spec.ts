import { expect as expectBase, test } from '@playwright/test'
import {
  empreendimentoTeste, entrarComo, isolarSupabase, jwtFalso, responderRest, simularRpc, simularTurnstile, usuario,
} from './apoio'

// Os 5 fluxos principais, no modelo novo (docs/ARQUITETURA_EXPANSAO.md §7.2, §7.4, §10.1): contato pelo site; cadastro
// espontâneo de corretor (CPF e CRECI obrigatórios, termo vigente versionado); portal do cliente só por CPF, com os
// dados pessoais pelas RPCs portal_*; CPF inválido barrado no navegador; e proposta de um corretor da rede pelas RPCs
// propostas_* com o cliente do CRM. Toda a rede do Supabase é simulada (e2e/apoio.ts): nada chega ao banco real.

// com vários workers o Vite compila as telas sob demanda: a primeira carga de cada página pode passar dos 5 s padrão
test.describe.configure({ timeout: 90_000 })
const expect = expectBase.configure({ timeout: 30_000 })

test('visitante envia contato pela home (com Turnstile)', async ({ page }) => {
  await isolarSupabase(page)
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

test('corretor faz o cadastro de parceiro (CPF, CRECI, Turnstile e aceite do termo vigente)', async ({ page }) => {
  await isolarSupabase(page)
  await simularTurnstile(page)
  const TERMO = 'e0000000-0000-4000-8000-0000000000f1'
  const termos = await simularRpc(page, 'lgpd_termo_vigente', {
    id: TERMO, tipo: 'termos_parceiro', versao: '1.0', texto: 'Termos de uso e política de privacidade da rede Arken.',
    vigente_desde: '2026-09-01T00:00:00Z', revisado_juridico: true,
  })
  let corpo: { email?: string; data?: Record<string, string>; gotrue_meta_security?: { captcha_token?: string } } = {}
  await page.route('**/auth/v1/signup**', async (r) => {
    corpo = r.request().postDataJSON()
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(usuario('22222222-2222-2222-2222-222222222222', 'corretor@e2e.com')) })
  })
  await page.goto('/parceiros/cadastro')
  await page.getByLabel('Nome completo').fill('Corretor E2E')
  await page.getByLabel('CPF').fill('52998224725')
  await page.getByLabel('E-mail').fill('corretor@e2e.com')
  await page.getByLabel('Telefone / WhatsApp').fill('11977776666')
  await page.getByLabel('CRECI').fill('123456-F')
  await page.getByLabel('Senha').fill('senha-de-teste-e2e')
  // o termo vigente é lido por anon e o aceite cita a versão
  await expect(page.getByText('(versão 1.0)')).toBeVisible()
  expect(termos[0]).toEqual({ p_tipo: 'termos_parceiro' })
  await page.getByRole('button', { name: 'Criar cadastro' }).click()
  await expect(page.getByText('Aceite os termos para continuar')).toBeVisible()
  expect(corpo.email).toBeUndefined()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Criar cadastro' }).click()
  await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible()
  expect(corpo.email).toBe('corretor@e2e.com')
  // CPF só com dígitos e o id do termo aceito nos metadados; nunca papel nem cadeia (a aprovação decide)
  expect(corpo.data).toMatchObject({ nome: 'Corretor E2E', cpf: '52998224725', creci: '123456-F', termo_id: TERMO })
  expect(corpo.data).not.toHaveProperty('papel')
  expect(corpo.data).not.toHaveProperty('imobiliaria_id')
  expect(corpo.gotrue_meta_security?.captcha_token).toBe('token-e2e')
})

test('cliente entra no portal só com CPF e vê imóvel, andamento da obra e seu corretor (dados pelas RPCs do portal)', async ({ page }) => {
  const id = '33333333-3333-3333-3333-333333333333'
  const cliente = 'd3333333-3333-4333-8333-333333333333'
  await isolarSupabase(page)
  let cpfEnviado = ''
  await page.route('**/functions/v1/cliente-login', async (r) => {
    cpfEnviado = r.request().postDataJSON().cpf
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ access_token: jwtFalso(id, 'c@e2e'), refresh_token: 'r' }) })
  })
  await page.route('**/auth/v1/user', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(usuario(id, 'c@e2e')) }))
  await page.route('**/rest/v1/profiles**', (r) => responderRest(r, [{ id, papel: 'cliente', nome: 'Cliente E2E', status_parceiro: 'pendente' }]))
  // o portal não lê mais a tabela clientes: dados pessoais só por portal_meus_dados (auditada no servidor)
  const leiturasClientes: string[] = []
  await page.route('**/rest/v1/clientes**', (r) => { leiturasClientes.push(r.request().url()); return responderRest(r, []) })
  const meusDados = await simularRpc(page, 'portal_meus_dados', {
    id: cliente, nome: 'Cliente E2E', sobrenome: null, cpf: '52998224725', email: null, telefone: null,
    cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null,
  })
  await simularRpc(page, 'portal_meu_corretor', {
    nome: 'Carla Corretora', telefone: '11988887777', email: 'carla@e2e.test', creci: '123456-F', imobiliaria_nome: 'Imobiliária E2E', virtual: false,
  })
  await simularRpc(page, 'portal_documentos', [])
  await simularRpc(page, 'portal_contratos', [])
  await page.route('**/rest/v1/cliente_negocios**', (r) => responderRest(r, [{
    id: 'n1', cliente_id: cliente, empreendimento_id: empreendimentoTeste.id, valor: 280000, descricao: null, created_at: '2026-09-01',
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
  await expect(page.getByText('Carla Corretora')).toBeVisible()
  expect(cpfEnviado).toBe('529.982.247-25')
  expect(meusDados.length).toBeGreaterThan(0)
  expect(leiturasClientes).toEqual([])
})

test('CPF inválido nem chega ao servidor', async ({ page }) => {
  await isolarSupabase(page)
  let chamou = false
  await page.route('**/functions/v1/cliente-login', (r) => { chamou = true; return r.fulfill({ status: 500 }) })
  await page.goto('/portal-do-cliente')
  await page.getByLabel('CPF').fill('22222222222')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('CPF inválido')).toBeVisible()
  expect(chamou).toBe(false)
  // o aviso segue a identidade da interface: tema escuro, Jost e cantos retos (src/index.css)
  const aviso = page.locator('[data-sonner-toast]').first()
  const estilo = await aviso.evaluate((el) => ({
    raio: getComputedStyle(el).borderTopLeftRadius, fonte: getComputedStyle(el).fontFamily,
    tema: el.closest('[data-sonner-toaster]')?.getAttribute('data-sonner-theme'),
  }))
  expect(estilo).toMatchObject({ raio: '0px', tema: 'dark' })
  expect(estilo.fonte).toMatch(/Jost/)
})

test('corretor da rede envia proposta para um cliente do CRM (propostas_criar com cliente_id)', async ({ page }) => {
  const id = '44444444-4444-4444-4444-444444444444'
  const cliente = 'd4444444-4444-4444-8444-444444444444'
  await isolarSupabase(page)
  await entrarComo(page, id, 'corretor@e2e.com', 'corretor', { nome: 'Corretora E2E' })
  await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, [empreendimentoTeste]))
  // o seletor pede só as disponíveis do empreendimento (a RPC propostas_criar confere de novo)
  const consultasUnidades: string[] = []
  await page.route('**/rest/v1/unidades**', (r) => {
    consultasUnidades.push(r.request().url())
    return responderRest(r, [{ id: 'u12', identificador: 'APTO 12', metragem: 45, valor: 400000 }, { id: 'u14', identificador: 'APTO 14', metragem: null, valor: null }])
  })
  // a tela antiga lia e gravava direto em propostas e parceiro_clientes: o modelo novo passa só pelas RPCs
  const diretas: string[] = []
  await page.route(/\/rest\/v1\/(propostas|parceiro_clientes|clientes)(\?|$)/, (r) => { diretas.push(r.request().url()); return responderRest(r, []) })
  const opcoes = await simularRpc(page, 'crm_clientes_opcoes', [
    { id: cliente, nome: 'Maria Compradora', etapa: 'contato_iniciado', corretor_nome: 'Corretora E2E' },
  ])
  const propostas: Record<string, unknown>[] = []
  await simularRpc(page, 'propostas_listar', () => ({ total: propostas.length, itens: propostas }))
  const criadas = await simularRpc(page, 'propostas_criar', (a) => {
    propostas.unshift({
      id: 'f4444444-4444-4444-8444-000000000001', empreendimento: { id: a.p_empreendimento_id, nome: 'Residencial E2E' },
      unidade: a.p_unidade_id ? { id: a.p_unidade_id, identificador: 'APTO 12' } : null,
      cliente: { id: cliente, nome: 'Maria Compradora' }, autor: { id, nome: 'Corretora E2E' }, texto: a.p_texto,
      status: 'enviada', resposta_admin: null, criado_em: new Date().toISOString(), atualizado_em: null, pode_responder: false,
      imobiliaria: { id: '99999999-0000-4000-8000-0000000000b1', nome: 'Imobiliária E2E' }, gerente: null, corretor: { id, nome: 'Corretora E2E' },
    })
    return 'f4444444-4444-4444-8444-000000000001'
  })

  await page.goto('/parceiros/painel/propostas')
  await expect(page.getByRole('heading', { name: 'Olá, Corretora' })).toBeVisible()
  await expect(page.getByText('Nenhuma proposta enviada')).toBeVisible()
  // a unidade só aparece depois de escolher o empreendimento
  await expect(page.getByLabel('Unidade (opcional)')).toHaveCount(0)
  await page.getByLabel('Empreendimento').selectOption({ label: 'Residencial E2E' })
  const unidade = page.getByLabel('Unidade (opcional)')
  await expect(unidade.locator('option', { hasText: /^APTO 12 · 45 m² · R\$\s400\.000$/ })).toHaveCount(1)
  await expect(unidade.locator('option', { hasText: /^APTO 14$/ })).toHaveCount(1)
  await expect(unidade).toHaveValue('')
  await unidade.selectOption('u12')
  await page.getByRole('combobox', { name: 'Cliente (opcional)' }).fill('Maria')
  await page.getByRole('option', { name: /Maria Compradora/ }).click()
  await page.getByLabel('Proposta').fill('APTO 12, entrada de 10% + FGTS, financiamento Caixa.')
  await page.getByRole('button', { name: 'Enviar proposta' }).click()
  await expect(page.getByText('Proposta enviada!')).toBeVisible()
  await expect(page.locator('li', { hasText: 'Residencial E2E · APTO 12' }).getByText('Enviada')).toBeVisible()
  expect(opcoes.length).toBeGreaterThan(0)
  // só as escolhas vão ao servidor: o autor e a cadeia saem do JWT, nunca do navegador
  expect(criadas).toEqual([{
    p_empreendimento_id: empreendimentoTeste.id, p_cliente_id: cliente, p_unidade_id: 'u12',
    p_texto: 'APTO 12, entrada de 10% + FGTS, financiamento Caixa.',
  }])
  expect(diretas).toEqual([])
  expect(consultasUnidades.length).toBeGreaterThan(0)
  for (const url of consultasUnidades) {
    const q = new URL(url).searchParams
    expect(q.get('status')).toBe('eq.disponivel')
    expect(q.get('empreendimento_id')).toBe(`eq.${empreendimentoTeste.id}`)
  }
})

import { expect as expectBase, test, type Page } from '@playwright/test'
import { responderRest, simularRpc, simularTurnstile } from './apoio'

// Com vários servidores de desenvolvimento em paralelo, a primeira carga do painel (chunks lazy, compilados sob demanda pelo
// Vite) passa dos 5 s padrão: os testes deste arquivo rodam em sequência num só worker (o primeiro aquece o servidor) e
// esperam mais.
const expect = expectBase.configure({ timeout: 30_000 })
test.describe.configure({ mode: 'default', timeout: 120_000 })

// Pré-cadastro público pelo link de indicação [WP2, §6.1]: Turnstile, termo com aceite obrigatório e a MESMA resposta
// para cadastro criado e duplicado. Rede simulada: nada chega ao Supabase real nem à Cloudflare.

const TERMO = {
  id: 'e2e00000-0000-4000-8000-00000000c002', tipo: 'consentimento_cliente', versao: '1-revisada',
  texto: 'Termo de consentimento revisado pelo jurídico.', vigente_desde: '2026-09-01T00:00:00Z', revisado_juridico: true,
}
const LINK = { nome_corretor: 'Ana Corretora', nome_imobiliaria: 'Imobiliária Parceira' }
const SUCESSO = 'Obrigado! Em breve Ana Corretora vai entrar em contato com você.'

async function redeFechada(page: Page) {
  await page.route(/\/rest\/v1\/rpc\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'não simulado', details: null, hint: null }) }))
  await page.route(/\/rest\/v1\/(?!rpc\/)/, (r) => responderRest(r, []))
  await page.route(/\/functions\/v1\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"erro":"não simulado"}' }))
}

/** Edge pre-cadastro simulada: guarda os corpos e responde com o status/corpo dados. */
async function simularEdge(page: Page, status = 200, corpo: unknown = { ok: true }) {
  const pedidos: Record<string, unknown>[] = []
  await page.route('**/functions/v1/pre-cadastro', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204 })
    pedidos.push(r.request().postDataJSON() as Record<string, unknown>)
    return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) })
  })
  return pedidos
}

async function preencher(page: Page, cpf = '52998224725') {
  await page.getByLabel(/^Nome/).fill('  Joana ')
  await page.getByLabel('Sobrenome').fill('Lima')
  await page.getByLabel('CPF').fill(cpf)
  await page.getByLabel('Telefone / WhatsApp').fill('11966665555')
  await page.getByLabel('E-mail').fill('JOANA@Exemplo.com')
}

for (const caso of ['cadastro novo', 'CPF já cadastrado'] as const) {
  test(`pré-cadastro com Turnstile e termo: ${caso} tem a mesma resposta`, async ({ page }) => {
    await redeFechada(page)
    await simularTurnstile(page)
    const links = await simularRpc(page, 'rede_link_publico', LINK)
    await simularRpc(page, 'lgpd_termo_vigente', TERMO)
    // a Edge responde 200 {ok:true} nos dois casos (criado e duplicado): é isso que a tela recebe
    const pedidos = await simularEdge(page)

    await page.goto('/pre-cadastro/cliente/LinkCaUmAa')
    await expect(page.getByText('Indicado por')).toContainText('Ana Corretora · Imobiliária Parceira')
    await expect(page.getByText('Termo de consentimento revisado pelo jurídico.')).toBeVisible()
    await preencher(page, caso === 'cadastro novo' ? '52998224725' : '12345670916')

    await page.getByRole('button', { name: 'Enviar pré-cadastro' }).click()
    await expect(page.getByText('Para continuar, aceite o termo')).toBeVisible()
    expect(pedidos).toHaveLength(0)

    await page.getByRole('checkbox', { name: /Li e aceito/ }).check()
    await page.getByRole('button', { name: 'Enviar pré-cadastro' }).click()
    await expect(page.getByRole('heading', { name: 'Recebemos seus dados' })).toBeVisible()
    await expect(page.getByText(SUCESSO)).toBeVisible()

    expect(links[0]).toEqual({ p_codigo: 'linkcaumaa' })
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]).toEqual({
      codigo: 'linkcaumaa', termo_id: TERMO.id, captcha: 'token-e2e', tipo_pessoa: 'fisica', nome: 'Joana', sobrenome: 'Lima',
      documento: caso === 'cadastro novo' ? '52998224725' : '12345670916', email: 'joana@exemplo.com', telefone: '11966665555',
    })
  })
}

test('sem termo revisado pelo jurídico, o formulário não abre (H4)', async ({ page }) => {
  await redeFechada(page)
  await simularRpc(page, 'rede_link_publico', LINK)
  await simularRpc(page, 'lgpd_termo_vigente', { ...TERMO, revisado_juridico: false })
  await page.goto('/pre-cadastro/cliente/linkcaumaa')
  await expect(page.getByRole('heading', { name: 'Pré-cadastro indisponível' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar pré-cadastro' })).toHaveCount(0)
})

test('link inexistente ou desativado', async ({ page }) => {
  await redeFechada(page)
  await simularRpc(page, 'rede_link_publico', null)
  await simularRpc(page, 'lgpd_termo_vigente', TERMO)
  await page.goto('/pre-cadastro/cliente/zzzzzzzzzz')
  await expect(page.getByRole('heading', { name: 'Link inválido' })).toBeVisible()
})

test('código fora do formato nem consulta o servidor', async ({ page }) => {
  await redeFechada(page)
  const links = await simularRpc(page, 'rede_link_publico', LINK)
  await page.goto('/pre-cadastro/cliente/abc%3Cscript%3E')
  await expect(page.getByRole('heading', { name: 'Link inválido' })).toBeVisible()
  expect(links).toHaveLength(0)
})

test('CPF inválido não chega à Edge; limite por IP mostra a mensagem do servidor', async ({ page }) => {
  await redeFechada(page)
  await simularTurnstile(page)
  await simularRpc(page, 'rede_link_publico', LINK)
  await simularRpc(page, 'lgpd_termo_vigente', TERMO)
  const pedidos = await simularEdge(page, 429, { erro: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.', codigo: 'muitas_tentativas' })

  await page.goto('/pre-cadastro/cliente/linkcaumaa')
  await preencher(page, '12345678900')
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check()
  await page.getByRole('button', { name: 'Enviar pré-cadastro' }).click()
  await expect(page.getByText('CPF inválido')).toBeVisible()
  expect(pedidos).toHaveLength(0)

  await page.getByLabel('CPF').fill('52998224725')
  await page.getByRole('button', { name: 'Enviar pré-cadastro' }).click()
  await expect(page.getByRole('alert')).toHaveText('Muitas tentativas. Aguarde 15 minutos e tente de novo.')
  await expect(page.getByRole('heading', { name: 'Recebemos seus dados' })).toHaveCount(0)
  expect(pedidos).toHaveLength(1)
})

test('página do pré-cadastro não é indexada', async ({ page }) => {
  await redeFechada(page)
  await simularRpc(page, 'rede_link_publico', LINK)
  await simularRpc(page, 'lgpd_termo_vigente', TERMO)
  await page.goto('/pre-cadastro/cliente/linkcaumaa')
  await expect(page).toHaveTitle('Pré-cadastro — Arken Incorporadora')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
})

test('termo trocado com a página aberta: 409 relê o termo vigente e pede o aceite de novo', async ({ page }) => {
  await redeFechada(page)
  await simularTurnstile(page)
  await simularRpc(page, 'rede_link_publico', LINK)
  const TERMO_NOVO = { ...TERMO, id: 'e2e00000-0000-4000-8000-00000000c003', versao: '2-revisada', texto: 'Nova versão do termo, revisada pelo jurídico.' }
  let termoPublicado = false
  const leituras = await simularRpc(page, 'lgpd_termo_vigente', () => (termoPublicado ? TERMO_NOVO : TERMO))
  const pedidos: Record<string, unknown>[] = []
  await page.route('**/functions/v1/pre-cadastro', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204 })
    const corpo = r.request().postDataJSON() as Record<string, unknown>
    pedidos.push(corpo)
    if (corpo.termo_id !== TERMO_NOVO.id) {
      termoPublicado = true
      return r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ erro: 'O termo de consentimento foi atualizado. Leia a nova versão e aceite para continuar.', codigo: 'termo_desatualizado' }) })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })

  await page.goto('/pre-cadastro/cliente/linkcaumaa')
  await preencher(page)
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check()
  await page.getByRole('button', { name: 'Enviar pré-cadastro' }).click()
  await expect(page.getByRole('alert')).toHaveText('O termo de consentimento foi atualizado. Leia a nova versão e aceite para continuar.')
  await expect(page.getByText('Nova versão do termo, revisada pelo jurídico.')).toBeVisible()
  await expect(page.getByText('Termo de consentimento (versão 2-revisada)')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Li e aceito/ })).not.toBeChecked()
  expect(leituras.length).toBeGreaterThanOrEqual(2)
  // os dados digitados continuam; sem o novo aceite, nada é enviado
  await expect(page.getByLabel('CPF')).toHaveValue('529.982.247-25')
  await page.getByRole('button', { name: 'Enviar pré-cadastro' }).click()
  await expect(page.getByText('Para continuar, aceite o termo')).toBeVisible()
  expect(pedidos).toHaveLength(1)

  await page.getByRole('checkbox', { name: /Li e aceito/ }).check()
  await page.getByRole('button', { name: 'Enviar pré-cadastro' }).click()
  await expect(page.getByRole('heading', { name: 'Recebemos seus dados' })).toBeVisible()
  expect(pedidos.map((p) => p.termo_id)).toEqual([TERMO.id, TERMO_NOVO.id])
})

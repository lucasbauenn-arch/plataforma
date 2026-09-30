import { expect as expectBase, test, type Page } from '@playwright/test'
import { empreendimentoTeste, entrarComo, responderRest, simularRpc } from './apoio'

// Robustez do front (FUX-02, FUX-03, FUX-04, FUX-05 e WP7RN-02 da revisão final do WP7): falha de chunk depois de um
// deploy, consultas que falham sem derrubar a tela, painel inicial do parceiro com vazio e erro, portal do cliente sem
// informação falsa e o temporizador de inatividade (H1) também no portal. Rede do Supabase simulada.

test.describe.configure({ timeout: 120_000 })
const expect = expectBase.configure({ timeout: 40_000 })

const CORRETOR = 'e7200000-0000-4000-8000-0000000000c1'
const TITULAR = 'e7200000-0000-4000-8000-0000000000c2'
const CLIENTE = 'e7200000-0000-4000-8000-000000000001'
const CHAVE_ATIVIDADE = (id: string) => `arken:atividade:${id}`
const HORA = 3_600_000

/** Nenhuma requisição sai para o Supabase real (rotas específicas registradas depois têm precedência). */
async function isolarRede(page: Page) {
  await page.route('**/rest/v1/**', (r) => r.request().method() === 'GET'
    ? responderRest(r, [])
    : r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'não simulado', details: null, hint: null }) }))
  await page.route('**/storage/v1/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"não simulado"}' }))
  await page.route('**/functions/v1/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"erro":"não simulado"}' }))
  await page.route('**/auth/v1/logout**', (r) => r.fulfill({ status: 204 }))
}

const erroRest = (status: number, code: string, message: string) => ({ status, contentType: 'application/json', body: JSON.stringify({ code, message, details: null, hint: null }) })

/** Última atividade guardada (localStorage) `haMs` atrás: o vigia de inatividade lê ao montar. */
const atividadeHa = (page: Page, id: string, haMs: number) =>
  page.addInitScript(([k, v]) => localStorage.setItem(k, v), [CHAVE_ATIVIDADE(id), String(Date.now() - haMs)])

// ============ FUX-02: falha de carregar uma tela ============

test('tela que não carrega (chunk antigo depois do deploy): mensagem com Recarregar em vez da tela escura, e voltar recupera', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Carla Corretora' })
  await page.goto('/parceiros/painel')
  await expect(page.getByRole('heading', { name: 'Olá, Carla' })).toBeVisible()

  // o servidor devolve a página inicial no lugar do JavaScript (com hash antigo): o import() dinâmico falha
  await page.route('**/src/modulos/crm/paginas/Lista.tsx*', (r) => r.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>404</title>' }))
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Clientes' }).click()
  await expect(page.getByRole('heading', { name: 'Não foi possível abrir esta tela' })).toBeVisible()
  await expect(page.getByText('O sistema foi atualizado enquanto você o usava. Recarregue a página para continuar.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recarregar a página' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ir para o início' })).toHaveAttribute('href', '/')

  // trocar de rota tira a tela de falha (o resto do app continua de pé)
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Olá, Carla' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Não foi possível abrir esta tela' })).toHaveCount(0)
})

test('exceção ao desenhar uma tela: a barreira mostra a mensagem geral, com Recarregar', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Carla Corretora' })
  await page.goto('/parceiros/painel')
  await expect(page.getByRole('heading', { name: 'Olá, Carla' })).toBeVisible()
  // módulo que carrega mas lança ao desenhar
  await page.route('**/src/modulos/crm/paginas/Lista.tsx*', (r) => r.fulfill({
    status: 200, contentType: 'text/javascript', body: 'export default function Lista() { throw new Error("falha ao desenhar") }',
  }))
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Clientes' }).click()
  await expect(page.getByRole('heading', { name: 'Não foi possível abrir esta tela' })).toBeVisible()
  await expect(page.getByText('Ocorreu um erro inesperado. Recarregue a página; se o problema continuar, fale com a equipe Arken.')).toBeVisible()
  const [carregou] = await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Recarregar a página' }).click()])
  expect(carregou).toBeTruthy()
})

test('vite:preloadError recarrega a página UMA vez; a segunda falha em seguida vira a tela de falha (sem laço de recargas)', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Carla Corretora' })
  await page.goto('/parceiros/painel')
  await expect(page.getByRole('heading', { name: 'Olá, Carla' })).toBeVisible()
  await page.evaluate(() => { (window as unknown as { marca: number }).marca = 1 })

  const recarregou = page.waitForEvent('load')
  await page.evaluate(() => { window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })) }).catch(() => {})
  await recarregou
  await expect(page.getByRole('heading', { name: 'Olá, Carla' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { marca?: number }).marca)).toBeUndefined() // página nova
  expect(await page.evaluate(() => sessionStorage.getItem('arken:recarga-modulo'))).not.toBeNull()

  // logo depois: não cancela o evento (o erro segue) e não recarrega
  await page.evaluate(() => { (window as unknown as { marca: number }).marca = 2 })
  const naoCancelado = await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })))
  expect(naoCancelado).toBe(true)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as unknown as { marca?: number }).marca)).toBe(2)
})

// ============ FUX-04: tela inicial do parceiro ============

const empreendimentoAtivo = { ...empreendimentoTeste, endereco: 'Rua das Flores, 100', categoria: 'Residencial', total_unidades: 40 }

test('painel do parceiro sem empreendimento: título e estado vazio (não a tela em branco)', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Carla Corretora' })
  await page.goto('/parceiros/painel')
  await expect(page.getByRole('heading', { name: 'Empreendimentos', level: 2 })).toBeVisible()
  await expect(page.getByText('Nenhum empreendimento disponível no momento')).toBeVisible()
})

test('painel do parceiro com falha na leitura: erro traduzido e "Tentar de novo" que recupera', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Carla Corretora' })
  await page.route('**/rest/v1/empreendimentos**', (r) => r.fulfill(erroRest(500, 'XX000', 'falha simulada')))
  await page.goto('/parceiros/painel')
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
  await expect(page.getByText('Nenhum empreendimento disponível no momento')).toHaveCount(0)

  await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, [empreendimentoAtivo]))
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByRole('button', { name: /Residencial E2E/ })).toBeVisible()
})

test('tabela do empreendimento é um diálogo de verdade (foco preso, Esc fecha) e erro de unidades não vira "nenhuma unidade"', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Carla Corretora' })
  await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, [empreendimentoAtivo]))
  await page.route('**/rest/v1/unidades**', (r) => r.fulfill(erroRest(500, 'XX000', 'falha simulada')))
  await page.route('**/rest/v1/empreendimento_materiais**', (r) => r.fulfill(erroRest(500, 'XX000', 'falha simulada')))
  await page.goto('/parceiros/painel')
  await page.getByRole('button', { name: /Residencial E2E/ }).click()

  const dialogo = page.getByRole('dialog', { name: 'Residencial E2E' })
  await expect(dialogo).toBeVisible()
  await expect(dialogo.getByRole('button', { name: 'Tentar de novo' }).first()).toBeVisible()
  await expect(dialogo.getByText('Nenhuma unidade cadastrada')).toHaveCount(0)

  // o foco fica dentro do diálogo, por mais que se aperte Tab
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialogo).not.toBeVisible()
})

test('tabela do empreendimento com unidades: filtro Disponíveis/Todas e materiais', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Carla Corretora' })
  await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, [empreendimentoAtivo]))
  await page.route('**/rest/v1/unidades**', (r) => responderRest(r, [
    { id: 'u1', empreendimento_id: empreendimentoTeste.id, identificador: 'APTO 01', metragem: 50, valor: 300000, status: 'disponivel' },
    { id: 'u2', empreendimento_id: empreendimentoTeste.id, identificador: 'APTO 02', metragem: 52, valor: 310000, status: 'vendida' },
  ]))
  await page.route('**/rest/v1/empreendimento_materiais**', (r) => responderRest(r, [{ drive_url: 'https://drive.e2e.test/pasta', observacoes: null }]))
  await page.goto('/parceiros/painel')
  await page.getByRole('button', { name: /Residencial E2E/ }).click()
  const dialogo = page.getByRole('dialog', { name: 'Residencial E2E' })
  await expect(dialogo.getByRole('cell', { name: 'APTO 01' })).toBeVisible()
  await expect(dialogo.getByRole('cell', { name: 'APTO 02' })).toHaveCount(0)
  await dialogo.getByRole('button', { name: 'Todas' }).click()
  await expect(dialogo.getByRole('cell', { name: 'APTO 02' })).toBeVisible()
  await expect(dialogo.getByRole('link', { name: 'Baixar materiais' })).toHaveAttribute('href', 'https://drive.e2e.test/pasta')
})

// ============ FUX-03 e FUX-05: portal do cliente ============

const MEUS_DADOS = {
  id: CLIENTE, nome: 'Maria', sobrenome: 'Portal', cpf: '52998224725', email: 'maria@e2e.test', telefone: '11900000001',
  cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null,
}
const NEGOCIO = {
  id: 'n1', cliente_id: CLIENTE, empreendimento_id: empreendimentoTeste.id, unidade_id: null, valor: 280000, descricao: null, created_at: '2026-09-01',
  empreendimentos: { nome: 'Residencial E2E', slug: 'residencial-e2e', capa_url: null }, unidades: { identificador: 'APTO 12', metragem: 45 },
}
const ARQUIVO = { id: 'arq1', cliente_id: CLIENTE, nome: 'Manual do proprietário.pdf', storage_path: `${CLIENTE}/manual.pdf`, created_at: '2026-09-02' }
const OBRA = { id: 'o1', empreendimento_id: empreendimentoTeste.id, percentual: 35, titulo: 'Estrutura', descricao: null, fotos: [], data: '2026-09-10' }

/** Titular logado no portal (cada consulta pode ser trocada depois: a rota registrada por último vale). */
async function abrirPortal(page: Page, extra: { horas?: number } = {}) {
  await isolarRede(page)
  await entrarComo(page, TITULAR, `cliente-${CLIENTE}@portal.arkenincorporadora.com.br`, 'cliente', {
    nome: 'Maria Portal', extra: extra.horas ? { sessao_inatividade_horas: extra.horas } : undefined,
  })
  await page.route('**/rest/v1/cliente_negocios**', (r) => responderRest(r, [NEGOCIO]))
  await page.route('**/rest/v1/cliente_arquivos**', (r) => responderRest(r, [ARQUIVO]))
  await page.route('**/rest/v1/obra_atualizacoes**', (r) => responderRest(r, [OBRA]))
  await simularRpc(page, 'portal_meus_dados', MEUS_DADOS)
  await simularRpc(page, 'portal_meu_corretor', { nome: 'Carla Corretora', telefone: '11988887777', email: 'carla@e2e.test', creci: '123456-F', imobiliaria_nome: 'Imobiliária E2E', virtual: false })
  await simularRpc(page, 'portal_documentos', [])
  await simularRpc(page, 'portal_contratos', [])
}

test('portal: falha em "Andamento da obra" (ex.: sessão vencida) só avisa aquela seção, e "Tentar de novo" recupera', async ({ page }) => {
  await abrirPortal(page)
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))
  await page.route('**/rest/v1/obra_atualizacoes**', (r) => r.fulfill(erroRest(401, 'PGRST303', 'JWT expired')))
  await page.goto('/portal-do-cliente/meus-imoveis')
  await expect(page.getByRole('heading', { name: 'Bem-vindo(a), Maria' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Residencial E2E' })).toBeVisible()
  await expect(page.getByText('Manual do proprietário.pdf')).toBeVisible()
  await expect(page.getByText('Sua sessão expirou. Entre novamente.')).toBeVisible()

  await page.route('**/rest/v1/obra_atualizacoes**', (r) => responderRest(r, [OBRA]))
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByText('35%')).toBeVisible()
  expect(erros).toEqual([])
})

test('portal: falha ao ler imóveis e arquivos mostra o erro, nunca "Nenhum imóvel vinculado" nem "Nenhum arquivo"', async ({ page }) => {
  await abrirPortal(page)
  await page.route('**/rest/v1/cliente_negocios**', (r) => r.fulfill(erroRest(500, 'XX000', 'falha simulada')))
  await page.route('**/rest/v1/cliente_arquivos**', (r) => r.fulfill(erroRest(500, 'XX000', 'falha simulada')))
  await page.goto('/portal-do-cliente/meus-imoveis')
  await expect(page.getByRole('heading', { name: 'Bem-vindo(a), Maria' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toHaveCount(2)
  await expect(page.getByText('Nenhum imóvel vinculado ainda')).toHaveCount(0)
  await expect(page.getByText('Nenhum arquivo disponível.')).toHaveCount(0)

  // recuperando uma das duas, a outra continua com o aviso
  await page.route('**/rest/v1/cliente_arquivos**', (r) => responderRest(r, [ARQUIVO]))
  await page.getByRole('button', { name: 'Tentar de novo' }).last().click()
  await expect(page.getByText('Manual do proprietário.pdf')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toHaveCount(1)
})

test('portal: baixar arquivo abre a janela no clique (antes do await); falha ao gerar o link avisa e fecha a janela', async ({ page }) => {
  await abrirPortal(page)
  await page.route('**/storage/v1/object/sign/cliente-arquivos/**', (r) => r.fulfill(erroRest(400, '', 'Object not found')))
  await page.goto('/portal-do-cliente/meus-imoveis')
  await expect(page.getByText('Manual do proprietário.pdf')).toBeVisible()
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Baixar Manual do proprietário.pdf' }).click()
  const janela = await popup // a janela existe: foi aberta dentro do gesto do clique
  await expect(page.getByText('Não foi possível concluir a operação. Tente de novo.')).toBeVisible()
  await expect.poll(() => janela.isClosed()).toBe(true) // e é fechada, para não sobrar aba em branco
})

test('portal: baixar arquivo com sucesso leva a janela para a URL assinada', async ({ page }) => {
  await abrirPortal(page)
  // o pedido do link sai da página; a janela aberta (popup) não herda as rotas da página, então a URL assinada é
  // servida pelo contexto (nada chega ao Supabase real)
  await page.route('**/storage/v1/object/sign/cliente-arquivos/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/object/sign/cliente-arquivos/x.pdf?token=t' }),
  }))
  await page.context().route('**/storage/v1/object/sign/cliente-arquivos/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: 'arquivo do cliente (e2e)' }))
  await page.goto('/portal-do-cliente/meus-imoveis')
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Baixar Manual do proprietário.pdf' }).click()
  const janela = await popup
  await expect(janela.locator('body')).toContainText('arquivo do cliente (e2e)')
})

// ============ WP7RN-02: inatividade (H1) também no portal ============

test('portal: sessão sem uso há mais de 8 h é encerrada (login só por CPF é o mais fraco)', async ({ page }) => {
  await abrirPortal(page)
  await atividadeHa(page, TITULAR, 9 * HORA)
  await page.goto('/portal-do-cliente/meus-imoveis')
  await expect(page.getByText('Sessão encerrada por inatividade. Entre novamente.')).toBeVisible()
  await expect(page).toHaveURL(/\/portal-do-cliente$/)
  await expect(page.getByRole('heading', { name: 'Acesse sua conta' })).toBeVisible()
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sb-')))).toEqual([]) // sessão local apagada
})

test('portal: usa o tempo configurado (sessao_inatividade_horas do escopo): 1 h configurada, 2 h parado = encerra', async ({ page }) => {
  await abrirPortal(page, { horas: 1 })
  await atividadeHa(page, TITULAR, 2 * HORA)
  await page.goto('/portal-do-cliente/meus-imoveis')
  await expect(page.getByText('Sessão encerrada por inatividade. Entre novamente.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Acesse sua conta' })).toBeVisible()
})

test('portal: uso recente mantém a sessão (o vigia não derruba quem está usando)', async ({ page }) => {
  await abrirPortal(page)
  await atividadeHa(page, TITULAR, 60_000)
  await page.goto('/portal-do-cliente/meus-imoveis')
  await expect(page.getByRole('heading', { name: 'Bem-vindo(a), Maria' })).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page.getByRole('heading', { name: 'Bem-vindo(a), Maria' })).toBeVisible()
  await expect(page.getByText('Sessão encerrada por inatividade. Entre novamente.')).toHaveCount(0)
})

test('painel do parceiro: sessão sem uso há mais de 8 h é encerrada e volta para o login', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Carla Corretora' })
  await atividadeHa(page, CORRETOR, 9 * HORA)
  await page.goto('/parceiros/painel')
  await expect(page.getByText('Sessão encerrada por inatividade. Entre novamente.')).toBeVisible()
  await expect(page).toHaveURL(/\/parceiros$/)
})

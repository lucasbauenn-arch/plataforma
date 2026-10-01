import { expect as expectBase, test } from '@playwright/test'
import { empreendimentoTeste, isolarSupabase, responderRest } from './apoio'

// Site público: seção "Sobre a Arken" da home e o portfólio (todo empreendimento publicado, sem depender de
// mostrar_no_portfolio nem do estágio). Rede do Supabase simulada (e2e/apoio.ts).
test.describe.configure({ timeout: 90_000 })
const expect = expectBase.configure({ timeout: 30_000 })

const publicados = [
  { ...empreendimentoTeste, id: '11111111-1111-4111-8111-000000000001', slug: 'lancamento-e2e', nome: 'Lançamento E2E', estagio: 'lancamento', mostrar_no_portfolio: false },
  { ...empreendimentoTeste, id: '11111111-1111-4111-8111-000000000002', slug: 'obra-e2e', nome: 'Obra E2E', estagio: 'em_construcao', mostrar_no_portfolio: false, destaque_home: false },
  { ...empreendimentoTeste, id: '11111111-1111-4111-8111-000000000003', slug: 'entregue-e2e', nome: 'Entregue E2E', estagio: 'portfolio', mostrar_no_portfolio: true, destaque_home: false },
]

test('home: seção Sobre a Arken com o texto novo, três frentes e o link para a empresa', async ({ page }) => {
  await isolarSupabase(page)
  await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, publicados))
  await page.goto('/')
  const secao = page.locator('section', { has: page.getByRole('heading', { name: 'Do terreno à entrega das chaves.' }) })
  await expect(secao.getByText('Sobre a Arken', { exact: true })).toBeVisible()
  await expect(secao.getByText(/da análise e aquisição do terreno à concepção, incorporação, construção e entrega\.$/)).toBeVisible()
  for (const titulo of ['Desenvolvimento imobiliário', 'Incorporação', 'Construção e entrega']) {
    await expect(secao.getByText(titulo, { exact: true })).toBeVisible()
  }
  await expect(secao.getByText(/Identificamos oportunidades, analisamos terrenos/)).toBeVisible()
  await expect(secao.getByText(/da concepção ao lançamento, integrando planejamento/)).toBeVisible()
  await expect(secao.getByText(/compromisso com a entrega\.$/)).toBeVisible()
  await expect(page.getByText('Da concepção do projeto à entrega das chaves.')).toHaveCount(0)
  await expect(secao.getByRole('link', { name: /Conheça a empresa/ })).toHaveAttribute('href', '/quem-somos')
})

test('portfólio: mostra todo empreendimento publicado, em qualquer estágio, com link para a página', async ({ page }) => {
  await isolarSupabase(page)
  let consulta = ''
  await page.route('**/rest/v1/empreendimentos**', (r) => { consulta = r.request().url(); return responderRest(r, publicados) })
  await page.goto('/portfolio')
  const lista = page.getByTestId('portfolio-lista')
  for (const e of publicados) {
    await expect(lista.getByRole('link', { name: new RegExp(e.nome) })).toHaveAttribute('href', `/empreendimentos/${e.slug}`)
  }
  await expect(lista.getByText('Lançamento', { exact: true })).toBeVisible()
  await expect(lista.getByText('Em construção', { exact: true })).toBeVisible()
  // só os publicados vêm do servidor; mostrar_no_portfolio não entra no filtro
  const q = new URL(consulta).searchParams
  expect(q.get('publicado')).toBe('eq.true')
  expect(q.has('mostrar_no_portfolio')).toBe(false)
})

test('portfólio: falha na consulta vira erro, não "em atualização"', async ({ page }) => {
  await isolarSupabase(page)
  await page.route('**/rest/v1/empreendimentos**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'falha simulada' }) }))
  await page.goto('/portfolio')
  await expect(page.getByText('Não foi possível carregar os dados.')).toBeVisible()
  await expect(page.getByText('Portfólio em atualização')).toHaveCount(0)
})

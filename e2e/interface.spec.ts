import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect as expectBase, test, type Page } from '@playwright/test'
import { empreendimentoTeste, entrarComo, erroRpc, isolarSupabase, responderPagina, responderRest, simularRpc, simularTurnstile } from './apoio'

// Interface (FUX-07 a FUX-10 e FUX-12 da revisão final do WP7): sem estouro de largura no celular, lista vazia sempre
// visível, busca sem o "×" duplicado, cores dentro dos tokens (com contraste) e a tela de Pendências da migração
// (lista, filtros na URL do PostgREST, paginação, resolução com decisão e erro do servidor). Rede simulada.

test.describe.configure({ timeout: 120_000 })
const expect = expectBase.configure({ timeout: 40_000 })

const SUPER = 'e7300000-0000-4000-8000-0000000000a1'
const ADMIN = 'e7300000-0000-4000-8000-0000000000a2'
const OUTRO = 'e7300000-0000-4000-8000-0000000000a3'

// ============ regras de estilo do CLAUDE.md, conferidas no código ============

function arquivos(dir: string, acumulado: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivos(caminho, acumulado)
    else if (/\.tsx$/.test(nome) && !/\.test\./.test(nome)) acumulado.push(caminho)
  }
  return acumulado
}

test('código: nenhum rounded-*, bg-white nem cor solta em classe (tokens do tema, cantos retos)', () => {
  const problemas: string[] = []
  for (const arq of arquivos(join(process.cwd(), 'src'))) {
    // ícones de marca (Instagram e YouTube) são a única exceção de cantos: `rx` do próprio desenho
    const permiteRx = arq.endsWith('IconesSociais.tsx')
    readFileSync(arq, 'utf8').split(/\r?\n/).forEach((linha, i) => {
      const onde = `${arq.replace(process.cwd(), '').replace(/\\/g, '/')}:${i + 1}`
      if (/\brounded(-[a-z0-9]+)?\b/.test(linha)) problemas.push(`${onde} rounded`)
      if (/border-radius/.test(linha)) problemas.push(`${onde} border-radius`)
      if (!permiteRx && /\brx=/.test(linha)) problemas.push(`${onde} rx`)
      if (/(?<!hover:)\bbg-white\b/.test(linha)) problemas.push(`${onde} bg-white`)
      if (/\b(?:bg|text|border|fill|stroke|from|to|via|ring|outline)-\[#[0-9a-fA-F]{3,8}\]/.test(linha)) problemas.push(`${onde} cor solta`)
      if (/['"`]#[0-9a-fA-F]{6}['"`]/.test(linha) && !/Logo\.tsx$/.test(arq) && !/imagem\.ts/.test(arq)) problemas.push(`${onde} hex solto`)
    })
  }
  expect(problemas).toEqual([])
})

// ============ FUX-07 e FUX-08: celular (375 px) ============

test.describe('celular (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('Configurações > Equipe não estica a página na horizontal (rótulo do papel virou aria-label)', async ({ page }) => {
    await isolarSupabase(page)
    await entrarComo(page, SUPER, 'super@e2e.test', 'super', { nome: 'Sara Super' })
    await page.route('**/rest/v1/profiles**', (r) => {
      if (!r.request().url().includes('papel=in.')) return r.fallback()
      return responderRest(r, [
        { id: OUTRO, nome: 'Beto Admin com um nome bem comprido para testar', email: 'beto.admin.com.email.bem.comprido@e2e.test', papel: 'admin', status_parceiro: 'pendente', inativado_em: null },
        { id: SUPER, nome: 'Sara Super', email: 'super@e2e.test', papel: 'super', status_parceiro: 'pendente', inativado_em: null },
      ])
    })
    await page.goto('/admin/configuracoes/equipe')
    await expect(page.getByLabel('Papel de Beto Admin com um nome bem comprido para testar')).toBeAttached()
    const medidas = await page.evaluate(() => ({ rolagem: document.documentElement.scrollWidth, janela: document.documentElement.clientWidth }))
    expect(medidas.rolagem).toBeLessThanOrEqual(medidas.janela)
    // nenhum rótulo "sr-only" solto no documento (é o que escapava do recorte da tabela)
    expect(await page.locator('label.sr-only').count()).toBe(0)
  })

  test('lista vazia: a mensagem aparece dentro da tela, não perdida numa célula da tabela larga', async ({ page }) => {
    await isolarSupabase(page)
    await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
    await page.route('**/rest/v1/migracao_pendencias**', (r) => responderPagina(r, []))
    await page.goto('/admin/migracao')
    const mensagem = page.getByText('Nenhuma pendência aberta.')
    await expect(mensagem).toBeVisible()
    const caixa = (await mensagem.boundingBox())!
    expect(caixa.x).toBeGreaterThanOrEqual(0)
    expect(caixa.x + caixa.width).toBeLessThanOrEqual(375)
    const medidas = await page.evaluate(() => ({ rolagem: document.documentElement.scrollWidth, janela: document.documentElement.clientWidth }))
    expect(medidas.rolagem).toBeLessThanOrEqual(medidas.janela)
  })
})

// ============ FUX-09: busca sem o "×" duplicado ============

test('campo de busca: o "×" nativo do navegador fica oculto (só o "Limpar busca" do componente aparece)', async ({ page }) => {
  await isolarSupabase(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  await simularRpc(page, 'contratos_listar', { total: 0, itens: [] })
  await page.goto('/admin/contratos')
  const busca = page.getByLabel('Buscar contrato')
  await busca.fill('#123')
  await expect(page.getByRole('button', { name: 'Limpar busca' })).toHaveCount(1)
  await expect(busca).toHaveAttribute('type', 'search') // continua sendo uma busca para leitores de tela (searchbox)
  // getComputedStyle não enxerga o pseudo-elemento interno do navegador: compara o desenho do campo (focado, com texto)
  // como está com o mesmo campo com o "×" nativo forçado a sumir (controle) e com ele forçado a aparecer (prova de que
  // o teste enxerga a diferença). Igual ao controle = o "×" nativo já está oculto.
  const comoEsta = await busca.screenshot()
  await page.addStyleTag({ content: 'input[type=search]::-webkit-search-cancel-button { display: none !important; }' })
  const oculto = await busca.screenshot()
  expect(comoEsta.equals(oculto)).toBe(true)
  await page.addStyleTag({ content: 'input[type=search]::-webkit-search-cancel-button { display: inline-block !important; appearance: auto !important; opacity: 1 !important; }' })
  const visivel = await busca.screenshot()
  expect(visivel.equals(oculto)).toBe(false)
})

// ============ FUX-10: contraste do WhatsApp e cores dos tokens ============

test('site: botões do WhatsApp com texto escuro sobre o verde (contraste AA) e cores vindas dos tokens', async ({ page }) => {
  await isolarSupabase(page)
  await simularTurnstile(page)
  await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, [{
    ...empreendimentoTeste, chamada: null, tagline: null, titulo_hero: null, descricao: 'Descrição do empreendimento.', endereco: null,
    empreendimento_midias: [], empreendimento_lazer: [], empreendimento_proximidades: [], empreendimento_ficha: [],
  }]))
  await page.goto('/empreendimentos/residencial-e2e')
  const botoes = page.getByRole('link', { name: 'Falar no WhatsApp' })
  await expect(botoes).toHaveCount(2) // o da seção de contato e o flutuante
  const luminancia = (rgb: string) => {
    const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  for (const botao of await botoes.all()) {
    const estilo = await botao.evaluate((el) => ({ fundo: getComputedStyle(el).backgroundColor, texto: getComputedStyle(el).color }))
    expect(estilo.fundo).toMatch(/^rgb\(/)
    expect(estilo.texto).toMatch(/^rgb\(/)
    const [a, b] = [luminancia(estilo.fundo), luminancia(estilo.texto)].sort((x, y) => y - x)
    expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5)
  }
})

// ============ FUX-12: Pendências da migração ============

interface Pendencia {
  id: number; tipo: string; tabela: string; registro_id: string; relacionado_id: string | null; detalhe: string | null
  decisao: string | null; resolvido_em: string | null; resolvido_por: string | null; criado_em: string
}
const pendencia = (id: number, tipo: string, extra: Partial<Pendencia> = {}): Pendencia => ({
  id, tipo, tabela: 'clientes', registro_id: `e7300000-0000-4000-8000-00000000c0${id % 100}`, relacionado_id: null,
  detalhe: `Detalhe da pendência ${id}`, decisao: null, resolvido_em: null, resolvido_por: null, criado_em: `2026-09-2${id % 10}T10:00:00Z`, ...extra,
})

/** Lista simulada como o PostgREST: filtros da URL (`resolvido_em`, `tipo`), `count=exact` e a paginação por offset/limit. */
async function simularPendencias(page: Page, itens: Pendencia[]) {
  const consultas: URL[] = []
  await page.route('**/rest/v1/migracao_pendencias**', (r) => {
    const url = new URL(r.request().url())
    consultas.push(url)
    let lista = itens
    const abertura = url.searchParams.get('resolvido_em')
    if (abertura === 'is.null') lista = lista.filter((p) => !p.resolvido_em)
    if (abertura === 'not.is.null') lista = lista.filter((p) => p.resolvido_em)
    const tipo = url.searchParams.get('tipo')
    if (tipo?.startsWith('eq.')) lista = lista.filter((p) => p.tipo === tipo.slice(3))
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limite = Number(url.searchParams.get('limit') ?? lista.length)
    return responderPagina(r, lista.slice(offset, offset + limite), lista.length)
  })
  return consultas
}

async function abrirMigracao(page: Page, itens: Pendencia[]) {
  await isolarSupabase(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  const consultas = await simularPendencias(page, itens)
  await page.goto('/admin/migracao')
  await expect(page.getByRole('heading', { name: 'Pendências da migração' })).toBeVisible()
  return consultas
}

test('migração: abre com as pendências abertas, mais antigas primeiro, e mostra tipo e situação', async ({ page }) => {
  const consultas = await abrirMigracao(page, [
    pendencia(1, 'cpf_invalido'),
    pendencia(2, 'cpf_conflito_cliente', { relacionado_id: 'e7300000-0000-4000-8000-00000000c999' }),
    pendencia(3, 'dono_sem_vinculo', { resolvido_em: '2026-09-28T10:00:00Z', decisao: 'Vinculado à imobiliária da casa' }),
  ])
  await expect(page.getByText('2 pendência(s)')).toBeVisible()
  await expect(page.getByRole('row', { name: /CPF inválido/ })).toContainText('Aberta')
  await expect(page.getByRole('row', { name: /CPF de cliente do CRM/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /Dono sem vínculo/ })).toHaveCount(0)
  const q = consultas.at(-1)!.searchParams
  expect(q.get('resolvido_em')).toBe('is.null')
  expect(q.get('order')).toBe('criado_em.asc,id.asc')
  expect(q.get('limit')).toBe('50')
  expect(q.get('offset')).toBe('0')
  // o corte não grava dado pessoal na pendência: o registro é aberto pelo link
  await expect(page.getByRole('link', { name: 'Ficha do cliente' }).first()).toHaveAttribute('href', /\/admin\/crm\/e7300000-/)
})

test('migração: filtros de situação e tipo vão para a consulta e a página volta ao início', async ({ page }) => {
  const consultas = await abrirMigracao(page, [
    pendencia(1, 'cpf_invalido'),
    pendencia(2, 'dono_sem_vinculo'),
    pendencia(3, 'dono_sem_vinculo', { resolvido_em: '2026-09-28T10:00:00Z', decisao: 'Vinculado' }),
  ])
  await page.getByLabel('Situação').selectOption('resolvidas')
  await expect(page.getByRole('row', { name: /Dono sem vínculo/ })).toContainText('Resolvida')
  await expect(page.getByText('1 pendência(s)')).toBeVisible()
  expect(consultas.at(-1)!.searchParams.get('resolvido_em')).toBe('not.is.null')

  await page.getByLabel('Situação').selectOption('todas')
  await expect(page.getByText('3 pendência(s)')).toBeVisible()
  expect(consultas.at(-1)!.searchParams.get('resolvido_em')).toBeNull()

  await page.getByLabel('Tipo').selectOption('cpf_invalido')
  await expect(page.getByText('1 pendência(s)')).toBeVisible()
  expect(consultas.at(-1)!.searchParams.get('tipo')).toBe('eq.cpf_invalido')
})

test('migração: juntada com nome ou RG diferentes (a pendência que o corte abre nos dados reais) tem rótulo em pt-BR e filtro', async ({ page }) => {
  const consultas = await abrirMigracao(page, [
    pendencia(1, 'juntada_divergente', {
      relacionado_id: 'e7300000-0000-4000-8000-00000000c555', // registro antigo do parceiro: não há tela dele
      detalhe: 'Cadastros do mesmo parceiro com o mesmo CPF foram juntados neste cliente, mas têm nome ou RG diferentes.',
    }),
    pendencia(2, 'cpf_invalido'),
  ])
  await expect(page.getByText('2 pendência(s)')).toBeVisible()
  const linha = page.getByRole('row', { name: /Juntada com nome ou RG diferentes/ })
  await expect(linha).toContainText('Aberta')
  await expect(page.getByText('juntada_divergente')).toHaveCount(0) // nunca o código cru na tela

  await page.getByLabel('Tipo').selectOption('juntada_divergente') // o filtro oferece o tipo
  await expect(page.getByText('1 pendência(s)')).toBeVisible()
  expect(consultas.at(-1)!.searchParams.get('tipo')).toBe('eq.juntada_divergente')
  await page.getByRole('button', { name: 'Detalhes' }).click()
  const gaveta = page.getByRole('dialog', { name: 'Pendência da migração' })
  await expect(gaveta).toContainText('nome ou RG diferentes')
  await expect(gaveta.getByRole('link', { name: 'Cliente relacionado' })).toHaveCount(0)
})

test('migração: com mais de 50 pendências, a paginação pede a próxima página (offset) e o total vem do count', async ({ page }) => {
  const muitas = Array.from({ length: 120 }, (_, i) => pendencia(i + 1, 'cpf_invalido'))
  const consultas = await abrirMigracao(page, muitas)
  await expect(page.getByText('120 pendência(s)')).toBeVisible()
  await expect(page.getByText('1–50 de 120')).toBeVisible()
  await page.getByRole('button', { name: 'Próxima página' }).click()
  await expect(page.getByText('51–100 de 120')).toBeVisible()
  expect(consultas.at(-1)!.searchParams.get('offset')).toBe('50')
  await page.getByLabel('Tipo').selectOption('dono_sem_vinculo') // mudar filtro volta para a primeira página
  await expect(page.getByText('Nenhuma pendência aberta.')).toBeVisible()
  expect(consultas.at(-1)!.searchParams.get('offset')).toBe('0')
})

test('migração: a gaveta mostra o detalhe e a decisão de uma pendência já resolvida', async ({ page }) => {
  await abrirMigracao(page, [pendencia(3, 'cpf_conflito_portal', {
    resolvido_em: '2026-09-28T10:00:00Z', decisao: 'CPF confirmado com o titular', relacionado_id: 'e7300000-0000-4000-8000-00000000c777',
  })])
  await page.getByLabel('Situação').selectOption('resolvidas')
  await page.getByRole('button', { name: 'Detalhes' }).click()
  const gaveta = page.getByRole('dialog', { name: 'Pendência da migração' })
  await expect(gaveta).toContainText('Detalhe da pendência 3')
  await expect(gaveta).toContainText('CPF confirmado com o titular')
  await expect(gaveta.getByRole('link', { name: 'Cliente relacionado' })).toBeVisible()
  await expect(gaveta.getByRole('button', { name: 'Resolver' })).toHaveCount(0) // já resolvida
})

test('migração: resolver exige decisão de 5+ caracteres, envia p_id e p_decisao e a lista se atualiza', async ({ page }) => {
  const itens = [pendencia(1, 'cpf_invalido'), pendencia(2, 'dono_sem_vinculo')]
  await isolarSupabase(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  await simularPendencias(page, itens)
  const resolucoes = await simularRpc(page, 'migracao_pendencias_resolver', (a) => {
    const p = itens.find((x) => x.id === a.p_id)!
    p.resolvido_em = '2026-09-29T12:00:00Z'
    p.decisao = String(a.p_decisao)
    return null
  })
  await page.goto('/admin/migracao')
  await expect(page.getByText('2 pendência(s)')).toBeVisible()

  await page.getByRole('row', { name: /CPF inválido/ }).getByRole('button', { name: 'Resolver' }).click()
  const modal = page.getByRole('dialog', { name: 'Resolver pendência' })
  await expect(modal).toContainText('Detalhe da pendência 1')
  const registrar = modal.getByRole('button', { name: 'Registrar decisão' })
  await expect(registrar).toBeDisabled()
  await modal.getByLabel(/Decisão/).fill('abc')
  await expect(registrar).toBeDisabled() // menos de 5 caracteres
  expect(resolucoes).toHaveLength(0)
  await modal.getByLabel(/Decisão/).fill('CPF confirmado com o corretor e completado na ficha')
  await registrar.click()
  await expect(page.getByText('Pendência resolvida.')).toBeVisible()
  expect(resolucoes).toEqual([{ p_id: 1, p_decisao: 'CPF confirmado com o corretor e completado na ficha' }])
  // a lista foi relida: a resolvida sai das abertas
  await expect(page.getByText('1 pendência(s)')).toBeVisible()
  await expect(page.getByRole('row', { name: /CPF inválido/ })).toHaveCount(0)
})

test('migração: o servidor recusa (sem acesso) → aviso e o modal continua aberto com o texto', async ({ page }) => {
  await isolarSupabase(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  await simularPendencias(page, [pendencia(1, 'cpf_invalido')])
  const resolucoes = await simularRpc(page, 'migracao_pendencias_resolver', erroRpc('42501', 'Sem acesso a este registro'))
  await page.goto('/admin/migracao')
  await page.getByRole('button', { name: 'Resolver' }).click()
  const modal = page.getByRole('dialog', { name: 'Resolver pendência' })
  await modal.getByLabel(/Decisão/).fill('Decisão registrada pela equipe')
  await modal.getByRole('button', { name: 'Registrar decisão' }).click()
  await expect(page.getByText('Você não tem acesso a este registro.')).toBeVisible()
  await expect(modal).toBeVisible()
  await expect(modal.getByLabel(/Decisão/)).toHaveValue('Decisão registrada pela equipe')
  expect(resolucoes).toHaveLength(1)
})

test('migração: falha ao listar mostra o erro com "Tentar de novo"', async ({ page }) => {
  await isolarSupabase(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  await page.route('**/rest/v1/migracao_pendencias**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'falha simulada' }) }))
  await page.goto('/admin/migracao')
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
  await simularPendencias(page, [pendencia(1, 'cpf_invalido')])
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByText('1 pendência(s)')).toBeVisible()
})

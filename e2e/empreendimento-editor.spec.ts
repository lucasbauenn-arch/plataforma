import { expect as expectBase, test, type Page } from '@playwright/test'
import { empreendimentoTeste, entrarComo, isolarSupabase, responderRest } from './apoio'

// Editor de empreendimento do admin (FUX-01, FUX-03 e FUX-06 da revisão final do WP7): importação do espelho de vendas
// SEM apagar unidades, consultas com erro tratado, exclusões com confirmação e erro do servidor avisado. A rede do
// Supabase é simulada (e2e/apoio.ts): o teste vê cada requisição de escrita e nada chega ao banco.

test.describe.configure({ timeout: 120_000 })
const expect = expectBase.configure({ timeout: 40_000 })

const ADMIN = 'e7100000-0000-4000-8000-0000000000ad'
const EMP = 'e7100000-0000-4000-8000-000000000001'
const U1 = 'e7100000-0000-4000-8000-0000000000a1'
const U2 = 'e7100000-0000-4000-8000-0000000000a2'
const U9 = 'e7100000-0000-4000-8000-0000000000a9'

interface UnidadeSim { id: string; empreendimento_id: string; identificador: string; metragem: number | null; valor: number | null; status: string; dormitorios: null; andar: null }
const unidade = (id: string, identificador: string, extra: Partial<UnidadeSim> = {}): UnidadeSim =>
  ({ id, empreendimento_id: EMP, identificador, metragem: 50, valor: 300000, status: 'disponivel', dormitorios: null, andar: null, ...extra })

interface Chamada { metodo: string; caminho: string; consulta: URLSearchParams; corpo: unknown }
interface Resposta { status: number; corpo: unknown }
type Escrita = (c: Chamada) => Resposta | null

const erroPg = (status: number, code: string, message: string): Resposta => ({ status, corpo: { code, message, details: null, hint: null } })

function empreendimentoCompleto(extra: Record<string, unknown> = {}) {
  return {
    ...empreendimentoTeste, id: EMP, chamada: null, tagline: null, titulo_hero: null, descricao: null, titulo_lazer: null, descricao_lazer: null,
    endereco: null, bairro: null, cidade: null, uf: null, cep: null, titulo_localizacao: null, texto_localizacao: null, waze_url: null,
    latitude: null, longitude: null, dormitorios: null, vagas: null, metragem: null, categoria: null, construtora: null,
    total_unidades: null, previsao_entrega: null, tour_virtual_url: null,
    empreendimento_midias: [
      { id: 'm1', empreendimento_id: EMP, tipo: 'fachada', url: 'emp/x/a.webp', ordem: 0 },
      { id: 'm2', empreendimento_id: EMP, tipo: 'planta', url: 'emp/x/b.webp', ordem: 1 },
    ],
    empreendimento_lazer: [{ id: 'l1', empreendimento_id: EMP, titulo: 'Piscina', descricao: 'Adulto e infantil', ordem: 0 }],
    empreendimento_proximidades: [],
    empreendimento_ficha: [],
    ...extra,
  }
}

/**
 * Sobe o editor como admin. `escrita` decide a resposta de cada PATCH/POST/DELETE nas tabelas simuladas (padrão: tudo
 * certo, devolvendo a linha como o PostgREST com `return=representation`). Devolve o registro de todas as chamadas.
 */
async function prepararEditor(page: Page, opcoes: {
  unidades?: UnidadeSim[]; escrita?: Escrita; unidadesComErro?: boolean; obra?: unknown[]; obraComErro?: boolean
  /** Campos do empreendimento sobrescritos (total_unidades, metragem, lazer…). */
  emp?: Record<string, unknown>
  /** Construtoras devolvidas pela consulta da lista (select=construtora). */
  construtoras?: (string | null)[]
} = {}) {
  await isolarSupabase(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  const cadastro = opcoes.unidades ?? []
  const chamadas: Chamada[] = []
  await page.route('**/rest/v1/empreendimentos**', (r) => {
    const req = r.request()
    const url = new URL(req.url())
    if (req.method() === 'GET') {
      if (url.searchParams.get('select') === 'construtora') return responderRest(r, (opcoes.construtoras ?? []).map((construtora) => ({ construtora })))
      return responderRest(r, [empreendimentoCompleto(opcoes.emp)])
    }
    chamadas.push({ metodo: req.method(), caminho: 'empreendimentos', consulta: url.searchParams, corpo: req.postData() ? req.postDataJSON() : null })
    return r.fulfill({ status: 204, body: '' })
  })
  await page.route(/\/rest\/v1\/(unidades|empreendimento_midias|empreendimento_lazer|empreendimento_proximidades|obra_atualizacoes)(\?|$)/, async (r) => {
    const req = r.request()
    const url = new URL(req.url())
    const tabela = url.pathname.split('/').pop()!
    if (req.method() === 'GET') {
      if (tabela === 'unidades') {
        if (opcoes.unidadesComErro) return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'falha simulada' }) })
        return responderRest(r, cadastro)
      }
      if (tabela === 'obra_atualizacoes') {
        if (opcoes.obraComErro) return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'falha simulada' }) })
        return responderRest(r, opcoes.obra ?? [])
      }
      return responderRest(r, [])
    }
    const corpo = req.postData() ? req.postDataJSON() : null
    const chamada: Chamada = { metodo: req.method(), caminho: tabela, consulta: url.searchParams, corpo }
    chamadas.push(chamada)
    const resposta = opcoes.escrita?.(chamada)
    if (resposta) return r.fulfill({ status: resposta.status, contentType: 'application/json', body: JSON.stringify(resposta.corpo) })
    const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '')
    const linhas = req.method() === 'POST' ? (Array.isArray(corpo) ? corpo : [corpo]).map((l, i) => ({ id: `novo-${i}`, ...l })) : [{ id }]
    return r.fulfill({ status: req.method() === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify(linhas) })
  })
  return chamadas
}

async function abrirAba(page: Page, aba: string) {
  await page.goto(`/admin/empreendimentos/${EMP}`)
  await expect(page.getByRole('heading', { name: 'Residencial E2E' })).toBeVisible()
  await page.getByRole('button', { name: aba, exact: true }).click()
}

const enviarCsv = (page: Page, csv: string) =>
  page.locator('input[type=file][accept=".csv,.txt"]').setInputFiles({ name: 'espelho.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') })

// ============ FUX-01: importação do espelho de vendas ============

test('importar o espelho NUNCA apaga: atualiza por nome, cria as novas, mantém as que não estão no arquivo', async ({ page }) => {
  const chamadas = await prepararEditor(page, {
    unidades: [unidade(U1, 'APTO 01'), unidade(U2, 'APTO 02', { status: 'vendida' }) /* sob contrato */, unidade(U9, 'APTO 09')],
  })
  await abrirAba(page, 'Unidades e materiais')
  await expect(page.getByText('3 unidades · 2 disponíveis')).toBeVisible()

  await enviarCsv(page, 'Unidade;Metragem;Valor;Status\nAPTO 01;50;R$ 320.000,00;reservada\nApto 02;;;\nAPTO 03;60;400000;disponível')
  const modal = page.getByRole('dialog', { name: 'Importar espelho de vendas' })
  await expect(modal).toContainText('espelho.csv')
  await expect(modal).toContainText('1 unidade(s) nova(s)')
  await expect(modal).toContainText('1 atualizada(s) e 1 que já estão iguais')
  await expect(modal).toContainText('Nenhuma unidade é apagada')
  await expect(modal).toContainText('As 1 unidade(s) que não estão no arquivo continuam como estão')
  await expect(modal).toContainText('precisará ter o PDF gerado de novo')
  expect(chamadas).toHaveLength(0) // nada é gravado antes da confirmação

  await modal.getByRole('button', { name: 'Importar' }).click()
  await expect(page.getByText('Importação concluída: 1 nova(s), 1 atualizada(s).')).toBeVisible()

  expect(chamadas.filter((c) => c.metodo === 'DELETE')).toEqual([])
  const patches = chamadas.filter((c) => c.metodo === 'PATCH')
  expect(patches).toHaveLength(1)
  expect(patches[0].consulta.get('id')).toBe(`eq.${U1}`)
  expect(patches[0].consulta.get('empreendimento_id')).toBe(`eq.${EMP}`)
  expect(patches[0].corpo).toEqual({ valor: 320000, status: 'reservada' }) // só o que mudou
  const posts = chamadas.filter((c) => c.metodo === 'POST')
  expect(posts).toHaveLength(1)
  expect(posts[0].corpo).toEqual([{ empreendimento_id: EMP, identificador: 'APTO 03', metragem: 60, valor: 400000, status: 'disponivel' }])
})

test('importar de novo o mesmo arquivo não faz nada (idempotente): "Nada a alterar" e nenhuma escrita', async ({ page }) => {
  const chamadas = await prepararEditor(page, { unidades: [unidade(U1, 'APTO 01', { valor: 320000, status: 'reservada' })] })
  await abrirAba(page, 'Unidades e materiais')
  await enviarCsv(page, 'APTO 01;50;320000;reservada')
  await expect(page.getByText('Nada a alterar: as 1 unidade(s) do arquivo já estão iguais ao cadastro.')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Importar espelho de vendas' })).toHaveCount(0)
  expect(chamadas).toEqual([])
})

test('arquivo com a mesma unidade repetida é recusado inteiro (nada é gravado)', async ({ page }) => {
  const chamadas = await prepararEditor(page, { unidades: [unidade(U1, 'APTO 01')] })
  await abrirAba(page, 'Unidades e materiais')
  await enviarCsv(page, 'APTO 05;40;1;disponível\napto 05;41;2;vendida\nAPTO 06;40;1;disponível')
  await expect(page.getByText('O arquivo repete estas unidades: APTO 05, apto 05.')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Importar espelho de vendas' })).toHaveCount(0)
  expect(chamadas).toEqual([])
})

test('arquivo sem linha válida é recusado com o formato esperado', async ({ page }) => {
  const chamadas = await prepararEditor(page, { unidades: [] })
  await abrirAba(page, 'Unidades e materiais')
  await enviarCsv(page, 'Unidade;Metragem;Valor;Status\n\n')
  await expect(page.getByText('Nenhuma linha válida. Formato: unidade;metragem;valor;status')).toBeVisible()
  expect(chamadas).toEqual([])
})

test('falha no meio da importação: avisa quantas foram gravadas, não apaga nada e o plano não é repetido', async ({ page }) => {
  const chamadas = await prepararEditor(page, {
    unidades: [unidade(U1, 'APTO 01'), unidade(U2, 'APTO 02')],
    escrita: (c) => (c.metodo === 'PATCH' && c.consulta.get('id') === `eq.${U2}` ? erroPg(400, 'P0001', 'Valor não pode ficar abaixo do mínimo.') : null),
  })
  await abrirAba(page, 'Unidades e materiais')
  await enviarCsv(page, 'APTO 01;50;310000;disponível\nAPTO 02;50;1;disponível\nAPTO 03;60;400000;disponível')
  const modal = page.getByRole('dialog', { name: 'Importar espelho de vendas' })
  await modal.getByRole('button', { name: 'Importar' }).click()
  const aviso = page.getByText(/1 unidade\(s\) não foram gravadas \(APTO 02\)/)
  await expect(aviso).toBeVisible()
  await expect(aviso).toContainText('2 foram gravadas. Envie o arquivo de novo para tentar as que faltam.')
  await expect(modal).not.toBeVisible() // fecha: repetir o mesmo plano criaria a APTO 03 outra vez
  expect(chamadas.filter((c) => c.metodo === 'DELETE')).toEqual([])
  expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(1)
})

test('a política de acesso que barra em silêncio (0 linhas) também vira falha avisada', async ({ page }) => {
  await prepararEditor(page, {
    unidades: [unidade(U1, 'APTO 01')],
    escrita: (c) => (c.metodo === 'PATCH' ? { status: 200, corpo: [] } : null),
  })
  await abrirAba(page, 'Unidades e materiais')
  await enviarCsv(page, 'APTO 01;50;310000;disponível')
  await page.getByRole('dialog', { name: 'Importar espelho de vendas' }).getByRole('button', { name: 'Importar' }).click()
  await expect(page.getByText(/1 unidade\(s\) não foram gravadas \(APTO 01\): A unidade não foi encontrada ou você não pode alterá-la\./)).toBeVisible()
})

// ============ FUX-06: exclusões e ações com erro ============

test('excluir unidade pede confirmação; unidade com contrato (FK) é recusada com a explicação e o modal fica aberto', async ({ page }) => {
  const chamadas = await prepararEditor(page, {
    unidades: [unidade(U1, 'APTO 01'), unidade(U2, 'APTO 02', { status: 'vendida' })],
    escrita: (c) => (c.metodo === 'DELETE' && c.consulta.get('id') === `eq.${U2}`
      ? erroPg(409, '23503', 'update or delete on table "unidades" violates foreign key constraint "contratos_unidade_id_fkey" on table "contratos"')
      : null),
  })
  await abrirAba(page, 'Unidades e materiais')
  await page.getByRole('button', { name: 'Excluir unidade APTO 02' }).click()
  const modal = page.getByRole('dialog', { name: 'Excluir a unidade APTO 02?' })
  await expect(modal).toContainText('Unidade com contrato não pode ser excluída')
  expect(chamadas).toEqual([]) // nada antes de confirmar
  await modal.getByRole('button', { name: 'Excluir' }).click()
  await expect(page.getByText('Esta unidade está ligada a um contrato e não pode ser excluída.')).toBeVisible()
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Cancelar' }).click()
  await expect(modal).not.toBeVisible()
  expect(chamadas.filter((c) => c.metodo === 'DELETE')).toHaveLength(1)

  // sem contrato: apaga e avisa
  await page.getByRole('button', { name: 'Excluir unidade APTO 01' }).click()
  await page.getByRole('dialog', { name: 'Excluir a unidade APTO 01?' }).getByRole('button', { name: 'Excluir' }).click()
  await expect(page.getByText('Excluído', { exact: true })).toBeVisible()
  expect(chamadas.filter((c) => c.metodo === 'DELETE').map((c) => c.consulta.get('id'))).toEqual([`eq.${U2}`, `eq.${U1}`])
})

test('cadastro manual: nome de unidade repetido (mesmo com outra caixa) é recusado; nome novo entra', async ({ page }) => {
  const chamadas = await prepararEditor(page, { unidades: [unidade(U1, 'APTO 01')] })
  await abrirAba(page, 'Unidades e materiais')
  await page.getByLabel('Unidade', { exact: true }).fill('apto  01')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect(page.getByText('Já existe a unidade "apto  01" neste empreendimento.')).toBeVisible()
  expect(chamadas).toEqual([])

  await page.getByLabel('Unidade', { exact: true }).fill('APTO 07')
  await page.getByLabel('Metragem').fill('48,5')
  await page.getByLabel('Valor', { exact: true }).fill('R$ 310.000,00')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect.poll(() => chamadas.length).toBe(1)
  expect(chamadas[0].metodo).toBe('POST')
  expect(chamadas[0].corpo).toEqual({ empreendimento_id: EMP, identificador: 'APTO 07', metragem: 48.5, valor: 310000 })
})

test('mudar o status da unidade confere o erro (0 linhas = aviso, nada de sucesso falso)', async ({ page }) => {
  await prepararEditor(page, {
    unidades: [unidade(U1, 'APTO 01')],
    escrita: (c) => (c.metodo === 'PATCH' ? { status: 200, corpo: [] } : null),
  })
  await abrirAba(page, 'Unidades e materiais')
  await page.getByLabel('Status de APTO 01').selectOption('vendida')
  await expect(page.getByText('Não foi possível alterar o status desta unidade.')).toBeVisible()
})

test('galeria: botão de remover visível sem passar o mouse, com nome acessível, confirmação e erro do servidor avisado', async ({ page }) => {
  const chamadas = await prepararEditor(page, { escrita: (c) => (c.metodo === 'DELETE' ? erroPg(403, '42501', 'não simulado') : null) })
  await abrirAba(page, 'Galeria')
  const remover = page.getByRole('button', { name: 'Remover imagem 1 (fachada)' })
  await expect(remover).toBeVisible()
  await expect(remover).toHaveCSS('opacity', '1') // antes só aparecia no hover: inacessível no toque e no teclado
  await expect(page.getByRole('combobox', { name: 'Tipo da imagem' })).toBeVisible()

  await remover.click()
  const modal = page.getByRole('dialog', { name: 'Remover imagem da galeria?' })
  expect(chamadas).toEqual([])
  await modal.getByRole('button', { name: 'Excluir' }).click()
  await expect(page.getByText('Você não tem acesso a este registro.')).toBeVisible()
  await expect(modal).toBeVisible()
  expect(chamadas.map((c) => [c.metodo, c.caminho, c.consulta.get('id')])).toEqual([['DELETE', 'empreendimento_midias', 'eq.m1']])
})

test('item de lazer: editar e excluir têm nome acessível; excluir confirma antes', async ({ page }) => {
  const chamadas = await prepararEditor(page)
  await abrirAba(page, 'Lazer, ficha e proximidades')
  await expect(page.getByRole('button', { name: 'Editar Piscina' })).toBeVisible()
  await page.getByRole('button', { name: 'Excluir Piscina' }).click()
  const modal = page.getByRole('dialog', { name: 'Excluir "Piscina"?' })
  await expect(modal).toContainText('Itens de lazer')
  expect(chamadas).toEqual([])
  await modal.getByRole('button', { name: 'Excluir' }).click()
  await expect(page.getByText('Excluído', { exact: true })).toBeVisible()
  expect(chamadas.map((c) => [c.metodo, c.caminho, c.consulta.get('id')])).toEqual([['DELETE', 'empreendimento_lazer', 'eq.l1']])
})

test('andamento da obra: excluir atualização confirma antes e avisa o erro; lista com falha mostra "Tentar de novo"', async ({ page }) => {
  const chamadas = await prepararEditor(page, {
    obra: [{ id: 'o1', empreendimento_id: EMP, percentual: 35, titulo: 'Concretagem da 5ª laje', descricao: null, fotos: [], data: '2026-09-10' }],
    escrita: (c) => (c.metodo === 'DELETE' ? erroPg(403, '42501', 'não simulado') : null),
  })
  await abrirAba(page, 'Andamento da obra')
  await expect(page.getByRole('button', { name: 'Editar atualização Concretagem da 5ª laje' })).toBeVisible()
  await page.getByRole('button', { name: 'Excluir atualização Concretagem da 5ª laje' }).click()
  const modal = page.getByRole('dialog', { name: 'Excluir a atualização "Concretagem da 5ª laje"?' })
  expect(chamadas).toEqual([])
  await modal.getByRole('button', { name: 'Excluir' }).click()
  await expect(page.getByText('Você não tem acesso a este registro.')).toBeVisible()
  await expect(modal).toBeVisible()
  expect(chamadas.map((c) => [c.metodo, c.caminho, c.consulta.get('id')])).toEqual([['DELETE', 'obra_atualizacoes', 'eq.o1']])
})

test('andamento da obra que não carrega mostra o erro (nunca a tela em branco)', async ({ page }) => {
  await prepararEditor(page, { obraComErro: true })
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))
  await abrirAba(page, 'Andamento da obra')
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nova atualização' })).toBeVisible() // o formulário continua de pé
  expect(erros).toEqual([])
})

// ============ FUX-03: consulta com erro não derruba a tela ============

test('unidades que não carregam: mostra o erro com "Tentar de novo" (nunca a tela em branco) e recupera', async ({ page }) => {
  await prepararEditor(page, { unidades: [unidade(U1, 'APTO 01')], unidadesComErro: true })
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))
  await abrirAba(page, 'Unidades e materiais')
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Residencial E2E' })).toBeVisible()
  // volta a responder: o botão recarrega
  await page.route(/\/rest\/v1\/unidades(\?|$)/, (r) => responderRest(r, [unidade(U1, 'APTO 01')]))
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByText('1 unidades · 1 disponíveis')).toBeVisible()
  expect(erros).toEqual([])
})

test('lista de empreendimentos do admin: erro do servidor mostra a mensagem com "Tentar de novo"; sem cadastro mostra o vazio', async ({ page }) => {
  await isolarSupabase(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))
  await page.route('**/rest/v1/empreendimentos**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'falha simulada' }) }))
  await page.goto('/admin/empreendimentos')
  await expect(page.getByRole('heading', { name: 'Empreendimentos' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()

  await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, []))
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByText('Nenhum empreendimento cadastrado')).toBeVisible()
  expect(erros).toEqual([])
})

// "Novo" usava window.prompt, que o navegador embutido do app bloqueia sem avisar: agora é um formulário em janela.
test('lista: Novo abre formulário, cria como rascunho e abre o editor', async ({ page }) => {
  await isolarSupabase(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  const criados: unknown[] = []
  await page.route('**/rest/v1/empreendimentos**', async (r) => {
    if (r.request().method() === 'POST') {
      criados.push(r.request().postDataJSON())
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: EMP }) })
    }
    return responderRest(r, [])
  })
  await page.goto('/admin/empreendimentos')
  await page.getByRole('button', { name: 'Novo' }).click()
  const janela = page.getByRole('dialog', { name: 'Novo empreendimento' })
  await janela.getByRole('button', { name: 'Criar e editar' }).click()
  await expect(janela.getByText('Informe o nome (mínimo 3 letras)')).toBeVisible()
  expect(criados).toHaveLength(0)
  await janela.getByLabel('Nome do empreendimento').fill('Residencial Árvore Nova')
  await expect(janela.getByText('/empreendimentos/residencial-arvore-nova')).toBeVisible()
  await janela.getByRole('button', { name: 'Criar e editar' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/empreendimentos/${EMP}$`))
  expect(criados).toEqual([{ nome: 'Residencial Árvore Nova', slug: 'residencial-arvore-nova', publicado: false }])
})

// ============ Dados: construtora, previsão de entrega, CEP com endereço e coordenadas ============

/** ViaCEP, BrasilAPI v2 (centro da cidade) e Nominatim (a rua) simulados; devolve as URLs chamadas. */
async function simularCepECoordenadas(page: Page) {
  const urls: string[] = []
  const json = (corpo: unknown) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(corpo) })
  await page.route(/viacep\.com\.br/, (r) => {
    urls.push(r.request().url())
    return r.fulfill(json({ cep: '03333-050', logradouro: 'Rua Coronel Irineu de Castro', bairro: 'Jardim Anália Franco', localidade: 'São Paulo', uf: 'SP', complemento: '' }))
  })
  await page.route(/brasilapi\.com\.br/, (r) => {
    urls.push(r.request().url())
    return r.fulfill(json({ cep: '03333050', state: 'SP', city: 'São Paulo', location: { type: 'Point', coordinates: { longitude: '-46.63611', latitude: '-23.5475' } } }))
  })
  await page.route(/nominatim\.openstreetmap\.org/, (r) => {
    urls.push(r.request().url())
    return r.fulfill(json([{ lat: '-23.5585800', lon: '-46.5688690' }]))
  })
  return urls
}

test('Dados: construtora da lista ou "Outra…", UF por lista, CEP preenche endereço e coordenadas; grava só os 8 dígitos', async ({ page }) => {
  const chamadas = await prepararEditor(page, { construtoras: ['Arken', 'Vitta', 'Arken', null], emp: { construtora: 'Arken', previsao_entrega: '2027-12-01' } })
  const urls = await simularCepECoordenadas(page)
  await abrirAba(page, 'Dados')

  const construtora = page.getByLabel('Construtora', { exact: true })
  await expect(construtora.locator('option')).toHaveText(['Não informada', 'Arken', 'Vitta', 'Outra…'])
  await expect(construtora).toHaveValue('Arken')
  await construtora.selectOption({ label: 'Outra…' })
  await page.getByLabel('Nome da construtora').fill('Construtora Nova')
  await expect(page.getByLabel('Previsão de entrega')).toHaveValue('01/12/2027')

  const uf = page.getByRole('combobox', { name: 'UF', exact: true })
  await expect(uf.locator('option')).toHaveCount(28) // "Selecione" + 27
  await page.getByLabel('CEP', { exact: true }).fill('03333050')
  await expect(page.getByLabel('Endereço')).toHaveValue('Rua Coronel Irineu de Castro')
  await expect(page.getByLabel('Bairro')).toHaveValue('Jardim Anália Franco')
  await expect(page.getByLabel('Cidade')).toHaveValue('São Paulo')
  await expect(uf).toHaveValue('SP')
  // a BrasilAPI v2 é consultada primeiro, mas dá o centro da cidade: vale a rua geocodificada no Nominatim
  await expect(page.getByLabel('Latitude')).toHaveValue('-23.55858')
  await expect(page.getByLabel('Longitude')).toHaveValue('-46.568869')
  await expect(page.getByText('Coordenadas da rua preenchidas')).toBeVisible()
  expect(urls.some((u) => u.includes('brasilapi.com.br/api/cep/v2/03333050'))).toBe(true)
  expect(urls.filter((u) => u.includes('nominatim'))).toHaveLength(1)

  // continua editável
  await page.getByLabel('Endereço').fill('Rua Coronel Irineu de Castro, 43')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible()
  const patch = chamadas.find((c) => c.metodo === 'PATCH' && c.caminho === 'empreendimentos')!
  expect(patch.corpo).toMatchObject({
    cep: '03333050', uf: 'SP', endereco: 'Rua Coronel Irineu de Castro, 43', bairro: 'Jardim Anália Franco', cidade: 'São Paulo',
    latitude: -23.55858, longitude: -46.568869, construtora: 'Construtora Nova', previsao_entrega: '2027-12-01',
  })
})

test('Dados: CEP incompleto não é gravado (aviso) e nada vai ao servidor', async ({ page }) => {
  const chamadas = await prepararEditor(page)
  await simularCepECoordenadas(page)
  await abrirAba(page, 'Dados')
  await page.getByLabel('CEP', { exact: true }).fill('0333')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('CEP incompleto: informe os 8 dígitos ou deixe o campo vazio.')).toBeVisible()
  expect(chamadas.filter((c) => c.caminho === 'empreendimentos')).toEqual([])
})

// ============ Lazer e proximidades com ícones do catálogo ============

test('lazer por chips: liga cria o item com ícone; item antigo de mesmo título aparece ligado e desligar com descrição confirma', async ({ page }) => {
  const chamadas = await prepararEditor(page)
  await abrirAba(page, 'Lazer, ficha e proximidades')
  const catalogo = page.getByRole('group', { name: 'Catálogo de lazer' })
  // "Piscina" (item antigo, sem chave) conta como ligado pelo título
  await expect(catalogo.getByRole('button', { name: 'Piscina', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(catalogo.getByRole('button', { name: 'Academia', exact: true })).toHaveAttribute('aria-pressed', 'false')

  await catalogo.getByRole('button', { name: 'Academia', exact: true }).click()
  await expect(page.getByText('Academia incluído no lazer')).toBeVisible()
  expect(chamadas.map((c) => [c.metodo, c.caminho, c.corpo])).toEqual([
    ['POST', 'empreendimento_lazer', { empreendimento_id: EMP, titulo: 'Academia', icone_catalogo: 'academia', ordem: 1 }],
  ])

  // desligar um item com descrição pede confirmação (a descrição se perderia)
  await catalogo.getByRole('button', { name: 'Piscina', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Excluir "Piscina"?' })
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Cancelar' }).click()
  expect(chamadas.filter((c) => c.metodo === 'DELETE')).toEqual([])

  // "Outro": item livre, com ícone opcional
  await catalogo.getByRole('button', { name: 'Outro', exact: true }).click()
  const form = page.getByRole('form', { name: 'Outro item de lazer' })
  await form.getByLabel('Título').fill('Espaço de leitura')
  await form.getByRole('group', { name: 'Ícone do item' }).getByRole('button', { name: 'Lounge', exact: true }).click()
  await form.getByRole('button', { name: 'Adicionar' }).click()
  await expect(page.getByText('Item incluído no lazer')).toBeVisible()
  expect(chamadas.at(-1)).toMatchObject({ metodo: 'POST', caminho: 'empreendimento_lazer', corpo: { titulo: 'Espaço de leitura', descricao: null, icone_catalogo: 'lounge', empreendimento_id: EMP } })
})

test('lazer: desligar item sem descrição remove direto; proximidade grava a categoria escolhida por chip', async ({ page }) => {
  const chamadas = await prepararEditor(page, {
    emp: { empreendimento_lazer: [{ id: 'l2', empreendimento_id: EMP, titulo: 'Sauna', descricao: null, icone: null, icone_catalogo: 'sauna', imagem_url: null, ordem: 0 }] },
  })
  await abrirAba(page, 'Lazer, ficha e proximidades')
  await page.getByRole('group', { name: 'Catálogo de lazer' }).getByRole('button', { name: 'Sauna', exact: true }).click()
  await expect(page.getByText('Sauna removido do lazer')).toBeVisible()
  expect(chamadas.map((c) => [c.metodo, c.caminho, c.consulta.get('id')])).toEqual([['DELETE', 'empreendimento_lazer', 'eq.l2']])

  const form = page.getByRole('form', { name: 'Nova proximidade' })
  await form.getByRole('group', { name: 'Categoria da proximidade' }).getByRole('button', { name: 'Metrô', exact: true }).click()
  await form.getByLabel('Local').fill('Estação Tatuapé')
  await form.getByLabel('Distância').fill('800 m')
  await form.getByLabel('A pé').fill('10 min')
  await form.getByRole('button', { name: 'Adicionar' }).click()
  await expect(page.getByText('Proximidade incluída')).toBeVisible()
  expect(chamadas.at(-1)).toMatchObject({
    metodo: 'POST', caminho: 'empreendimento_proximidades',
    corpo: { nome: 'Estação Tatuapé', icone_catalogo: 'metro', distancia: '800 m', tempo_pe: '10 min', tempo_carro: null, empreendimento_id: EMP, ordem: 0 },
  })
})

// ============ Unidades: gerar as que faltam, cores e filtro por status ============

test('gerar unidades até o total de Dados: pula nomes existentes, confirma antes e só cria (nada apaga nem altera)', async ({ page }) => {
  const chamadas = await prepararEditor(page, {
    emp: { total_unidades: 5, metragem: '48 m²' },
    unidades: [unidade(U1, 'APTO 01'), unidade(U2, 'apto 3', { status: 'reservada' })],
  })
  await abrirAba(page, 'Unidades e materiais')
  await expect(page.getByText('2 de 5 unidades previstas')).toBeVisible()
  const cartao = page.getByRole('form', { name: 'Gerar unidades' })
  await expect(cartao.getByLabel('Prefixo')).toHaveValue('APTO')
  await expect(cartao.getByLabel('Metragem padrão (m²)')).toHaveValue('48')
  await cartao.getByLabel('Valor padrão').fill('R$ 350.000,00')
  await cartao.getByRole('button', { name: 'Gerar 3 unidades' }).click()

  const modal = page.getByRole('dialog', { name: 'Gerar unidades' })
  await expect(modal).toContainText('APTO 02, APTO 04, APTO 05')
  await expect(modal).toContainText('Nenhuma unidade existente é alterada ou apagada')
  expect(chamadas).toEqual([])
  await modal.getByRole('button', { name: 'Gerar 3 unidades' }).click()
  await expect(page.getByText('3 unidade(s) criada(s).')).toBeVisible()
  expect(chamadas.filter((c) => c.metodo !== 'POST')).toEqual([])
  expect(chamadas.map((c) => c.corpo)).toEqual([[
    { empreendimento_id: EMP, identificador: 'APTO 02', metragem: 48, valor: 350000, status: 'disponivel' },
    { empreendimento_id: EMP, identificador: 'APTO 04', metragem: 48, valor: 350000, status: 'disponivel' },
    { empreendimento_id: EMP, identificador: 'APTO 05', metragem: 48, valor: 350000, status: 'disponivel' },
  ]])
})

test('com o total atingido não aparece o cartão de gerar', async ({ page }) => {
  await prepararEditor(page, { emp: { total_unidades: 1 }, unidades: [unidade(U1, 'APTO 01')] })
  await abrirAba(page, 'Unidades e materiais')
  await expect(page.getByText('1 de 1 unidades previstas')).toBeVisible()
  await expect(page.getByRole('form', { name: 'Gerar unidades' })).toHaveCount(0)
})

test('unidades: cor por status (reservada = aviso, vendida = sage) e filtro com contagem', async ({ page }) => {
  await prepararEditor(page, {
    unidades: [unidade(U1, 'APTO 01'), unidade(U2, 'APTO 02', { status: 'reservada' }), unidade(U9, 'APTO 09', { status: 'vendida' })],
  })
  await abrirAba(page, 'Unidades e materiais')
  await expect(page.getByLabel('Status de APTO 02')).toHaveClass(/text-aviso/)
  await expect(page.getByLabel('Status de APTO 09')).toHaveClass(/text-sage/)
  await expect(page.getByLabel('Status de APTO 01')).not.toHaveClass(/text-(aviso|sage)/)

  const filtros = page.getByRole('group', { name: 'Filtrar unidades por status' })
  await expect(filtros.getByRole('button')).toHaveText(['Todas (3)', 'Disponíveis (1)', 'Reservadas (1)', 'Vendidas (1)'])
  await filtros.getByRole('button', { name: 'Reservadas (1)' }).click()
  await expect(filtros.getByRole('button', { name: 'Reservadas (1)' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel(/^Status de /)).toHaveCount(1)
  await expect(page.getByLabel('Status de APTO 02')).toBeVisible()
  await filtros.getByRole('button', { name: 'Todas (3)' }).click()
  await expect(page.getByLabel(/^Status de /)).toHaveCount(3)
})

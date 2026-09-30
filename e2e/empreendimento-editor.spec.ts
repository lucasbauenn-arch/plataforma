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

function empreendimentoCompleto() {
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
  }
}

/**
 * Sobe o editor como admin. `escrita` decide a resposta de cada PATCH/POST/DELETE nas tabelas simuladas (padrão: tudo
 * certo, devolvendo a linha como o PostgREST com `return=representation`). Devolve o registro de todas as chamadas.
 */
async function prepararEditor(page: Page, opcoes: { unidades?: UnidadeSim[]; escrita?: Escrita; unidadesComErro?: boolean; obra?: unknown[]; obraComErro?: boolean } = {}) {
  await isolarSupabase(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  const cadastro = opcoes.unidades ?? []
  const chamadas: Chamada[] = []
  await page.route('**/rest/v1/empreendimentos**', (r) => r.request().method() === 'GET' ? responderRest(r, [empreendimentoCompleto()]) : r.fallback())
  await page.route(/\/rest\/v1\/(unidades|empreendimento_midias|empreendimento_lazer|obra_atualizacoes)(\?|$)/, async (r) => {
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

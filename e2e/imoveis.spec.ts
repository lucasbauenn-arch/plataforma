import { expect, test, type Page, type Route } from '@playwright/test'
import { entrarComo, erroRpc, responderPagina, responderRest, simularRpc } from './apoio'

// Módulo Imóveis [WP5] (docs/ARQUITETURA_EXPANSAO.md §7.3, §8.5): rede do Supabase simulada, nada chega ao banco.
// Leitura e edição dos campos vão direto na tabela (RLS E4 + grant por coluna); status, fotos e inativação por RPC.

// os fluxos têm várias idas ao servidor simulado; com vários workers e o Vite compilando sob demanda, 30 s fica justo
test.describe.configure({ timeout: 90_000 })
const ESPERA = { timeout: 15_000 }

const CORRETOR = 'a5000000-0000-4000-8000-0000000000c1'
const OUTRO = 'a5000000-0000-4000-8000-0000000000c2'
const ADMIN = 'a5000000-0000-4000-8000-0000000000ad'
const ID = 'e5000000-0000-4000-8000-000000000002'
const NOVO = 'e5000000-0000-4000-8000-0000000000ff'

type Linha = Record<string, unknown>

function imovel(extra: Linha = {}): Linha {
  return {
    id: ID, codigo: 12, nome: 'Casa do Lago', matricula: null, tipo: 'casa', descricao: null, status: 'rascunho',
    cep: null, pais: 'Brasil', uf: null, cidade: null, bairro: null, logradouro: null, numero: null, complemento: null,
    valor: null, area_total: null, area_construida: null, idade_anos: null, andar: null, quartos: null, banheiros: null,
    suites: null, vagas: null, adicionais: [], observacao_revisao: null, criado_por: CORRETOR, criado_por_parceiro_id: null,
    imobiliaria_id: null, gerente_id: null, criado_em: '2026-09-28T10:00:00Z', atualizado_em: null, atualizado_por: null,
    inativado_em: null, inativado_por: null, motivo_inativacao: null, ...extra,
  }
}

const linhaTransicao = (de: string, para: string, extra: Linha = {}) => ({
  entidade: 'imovel', de, para, papeis: ['admin', 'super'], permite_criador: false, sistema: false, exige_motivo: false,
  validacoes: [], efeitos: [], ativa: true, atualizado_em: '2026-09-28T00:00:00Z', atualizado_por: null, ...extra,
})
// semente da migration 20260929000008 (§3.8)
const TRANSICOES = [
  linhaTransicao('rascunho', 'pendente', { permite_criador: true, validacoes: ['campos_obrigatorios_imovel'] }),
  linhaTransicao('pendente', 'em_revisao'),
  linhaTransicao('em_revisao', 'aprovado'),
  linhaTransicao('em_revisao', 'rascunho', { exige_motivo: true }),
  linhaTransicao('aprovado', 'no_contrato', { papeis: [], sistema: true }),
  linhaTransicao('no_contrato', 'aprovado', { papeis: [], sistema: true }),
]
const TIPOS = [
  { codigo: 'apartamento', rotulo: 'Apartamento', ativo: true, criado_em: '2026-09-28T00:00:00Z', criado_por: null, atualizado_em: null, atualizado_por: null },
  { codigo: 'casa', rotulo: 'Casa', ativo: true, criado_em: '2026-09-28T00:00:00Z', criado_por: null, atualizado_em: null, atualizado_por: null },
  { codigo: 'terreno', rotulo: 'Terreno', ativo: true, criado_em: '2026-09-28T00:00:00Z', criado_por: null, atualizado_em: null, atualizado_por: null },
]

/** Nenhuma requisição sai para o Supabase real nem para as APIs de CEP (rotas específicas vêm depois e têm precedência). */
async function isolarRede(page: Page) {
  await page.route('**/rest/v1/**', (r) => r.request().method() === 'GET'
    ? responderRest(r, [])
    : r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'não simulado', details: null, hint: null }) }))
  await page.route('**/storage/v1/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"não simulado"}' }))
  await page.route(/viacep\.com\.br|brasilapi\.com\.br/, (r) => r.fulfill({ status: 404, body: '{}' }))
}

/** Apoio comum da tela: tipos, transições, limites de fotos e fotos (vazias). */
async function simularApoio(page: Page) {
  await page.route('**/rest/v1/imovel_tipos**', (r) => responderRest(r, TIPOS))
  await page.route('**/rest/v1/status_transicoes**', (r) => responderRest(r, TRANSICOES))
  await page.route('**/rest/v1/configuracao_publica**', (r) => responderRest(r, [{ imovel_fotos_max: 20, imovel_foto_max_bytes: 5242880 }]))
  await page.route('**/rest/v1/imovel_fotos**', (r) => responderRest(r, []))
}

/**
 * `imoveis` com estado: GET devolve o registro atual; PATCH aplica as colunas enviadas e guarda o corpo; POST cria.
 * Devolve os corpos recebidos (para conferir que status, criador e cadeia nunca vão pela API).
 */
async function simularImovel(page: Page, estado: { atual: Linha }) {
  const corpos: { metodo: string; corpo: Linha }[] = []
  await page.route('**/rest/v1/imoveis**', async (r: Route) => {
    const metodo = r.request().method()
    if (metodo === 'PATCH' || metodo === 'POST') {
      const corpo = r.request().postDataJSON() as Linha
      corpos.push({ metodo, corpo })
      estado.atual = metodo === 'POST' ? imovel({ ...corpo, id: NOVO, codigo: 99 }) : { ...estado.atual, ...corpo, atualizado_em: new Date().toISOString() }
      return responderRest(r, [estado.atual], metodo === 'POST' ? 201 : 200)
    }
    return responderRest(r, [estado.atual])
  })
  return corpos
}

const PROIBIDAS = ['id', 'codigo', 'status', 'criado_por', 'criado_por_parceiro_id', 'imobiliaria_id', 'gerente_id',
  'observacao_revisao', 'inativado_em', 'inativado_por', 'motivo_inativacao']

test('lista de imóveis: abas por status, busca e link de cadastro', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.com', 'corretor', { nome: 'Corretora E2E' })
  await simularApoio(page)
  const consultas: string[] = []
  await page.route('**/rest/v1/imoveis**', (r) => {
    consultas.push(decodeURIComponent(r.request().url()))
    const linhas = [imovel(), imovel({ id: NOVO, codigo: 7, nome: 'Apto Centro', tipo: 'apartamento', status: 'aprovado', cidade: 'Curitiba', uf: 'PR', valor: 450000, criado_por: OUTRO })]
    return responderPagina(r, linhas)
  })

  await page.goto('/parceiros/painel/imoveis')
  await expect(page.getByRole('heading', { name: 'Imóveis' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Casa do Lago' })).toBeVisible()
  await expect(page.getByText('#0000007')).toBeVisible()
  await expect(page.getByText('Curitiba / PR')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Cadastrar imóvel' })).toBeVisible()
  // sem filtro de status na aba "Todos"; inativados fora por padrão
  expect(consultas[0]).not.toContain('status=eq.')
  expect(consultas[0]).toContain('inativado_em=is.null')

  await page.getByRole('tab', { name: 'Pendentes' }).click()
  await expect.poll(() => consultas.at(-1)).toContain('status=eq.pendente')
  await page.getByRole('searchbox').fill('#0000012')
  await expect.poll(() => consultas.at(-1)).toContain('codigo.eq.12')
})

test('corretor cadastra imóvel novo em rascunho (sem status, criador nem cadeia no corpo)', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.com', 'corretor', { nome: 'Corretora E2E' })
  await simularApoio(page)
  const estado = { atual: imovel() }
  const corpos = await simularImovel(page, estado)

  await page.goto('/parceiros/painel/imoveis/novo')
  await expect(page.getByRole('heading', { name: 'Cadastrar imóvel' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Salve o rascunho para enviar as fotos.')).toBeVisible()
  await page.getByLabel('Nome do imóvel').fill('Casa nova E2E')
  await page.getByLabel('Tipo').selectOption('casa')
  await page.getByText('Piscina', { exact: true }).click()
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()

  await expect(page.getByText('Rascunho salvo.')).toBeVisible(ESPERA)
  await expect(page).toHaveURL(new RegExp(`/parceiros/painel/imoveis/${NOVO}$`))
  await expect(page.getByRole('heading', { name: 'Casa nova E2E' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar fotos' })).toBeVisible()

  expect(corpos).toHaveLength(1)
  expect(corpos[0].metodo).toBe('POST')
  expect(corpos[0].corpo).toMatchObject({ nome: 'Casa nova E2E', tipo: 'casa', adicionais: ['piscina'], pais: 'Brasil', valor: null })
  for (const k of PROIBIDAS) expect(corpos[0].corpo).not.toHaveProperty(k)
})

test('imóvel RA → PE com campos faltando listados (IMV-2 no servidor) e depois finalizado', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.com', 'corretor', { nome: 'Corretora E2E' })
  await simularApoio(page)
  await page.route(/viacep\.com\.br\/ws\/01310100/, (r) => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ cep: '01310-100', logradouro: 'Avenida Paulista', complemento: '', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' }),
  }))
  const estado = { atual: imovel() }
  const corpos = await simularImovel(page, estado)
  let chamadas = await simularRpc(page, 'imovel_mudar_status',
    erroRpc('P0001', 'CAMPOS_OBRIGATORIOS', { campos: ['cep', 'logradouro', 'numero', 'cidade', 'uf', 'valor'] }))

  await page.goto(`/parceiros/painel/imoveis/${ID}`)
  await expect(page.getByRole('heading', { name: 'Casa do Lago' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Finalizar cadastro' }).click()

  const alerta = page.getByRole('alert').filter({ hasText: 'Para finalizar o cadastro, preencha:' })
  await expect(alerta).toBeVisible(ESPERA)
  for (const campo of ['CEP', 'Logradouro', 'Número', 'Cidade', 'Estado (UF)', 'Valor']) {
    await expect(alerta.getByRole('listitem').filter({ hasText: new RegExp(`^${campo.replace(/[()]/g, '\\$&')}$`) })).toBeVisible()
  }
  await expect(page.getByText('Obrigatório para finalizar o cadastro').first()).toBeVisible()
  await expect(page.getByText('Preencha os campos obrigatórios: CEP, logradouro, número, cidade, estado, valor.')).toBeVisible()
  expect(chamadas).toEqual([{ p_id: ID, p_para: 'pendente', p_obs: null }])
  expect(corpos).toHaveLength(0) // nada mudou no formulário: não houve PATCH

  // CEP automático preenche o endereço; o resto é digitado
  await page.getByLabel('CEP').fill('01310100')
  await expect(page.getByLabel('Logradouro')).toHaveValue('Avenida Paulista')
  await expect(page.getByLabel('Cidade')).toHaveValue('São Paulo')
  await expect(page.getByLabel('Estado (UF)')).toHaveValue('SP')
  await page.getByLabel('Número').fill('1000')
  await page.getByLabel('Valor').fill('85000000')
  await expect(page.getByLabel('Valor')).toHaveValue('850.000,00')

  chamadas = await simularRpc(page, 'imovel_mudar_status', (a: Linha) => {
    estado.atual = { ...estado.atual, status: a.p_para }
    return null
  })
  await page.getByRole('button', { name: 'Finalizar cadastro' }).click()
  await expect(page.getByText('Cadastro finalizado.')).toBeVisible(ESPERA)
  expect(chamadas).toEqual([{ p_id: ID, p_para: 'pendente', p_obs: null }])
  // o PATCH leva só o que mudou; nunca status nem cadeia
  expect(corpos).toHaveLength(1)
  expect(corpos[0].metodo).toBe('PATCH')
  expect(corpos[0].corpo).toEqual({
    cep: '01310100', uf: 'SP', cidade: 'São Paulo', bairro: 'Bela Vista', logradouro: 'Avenida Paulista', numero: '1000', valor: 850000,
  })
  await expect(page.getByRole('main').getByText('Pendente', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finalizar cadastro' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeVisible() // o criador ainda edita em PE
  await expect(page.getByRole('alert').filter({ hasText: 'Para finalizar' })).toHaveCount(0)
})

test('interno inicia a revisão e devolve com observação obrigatória; histórico visível', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ADMIN, 'admin@e2e.com', 'admin', { nome: 'Admin E2E' })
  await simularApoio(page)
  const estado = { atual: imovel({ status: 'pendente', cep: '01310100', uf: 'SP', cidade: 'São Paulo', logradouro: 'Avenida Paulista', numero: '1000', valor: 850000 }) }
  await simularImovel(page, estado)
  await page.route('**/rest/v1/historico_status**', (r) => responderRest(r, [
    { id: 1, entidade: 'imovel', entidade_id: ID, de: 'rascunho', para: 'pendente', motivo: null, origem: 'usuario', ator_id: ADMIN, ocorrido_em: '2026-09-28T11:00:00Z' },
  ]))
  const chamadas = await simularRpc(page, 'imovel_mudar_status', (a: Linha) => {
    estado.atual = { ...estado.atual, status: a.p_para, observacao_revisao: a.p_obs ?? estado.atual.observacao_revisao }
    return null
  })

  await page.goto(`/admin/imoveis/${ID}`)
  await expect(page.getByRole('heading', { name: 'Casa do Lago' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Histórico de status' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Inativar imóvel' })).toBeVisible()

  await page.getByRole('button', { name: 'Iniciar revisão' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: 'Iniciar revisão' }).click()
  await expect(page.getByText('Revisão iniciada.')).toBeVisible(ESPERA)
  expect(chamadas).toEqual([{ p_id: ID, p_para: 'em_revisao', p_obs: null }])

  await page.getByRole('button', { name: 'Devolver com observação' }).click()
  const confirmar = page.getByRole('dialog').getByRole('button', { name: 'Devolver com observação' })
  await expect(confirmar).toBeDisabled()
  await page.getByRole('dialog').getByLabel('Observação para quem cadastrou').fill('ok')
  await expect(confirmar).toBeDisabled()
  await page.getByRole('dialog').getByLabel('Observação para quem cadastrou').fill('Faltam as fotos da fachada.')
  await confirmar.click()
  await expect(page.getByText('Imóvel devolvido para ajustes.')).toBeVisible(ESPERA)
  expect(chamadas[1]).toEqual({ p_id: ID, p_para: 'rascunho', p_obs: 'Faltam as fotos da fachada.' })
  await expect(page.getByText('Devolvido pela equipe Arken para ajustes')).toBeVisible()
})

const COMPLETO: Linha = { cep: '01310100', uf: 'SP', cidade: 'São Paulo', logradouro: 'Avenida Paulista', numero: '1000', valor: 850000 }

test('fora do rascunho, campo obrigatório não fica vazio: a tela recusa antes de gravar', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.com', 'corretor', { nome: 'Corretora E2E' })
  await simularApoio(page)
  const corpos = await simularImovel(page, { atual: imovel({ status: 'pendente', ...COMPLETO }) })

  await page.goto(`/parceiros/painel/imoveis/${ID}`)
  await expect(page.getByRole('heading', { name: 'Casa do Lago' })).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Nome do imóvel').fill('')
  await page.getByLabel('Número').fill('  ')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('Obrigatório: o cadastro já foi finalizado')).toHaveCount(2)
  expect(corpos).toHaveLength(0) // nada foi para o servidor

  // trocar por outro valor válido continua permitido em PE
  await page.getByLabel('Nome do imóvel').fill('Casa do Lago reformada')
  await page.getByLabel('Número').fill('1001')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('Alterações salvas.')).toBeVisible(ESPERA)
  expect(corpos).toEqual([{ metodo: 'PATCH', corpo: { nome: 'Casa do Lago reformada', numero: '1001' } }])
})

test('interno: aprovação recusada por campo obrigatório faltando marca o campo', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ADMIN, 'admin@e2e.com', 'admin', { nome: 'Admin E2E' })
  await simularApoio(page)
  await simularImovel(page, { atual: imovel({ status: 'em_revisao', ...COMPLETO, valor: null }) })
  await page.route('**/rest/v1/historico_status**', (r) => responderRest(r, []))
  const chamadas = await simularRpc(page, 'imovel_mudar_status', erroRpc('P0001', 'CAMPOS_OBRIGATORIOS', { campos: ['valor'] }))

  await page.goto(`/admin/imoveis/${ID}`)
  await expect(page.getByRole('heading', { name: 'Casa do Lago' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Aprovar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Aprovar' }).click()

  await expect(page.getByText('Preencha os campos obrigatórios: valor.')).toBeVisible(ESPERA)
  await expect(page.getByRole('dialog')).toBeHidden()
  const alerta = page.getByRole('alert').filter({ hasText: 'não podem ficar vazios' })
  await expect(alerta.getByRole('listitem').filter({ hasText: /^Valor$/ })).toBeVisible()
  await expect(page.getByText('Obrigatório: o cadastro já foi finalizado')).toBeVisible()
  expect(chamadas).toEqual([{ p_id: ID, p_para: 'aprovado', p_obs: null }])
})

test('imóvel no contrato: valor travado e link para o contrato do próprio imóvel', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ADMIN, 'admin@e2e.com', 'admin', { nome: 'Admin E2E' })
  await simularApoio(page)
  await simularImovel(page, { atual: imovel({ status: 'no_contrato', ...COMPLETO }) })
  await page.route('**/rest/v1/historico_status**', (r) => responderRest(r, []))
  const CONTRATO = 'c5000000-0000-4000-8000-000000000003'
  const produto = (id: string, nome: string) => ({ tipo: 'imovel', id, nome, codigo: 12, empreendimento: null, valor: 850000 })
  // o servidor filtra pelo imovel_id (FUX-11): a simulação faz o mesmo, então só o contrato do próprio imóvel volta
  const todos = [
    { id: 'c5000000-0000-4000-8000-000000000009', codigo: 9, produto: produto(NOVO, 'Casa do Lago II') },
    { id: CONTRATO, codigo: 3, produto: produto(ID, 'Casa do Lago') },
  ]
  const buscas = await simularRpc(page, 'contratos_listar', (a) => {
    const itens = todos.filter((k) => k.produto.id === (a.p_filtros as { imovel_id?: string }).imovel_id)
    return { total: itens.length, itens }
  })

  await page.goto(`/admin/imoveis/${ID}`)
  await expect(page.getByRole('heading', { name: 'Casa do Lago' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Travado: imóvel em contrato.')).toBeVisible()
  await expect(page.getByLabel('Valor')).toBeDisabled()
  expect(buscas).toHaveLength(0) // a consulta de contratos (auditada) só sai no clique

  await page.getByRole('button', { name: 'Ver contrato' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/contratos/${CONTRATO}$`), ESPERA)
  // filtra pelo id do imóvel, sem depender do nome (nome comum ou longo já quebrava a busca antiga)
  expect(buscas).toEqual([{ p_filtros: { imovel_id: ID, status: ['assinatura_pendente', 'assinado'], limite: 1, offset: 0 } }])
})

test('parceiro vê o imóvel aprovado de outro só para leitura', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.com', 'corretor', { nome: 'Corretora E2E' })
  await simularApoio(page)
  await simularImovel(page, { atual: imovel({ status: 'aprovado', criado_por: OUTRO, valor: 450000 }) })

  await page.goto(`/parceiros/painel/imoveis/${ID}`)
  await expect(page.getByRole('heading', { name: 'Casa do Lago' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Você pode ver este imóvel, mas não pode alterá-lo.')).toBeVisible()
  await expect(page.getByLabel('Nome do imóvel')).toBeDisabled()
  await expect(page.getByLabel('Valor')).toBeDisabled()
  for (const nome of ['Salvar rascunho', 'Salvar alterações', 'Finalizar cadastro', 'Enviar fotos', 'Aprovar', 'Inativar imóvel']) {
    await expect(page.getByRole('button', { name: nome })).toHaveCount(0)
  }
})

test('fotos: reduzidas no navegador para WebP ≤ 1920 px, registradas pela RPC e reordenadas', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.com', 'corretor', { nome: 'Corretora E2E' })
  await simularApoio(page)
  await simularImovel(page, { atual: imovel() })

  const fotos: Linha[] = [{
    id: 'f5000000-0000-4000-8000-000000000001', imovel_id: ID, storage_path: `${ID}/antiga.webp`, miniatura_path: `${ID}/antiga-min.webp`,
    ordem: 0, largura: 1920, altura: 1080, bytes: 1000, criado_por: CORRETOR, criado_em: '2026-09-28T10:00:00Z',
  }]
  await page.route('**/rest/v1/imovel_fotos**', (r) => responderRest(r, fotos))
  let png = Buffer.alloc(0)
  const envios: { caminho: string; corpo: Buffer; upsert: string | undefined }[] = []
  await page.route(/\/storage\/v1\/object\/imoveis\//, async (r) => {
    const caminho = decodeURIComponent(new URL(r.request().url()).pathname.split('/object/imoveis/')[1])
    envios.push({ caminho, corpo: r.request().postDataBuffer() ?? Buffer.alloc(0), upsert: r.request().headers()['x-upsert'] })
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ Key: `imoveis/${caminho}`, Id: crypto.randomUUID() }) })
  })
  await page.route(/\/storage\/v1\/object\/sign\/imoveis/, async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ contentType: 'image/png', body: png })
    const corpo = r.request().postDataJSON() as { paths?: string[] }
    if (corpo.paths) {
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(corpo.paths.map((p) => ({ path: p, signedURL: `/object/sign/imoveis/${p}?token=t`, error: null }))) })
    }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ signedURL: '/object/sign/imoveis/x.webp?token=t' }) })
  })
  const registros = await simularRpc(page, 'imovel_foto_registrar', (a: Linha) => {
    const id = 'f5000000-0000-4000-8000-000000000002'
    fotos.push({ id, imovel_id: ID, storage_path: a.p_path, miniatura_path: a.p_miniatura_path, ordem: 1, largura: 1920, altura: 1280, bytes: 2000, criado_por: CORRETOR, criado_em: new Date().toISOString() })
    return id
  })
  const ordens = await simularRpc(page, 'imovel_fotos_ordenar', null)

  await page.goto(`/parceiros/painel/imoveis/${ID}`)
  await expect(page.getByRole('heading', { name: 'Casa do Lago' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('1 de 20 fotos')).toBeVisible()

  // foto de 2400 × 1600 px gerada no próprio navegador
  const b64 = await page.evaluate(async () => {
    const c = new OffscreenCanvas(2400, 1600)
    const g = c.getContext('2d')!
    g.fillStyle = '#8fa894'
    g.fillRect(0, 0, 2400, 1600)
    g.fillStyle = '#c27e4a'
    g.fillRect(200, 200, 800, 600)
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const x of bytes) s += String.fromCharCode(x)
    return btoa(s)
  })
  png = Buffer.from(b64, 'base64')
  await page.getByTestId('entrada-fotos').setInputFiles({ name: 'Fachada da casa.png', mimeType: 'image/png', buffer: png })

  await expect(page.getByText('Foto enviada.')).toBeVisible({ timeout: 15_000 })
  expect(envios).toHaveLength(2)
  const [principal, miniatura] = envios
  expect(principal.caminho).toMatch(new RegExp(`^${ID}/[0-9a-f-]{36}\\.webp$`))
  expect(miniatura.caminho).toBe(principal.caminho.replace(/\.webp$/, '-min.webp'))
  expect(principal.upsert).toBe('false')
  // o nome do arquivo (dado da pessoa) não vai para o bucket; a foto sai em WebP reduzida a 1920 × 1280
  expect(principal.caminho).not.toContain('Fachada')
  expect(principal.corpo.toString('latin1')).toContain('image/webp')
  expect(principal.corpo.toString('latin1')).toContain('"largura":1920')
  expect(principal.corpo.toString('latin1')).toContain('"altura":1280')
  expect(registros).toEqual([{ p_imovel_id: ID, p_path: principal.caminho, p_miniatura_path: miniatura.caminho }])

  await expect(page.getByText('2 de 20 fotos')).toBeVisible(ESPERA)
  await expect(page.getByRole('img', { name: 'Foto 2 do imóvel' })).toBeVisible()
  await page.getByRole('button', { name: 'Mover a foto 2 para antes' }).click()
  await expect.poll(() => ordens.length).toBe(1)
  expect(ordens[0]).toEqual({ p_imovel_id: ID, p_ids: ['f5000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000001'] })
})

test('limite de fotos do servidor interrompe o envio com a mensagem traduzida', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.com', 'corretor', { nome: 'Corretora E2E' })
  await simularApoio(page)
  await simularImovel(page, { atual: imovel() })
  const removidos: unknown[] = []
  await page.route(/\/storage\/v1\/object\/imoveis(\/|$)/, async (r) => {
    if (r.request().method() === 'DELETE') {
      removidos.push(r.request().postDataJSON())
      return r.fulfill({ contentType: 'application/json', body: '[]' })
    }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ Key: 'imoveis/x', Id: crypto.randomUUID() }) })
  })
  await simularRpc(page, 'imovel_foto_registrar', erroRpc('P0001', 'LIMITE_FOTOS', { maximo: 20 }))

  await page.goto(`/parceiros/painel/imoveis/${ID}`)
  await expect(page.getByRole('button', { name: 'Enviar fotos' })).toBeVisible({ timeout: 20_000 })
  const b64 = await page.evaluate(async () => {
    const c = new OffscreenCanvas(40, 30)
    c.getContext('2d')!.fillRect(0, 0, 40, 30)
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const x of bytes) s += String.fromCharCode(x)
    return btoa(s)
  })
  await page.getByTestId('entrada-fotos').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') },
    { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') },
    { name: 'c.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
  ])
  await expect(page.getByText('"c.gif" não é uma imagem JPG, PNG ou WEBP.')).toBeVisible()
  await expect(page.getByText('a.png: O limite de fotos deste imóvel foi atingido.')).toBeVisible(ESPERA)
  // a fila para no limite (b.png não é tentada) e os arquivos enviados do registro recusado são apagados
  await expect(page.getByText('b.png:')).toHaveCount(0)
  await expect.poll(() => removidos.length).toBe(1)
  expect(JSON.stringify(removidos[0])).toContain(`${ID}/`)
})

import { expect, test, type Page, type Route } from '@playwright/test'
import { entrarComo, responderRest, simularDownload, simularRpc } from './apoio'
import type { ContratoDetalhe, ContratoResumo } from '../src/modulos/contratos/tipos'

// Contratos e D4Sign [WP4] (docs/ARQUITETURA_EXPANSAO.md §7.3, §8.5): rede do Supabase e Edge Functions simuladas,
// nada chega ao banco nem ao D4Sign. Casos: o corpo de contrato_criar e contrato_atualizar_simulacao não leva valores
// calculados nem o valor do produto (SEG-4); PDF com dados faltando; envio simulado e status "Assinado" depois da
// reconciliação; bloqueios do envio explicados; Super publica parâmetros; modelo com variável inválida; busca de produto
// no servidor (WP4R-06); erro dos parâmetros na prévia (WP4R-07); envio em andamento e versões da minuta (WP4R-01/04);
// representante sempre assina (WP4R-05).

test.describe.configure({ timeout: 90_000 })
const ESPERA = { timeout: 15_000 }

const CORRETOR = 'a4000000-0000-4000-8000-0000000000c1'
const ADMIN = 'a4000000-0000-4000-8000-0000000000ad'
const SUPER = 'a4000000-0000-4000-8000-0000000000a5'
const CLIENTE = 'd4000000-0000-4000-8000-000000000001'
const EMPREENDIMENTO = 'f4000000-0000-4000-8000-000000000001'
const UNIDADE = 'f4000000-0000-4000-8000-000000000011'
const K = 'e4000000-0000-4000-8000-000000000001'

const PARAMETROS = {
  id: 'f4000000-0000-4000-8000-0000000000aa', vigente_desde: '2026-09-01T00:00:00Z', taxa_aporte_proprio: 8.5,
  taxa_financeiro: null, juros_ao_mes: null, igpm_atual: null, parcela_minima: 12, parcela_maxima: 360,
  valor_minimo: null, valor_minimo_flex: null, criado_em: '2026-09-01T00:00:00Z', criado_por: null,
}

const PRODUTO = {
  tipo: 'unidade' as const, id: UNIDADE, nome: 'Residencial E2E · APTO 11', codigo: null,
  empreendimento: { id: EMPREENDIMENTO, nome: 'Residencial E2E' }, valor: 500000,
}

function detalhe(extra: Partial<ContratoDetalhe> = {}): ContratoDetalhe {
  const base: ContratoDetalhe = {
    id: K, codigo: 123, tipo: 'aquisicao', status: 'rascunho', forma_pagamento: 'parcelado',
    cliente: { id: CLIENTE, nome: 'Maria Compradora', email_presente: true },
    produto: PRODUTO,
    modelo: { id: 'm1', chave: 'parcelado', versao: 1, titulo: 'Aquisição, plano parcelado', revisado_juridico: true, liberado_para_envio: true },
    cadeia: { corretor: { id: 'p1', nome: 'Corretor E2E' }, gerente: null, imobiliaria: null },
    parametros_id: PARAMETROS.id,
    valor_imovel: 500000, perc_aporte: 30, valor_aporte: 150000, valor_entrada: 50000, base_parcelada: 100000,
    valor_restante: 350000, n_parcelas: 60, taxa_aporte: 8.5, valor_parcela: 1808.33, valor_total_parcelas: 108500,
    valor_minimo_flex: null, valor_produto_alterado: false,
    pdf: { versao: 0, gerado_em: null, desatualizado: true, disponivel: false, versoes: [] },
    pdf_assinado_disponivel: false, d4sign_enviado: false, envio_em_andamento: false, signatarios: [],
    bloqueios_envio: ['pdf_gerado'],
    destinos_status: [
      { para: 'documentacao_pendente', exige_motivo: false, validacoes: [], efeitos: [] },
      { para: 'em_analise', exige_motivo: false, validacoes: ['pdf_gerado'], efeitos: [] },
    ],
    permissoes: {
      editar_simulacao: true, gerar_pdf: true, enviar_analise: true, enviar_assinatura: false, cancelar_envio: false,
      atualizar_assinatura: false, arquivar: false, baixar_minuta: false, baixar_assinado: false,
    },
    observacao: null, criado_em: '2026-09-28T10:00:00Z', criado_por: { id: CORRETOR, nome: 'Corretor E2E' },
    enviado_assinatura_em: null, enviado_por: null, assinado_em: null, encerrado_em: null,
  }
  return { ...base, ...extra }
}

/** Nenhuma requisição sai para o Supabase real (rotas específicas vêm depois e têm precedência). */
async function isolarRede(page: Page) {
  await page.route('**/rest/v1/**', (r) => r.request().method() === 'GET'
    ? responderRest(r, [])
    : r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'não simulado', details: null, hint: null }) }))
  await page.route('**/storage/v1/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"não simulado"}' }))
  await page.route('**/functions/v1/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"erro":"não simulado"}' }))
}

/** Produtos e parâmetros vigentes lidos direto (RLS) para a escolha do produto e a prévia. */
async function simularProdutos(page: Page) {
  await page.route('**/rest/v1/parametros_simulacao**', (r) => responderRest(r, [PARAMETROS]))
  await page.route('**/rest/v1/unidades**', (r) => responderRest(r, [
    { id: UNIDADE, identificador: 'APTO 11', valor: 500000, empreendimentos: { id: EMPREENDIMENTO, nome: 'Residencial E2E' } },
  ]))
}

/** Edge Function simulada: guarda os corpos e responde com a função dada. */
async function simularEdge(page: Page, nome: string, responder: (corpo: Record<string, unknown>) => { status?: number; corpo: unknown }) {
  const corpos: Record<string, unknown>[] = []
  await page.route(`**/functions/v1/${nome}`, async (r: Route) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204 })
    const corpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    corpos.push(corpo)
    const resposta = responder(corpo)
    return r.fulfill({ status: resposta.status ?? 200, contentType: 'application/json', body: JSON.stringify(resposta.corpo) })
  })
  return corpos
}

test('corretor cria contrato: o corpo leva só as escolhas (SEG-4) e a tela mostra os valores do servidor', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Corretor E2E' })
  await simularProdutos(page)
  await simularRpc(page, 'contratos_listar', { total: 0, itens: [] })
  await simularRpc(page, 'crm_clientes_opcoes', [{ id: CLIENTE, nome: 'Maria Compradora', etapa: 'documentacao', corretor_nome: null }])
  const criar = await simularRpc(page, 'contrato_criar', K)
  let estado = detalhe()
  await simularRpc(page, 'contrato_detalhe', () => estado)
  const atualizar = await simularRpc(page, 'contrato_atualizar_simulacao', (args: Record<string, unknown>) => {
    estado = detalhe({ perc_aporte: 40, valor_aporte: 200000, base_parcelada: 150000, valor_restante: 300000, valor_parcela: 2712.5, valor_total_parcelas: 162750 })
    return args && null
  })

  await page.goto('/parceiros/painel/contratos')
  await page.getByRole('button', { name: 'Novo contrato' }).click()
  const modal = page.getByRole('dialog', { name: 'Novo contrato' })
  await modal.getByPlaceholder('Buscar cliente pelo nome…').click()
  await modal.getByRole('button', { name: /Maria Compradora/ }).click()
  await modal.getByRole('button', { name: /Residencial E2E · APTO 11/ }).click()
  await modal.getByLabel('% de aporte próprio').fill('30')
  await modal.getByLabel('Entrada').fill('5000000')
  await modal.getByLabel('Número de parcelas').fill('60')
  // prévia instantânea no navegador (mesmo cálculo do servidor), rotulada "prévia"
  await expect(modal.getByText(/Prévia — valores oficiais vêm do servidor/)).toBeVisible(ESPERA)
  await expect(modal.getByText(/60× de R\$\s1\.808,33/)).toBeVisible(ESPERA)
  await modal.getByRole('button', { name: 'Criar contrato' }).click()

  await expect(page).toHaveURL(new RegExp(`/parceiros/painel/contratos/${K}$`), ESPERA)
  expect(criar).toEqual([{
    p_cliente_id: CLIENTE, p_forma: 'parcelado', p_produto: { unidade_id: UNIDADE }, p_perc_aporte: 30, p_entrada: 50000, p_n_parcelas: 60,
  }])
  expect(JSON.stringify(criar[0])).not.toMatch(/valor|500000|1808|150000|108500/)

  await expect(page.getByRole('heading', { name: /Contrato #0000123/ })).toBeVisible(ESPERA)
  await expect(page.getByLabel('Valores oficiais do contrato').getByText(/60× de R\$\s1\.808,33/)).toBeVisible()
  await page.getByLabel('% de aporte próprio').fill('40')
  await page.getByRole('button', { name: 'Salvar simulação' }).click()
  await expect(page.getByText(/Simulação salva/)).toBeVisible(ESPERA)
  expect(atualizar).toEqual([{ p_id: K, p_forma: 'parcelado', p_perc_aporte: 40, p_entrada: 50000, p_n_parcelas: 60 }])
  expect(JSON.stringify(atualizar[0])).not.toMatch(/valor|produto|500000/)
  await expect(page.getByLabel('Valores oficiais do contrato').getByText(/60× de R\$\s2\.712,50/)).toBeVisible(ESPERA)
})

test('gerar PDF com dados faltando lista os campos; depois gera a versão 1', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Corretor E2E' })
  await simularProdutos(page)
  let estado = detalhe()
  await simularRpc(page, 'contrato_detalhe', () => estado)
  let tentativa = 0
  const corpos = await simularEdge(page, 'contrato-gerar', () => {
    tentativa++
    if (tentativa === 1) {
      return { status: 422, corpo: { erro: 'Faltam dados para gerar o contrato.', codigo: 'variaveis_faltando', detalhes: { desconhecidas: [], vazias: ['cep', 'logradouro'] } } }
    }
    estado = detalhe({ pdf: { versao: 1, gerado_em: '2026-09-28T12:00:00Z', desatualizado: false, disponivel: true, versoes: [1] }, bloqueios_envio: [], permissoes: { ...detalhe().permissoes, baixar_minuta: true } })
    return { corpo: { ok: true, versao: 1, path: `${K}/minuta-v1-aaaaaaaa.pdf` } }
  })

  await page.goto(`/parceiros/painel/contratos/${K}`)
  await page.getByRole('button', { name: 'Gerar PDF' }).click()
  await expect(page.getByText('Faltam dados: CEP, Logradouro.')).toBeVisible(ESPERA)
  await page.getByRole('button', { name: 'Gerar PDF' }).click()
  await expect(page.getByText('PDF gerado (versão 1).')).toBeVisible(ESPERA)
  await expect(page.getByText(/Versão 1 · gerada em/)).toBeVisible(ESPERA)
  expect(corpos).toEqual([{ contrato_id: K }, { contrato_id: K }])

  // baixar: RPC auditada e URL assinada pela Edge baixar-arquivo
  const baixar = await simularRpc(page, 'contrato_baixar', { bucket: 'contratos', path: `${K}/minuta-v1-aaaaaaaa.pdf`, expira_em: new Date(Date.now() + 60_000).toISOString() })
  const pedidos = await simularDownload(page)
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Baixar' }).click()
  const aba = await popup
  // a aba abre no clique e só recebe o endereço depois da RPC e da Edge baixar-arquivo
  await expect.poll(() => pedidos.length, ESPERA).toBe(1)
  await aba.close()
  expect(baixar).toEqual([{ p_id: K, p_tipo: 'minuta', p_versao: null }])
  expect(pedidos).toEqual([{ bucket: 'contratos', path: `${K}/minuta-v1-aaaaaaaa.pdf` }])
})

test('interno envia para assinatura (D4Sign simulado) e o contrato fica Assinado depois da reconciliação', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  await simularProdutos(page)
  const permissoesInterno = { ...detalhe().permissoes, editar_simulacao: false, enviar_analise: false, enviar_assinatura: true, baixar_minuta: true, arquivar: true }
  let estado = detalhe({
    status: 'em_analise', bloqueios_envio: [], permissoes: permissoesInterno,
    pdf: { versao: 2, gerado_em: '2026-09-28T12:00:00Z', desatualizado: false, disponivel: true, versoes: [2, 1] },
    destinos_status: [
      { para: 'rascunho', exige_motivo: true, validacoes: [], efeitos: [] },
      { para: 'documentacao_pendente', exige_motivo: true, validacoes: [], efeitos: [] },
      { para: 'arquivado', exige_motivo: true, validacoes: [], efeitos: [] },
    ],
  })
  await simularRpc(page, 'contrato_detalhe', () => estado)
  await page.route('**/rest/v1/contrato_signatario_regras**', (r) => responderRest(r, [
    { id: 'r1', modelo_chave: 'parcelado', ordem: 1, papel: 'cliente', fonte: 'cliente', nome: null, email: null, ato: 'assinar', ativo: true },
    { id: 'r2', modelo_chave: 'parcelado', ordem: 2, papel: 'representante_arken', fonte: 'fixo', nome: 'Representante Arken', email: 'rep@arken.test', ato: 'assinar', ativo: true },
  ]))
  const signatarios = (status: 'pendente' | 'assinado') => [
    { id: 's1', ordem: 1, papel: 'cliente' as const, nome: 'Maria Compradora', email: 'maria@cliente.test', ato: 'assinar' as const, status, assinado_em: status === 'assinado' ? '2026-09-28T15:00:00Z' : null, recusado_em: null, motivo: null },
    { id: 's2', ordem: 2, papel: 'representante_arken' as const, nome: 'Representante Arken', email: 'rep@arken.test', ato: 'assinar' as const, status, assinado_em: status === 'assinado' ? '2026-09-28T15:05:00Z' : null, recusado_em: null, motivo: null },
  ]
  const corpos = await simularEdge(page, 'contrato-assinatura', (corpo) => {
    if (corpo.acao === 'enviar') {
      estado = {
        ...estado, status: 'assinatura_pendente', destinos_status: [{ para: 'cancelado', exige_motivo: true, validacoes: [], efeitos: ['imovel_aprovado'] }],
        signatarios: signatarios('pendente'), d4sign_enviado: true, enviado_assinatura_em: '2026-09-28T13:00:00Z', enviado_por: { id: ADMIN, nome: 'Admin E2E' },
        permissoes: { ...permissoesInterno, enviar_assinatura: false, arquivar: false, cancelar_envio: true, atualizar_assinatura: true },
      }
      return { corpo: { ok: true, status: 'assinatura_pendente' } }
    }
    estado = {
      ...estado, status: 'assinado', destinos_status: [], signatarios: signatarios('assinado'), assinado_em: '2026-09-28T15:05:00Z',
      pdf_assinado_disponivel: true,
      permissoes: { ...permissoesInterno, enviar_assinatura: false, arquivar: false, baixar_assinado: true },
    }
    return { corpo: { ok: true, status: 'assinado' } }
  })

  await page.goto(`/admin/contratos/${K}`)
  await page.getByRole('button', { name: 'Enviar para assinatura' }).click()
  const modal = page.getByRole('dialog', { name: /Enviar para assinatura/ })
  await expect(modal.getByText('Tudo pronto para o envio.')).toBeVisible(ESPERA)
  await expect(modal.getByText(/Representante Arken — rep@arken\.test/)).toBeVisible(ESPERA)
  await modal.getByRole('button', { name: 'Enviar para assinatura' }).click()
  await expect(page.getByText(/Contrato enviado para assinatura/)).toBeVisible(ESPERA)
  await expect(page.getByRole('heading', { name: 'Assinaturas (D4Sign)' })).toBeVisible(ESPERA)
  await expect(page.getByLabel('Signatários').getByText('Pendente')).toHaveCount(2)

  await page.getByRole('button', { name: 'Atualizar status' }).click()
  await expect(page.getByText(/Geração de parcelas: etapa financeira \(pendente\)/)).toBeVisible(ESPERA)
  await expect(page.getByLabel('Signatários').getByText('Assinado')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Baixar PDF assinado' })).toBeVisible()
  expect(corpos).toEqual([{ acao: 'enviar', contrato_id: K }, { acao: 'atualizar', contrato_id: K }])
})

test('envio bloqueado: o modal explica cada bloqueio e não deixa enviar', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin')
  await simularProdutos(page)
  await simularRpc(page, 'contrato_detalhe', detalhe({
    status: 'em_analise', bloqueios_envio: ['modelo_liberado', 'vendedora_configurada', 'email_cliente'],
    pdf: { versao: 1, gerado_em: '2026-09-28T12:00:00Z', desatualizado: false, disponivel: true, versoes: [1] },
    permissoes: { ...detalhe().permissoes, editar_simulacao: false, enviar_analise: false, enviar_assinatura: true }, destinos_status: [],
  }))
  const edge = await simularEdge(page, 'contrato-assinatura', () => ({ corpo: { ok: true } }))
  await page.goto(`/admin/contratos/${K}`)
  await page.getByRole('button', { name: 'Enviar para assinatura' }).click()
  const modal = page.getByRole('dialog', { name: /Enviar para assinatura/ })
  await expect(modal.getByText('O envio está bloqueado:')).toBeVisible(ESPERA)
  await expect(modal.getByText(/Modelo liberado\./)).toBeVisible()
  await expect(modal.getByText(/Dados da vendedora\./)).toBeVisible()
  await expect(modal.getByText(/E-mail do cliente\./)).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Enviar para assinatura' })).toBeDisabled()
  expect(edge).toEqual([])
})

test('Super publica nova versão dos parâmetros de simulação', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, SUPER, 'super@e2e.test', 'super', { nome: 'Super E2E' })
  await page.route('**/rest/v1/parametros_simulacao**', (r) => responderRest(r, [PARAMETROS]))
  const publicar = await simularRpc(page, 'config_publicar_parametros', null)
  await page.goto('/admin/configuracoes/simulacao')
  await expect(page.getByText('não configurado: plano flexível bloqueado')).toBeVisible(ESPERA)
  await page.getByLabel('Mínimo por pagamento (plano flexível)').fill('250000')
  await page.getByRole('button', { name: 'Publicar nova versão' }).click()
  await page.getByRole('dialog', { name: /Publicar nova versão/ }).getByRole('button', { name: 'Publicar' }).click()
  await expect(page.getByText(/Nova versão dos parâmetros publicada/)).toBeVisible(ESPERA)
  expect(publicar).toEqual([{
    p: {
      taxa_aporte_proprio: 8.5, taxa_financeiro: null, juros_ao_mes: null, igpm_atual: null, parcela_minima: 12,
      parcela_maxima: 360, valor_minimo: null, valor_minimo_flex: 2500,
    },
  }])
})

test('Super: modelo com variável fora da lista não é publicado; liberar exige a confirmação jurídica', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, SUPER, 'super@e2e.test', 'super')
  await page.route('**/rest/v1/contrato_modelos**', (r) => responderRest(r, [{
    id: 'm1', chave: 'parcelado', versao: 1, titulo: 'MODELO PROVISÓRIO — Aquisição, plano parcelado',
    conteudo: '# Contrato {{codigo}}\n\nComprador: **{{nome}}**, CPF {{cpf-cnpj}}.', variaveis: ['codigo', 'cpf-cnpj', 'nome'],
    revisado_juridico: false, liberado_para_envio: false, liberado_por: null, liberado_em: null,
    publicado_em: '2026-09-28T00:00:00Z', publicado_por: null,
  }]))
  const publicar = await simularRpc(page, 'config_publicar_modelo', 'm2')
  const liberar = await simularRpc(page, 'config_liberar_modelo', null)
  await page.goto('/admin/configuracoes/modelos')
  const editor = page.getByLabel('Texto (marcação restrita)')
  await expect(editor).toHaveValue(/Comprador/, ESPERA)
  await expect(page.getByText('Comprador:')).toBeVisible()
  await editor.fill('# Contrato {{codigo}}\n\nSenha: {{senha}} e mais texto para passar do mínimo.')
  await expect(page.getByText(/Variáveis fora da lista: senha/)).toBeVisible()
  await page.getByRole('button', { name: 'Publicar nova versão' }).click()
  await expect(page.getByText('Corrija as variáveis antes de publicar.')).toBeVisible(ESPERA)
  expect(publicar).toEqual([])

  await page.getByRole('button', { name: 'Liberar para envio' }).click()
  const modal = page.getByRole('dialog', { name: /Liberar/ })
  await expect(modal.getByRole('button', { name: 'Liberar para envio' })).toBeDisabled()
  await modal.getByRole('checkbox').check()
  await modal.getByRole('button', { name: 'Liberar para envio' }).click()
  await expect(page.getByText('Modelo liberado para envio.')).toBeVisible(ESPERA)
  expect(liberar).toEqual([{ p_id: 'm1', p_revisado_juridico: true }])
})

test('lista de contratos: filtros vão para o servidor e o link abre o contrato', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor')
  const item: ContratoResumo = {
    id: K, codigo: 123, cliente: { id: CLIENTE, nome: 'Maria Compradora' }, status: 'em_analise', forma_pagamento: 'parcelado',
    produto: PRODUTO, valor_imovel: 500000, n_parcelas: 60, valor_parcela: 1808.33, pdf_desatualizado: false,
    criado_em: '2026-09-28T10:00:00Z', enviado_assinatura_em: null, assinado_em: null, corretor: { id: 'p1', nome: 'Corretor E2E' }, gerente: null, imobiliaria: null,
  }
  const listar = await simularRpc(page, 'contratos_listar', { total: 1, itens: [item] })
  await page.goto('/parceiros/painel/contratos')
  await expect(page.getByRole('link', { name: '#0000123' })).toBeVisible(ESPERA)
  await page.getByRole('tab', { name: 'Em assinatura' }).click()
  await expect.poll(() => listar.at(-1)?.p_filtros).toMatchObject({ status: ['assinatura_pendente'], offset: 0 })
  await page.getByLabel('Buscar contrato').fill('#123')
  await expect.poll(() => listar.at(-1)?.p_filtros).toMatchObject({ busca: '#123' })
  await simularRpc(page, 'contrato_detalhe', detalhe({ status: 'em_analise' }))
  await page.getByRole('link', { name: '#0000123' }).click()
  await expect(page).toHaveURL(new RegExp(`/parceiros/painel/contratos/${K}$`), ESPERA)
  await expect(page.getByText('Em análise pela equipe Arken, que envia para assinatura.')).toBeVisible(ESPERA)
})

test('Super configura o e-mail do representante (D3); comprador e representante não podem ser desligados', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, SUPER, 'super@e2e.test', 'super')
  const alteracoes: { url: string; corpo: unknown }[] = []
  await page.route('**/rest/v1/contrato_signatario_regras**', async (r) => {
    if (r.request().method() === 'PATCH') {
      alteracoes.push({ url: r.request().url(), corpo: r.request().postDataJSON() })
      return r.fulfill({ status: 204, body: '' })
    }
    return responderRest(r, [
      { id: 'r1', modelo_chave: 'parcelado', ordem: 1, papel: 'cliente', fonte: 'cliente', nome: null, email: null, ato: 'assinar', ativo: true },
      { id: 'r2', modelo_chave: 'parcelado', ordem: 2, papel: 'representante_arken', fonte: 'fixo', nome: 'Representante Arken', email: null, ato: 'assinar', ativo: true },
      { id: 'r3', modelo_chave: 'parcelado', ordem: 3, papel: 'testemunha', fonte: 'fixo', nome: 'Testemunha 1', email: null, ato: 'testemunhar', ativo: false },
    ])
  })
  await page.goto('/admin/configuracoes/signatarios')
  const comprador = page.getByRole('form', { name: 'Regra 1' })
  const representante = page.getByRole('form', { name: 'Regra 2' })
  await expect(representante.getByText('Sem e-mail: bloqueia o envio')).toBeVisible(ESPERA)
  await expect(comprador.getByRole('checkbox')).toHaveCount(0)
  await expect(representante.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('form', { name: 'Regra 3' }).getByRole('checkbox')).toHaveCount(1)
  await expect(comprador.getByLabel('Ato')).toHaveCount(0)
  await expect(representante.getByLabel('Ato')).toHaveCount(0)
  await expect(page.getByRole('form', { name: 'Regra 3' }).getByLabel('Ato')).toHaveCount(1)
  await representante.getByLabel('E-mail').fill('Rep@Arken.test')
  await representante.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Regra salva.')).toBeVisible(ESPERA)
  expect(alteracoes).toHaveLength(1)
  expect(alteracoes[0].url).toContain('id=eq.r2')
  expect(alteracoes[0].corpo).toEqual({ ordem: 2, ato: 'assinar', ativo: true, nome: 'Representante Arken', email: 'rep@arken.test' })
})

test('busca de unidade vai para o servidor: identificador ou nome do empreendimento, sem diferença de acento (WP4R-06)', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Corretor E2E' })
  await page.route('**/rest/v1/parametros_simulacao**', (r) => responderRest(r, [PARAMETROS]))
  const urls: string[] = []
  await page.route('**/rest/v1/unidades**', (r) => {
    const url = decodeURIComponent(r.request().url())
    urls.push(url)
    // quem filtra é o servidor: aqui só a consulta pelo nome do empreendimento encontra a unidade
    const porEmpreendimento = url.includes('empreendimentos.nome=imatch.')
    return responderRest(r, porEmpreendimento
      ? [{ id: UNIDADE, identificador: 'APTO 301', valor: 500000, empreendimentos: { id: EMPREENDIMENTO, nome: 'Residencial São João' } }]
      : [])
  })
  await simularRpc(page, 'contratos_listar', { total: 0, itens: [] })
  await simularRpc(page, 'crm_clientes_opcoes', [])
  await page.goto('/parceiros/painel/contratos')
  await page.getByRole('button', { name: 'Novo contrato' }).click()
  const modal = page.getByRole('dialog', { name: 'Novo contrato' })
  await expect(modal.getByText('Nenhum produto disponível com essa busca.')).toBeVisible(ESPERA)
  await modal.getByLabel('Buscar produto').fill('sao joao')
  await expect(modal.getByRole('button', { name: /Residencial São João · APTO 301/ })).toBeVisible(ESPERA)
  const filtradas = urls.filter((u) => u.includes('imatch.'))
  expect(filtradas.some((u) => u.includes('identificador=imatch.s[aáàâãä][oóòôõö]\\s+j[oóòôõö][aáàâãä][oóòôõö]'))).toBe(true)
  expect(filtradas.some((u) => u.includes('empreendimentos.nome=imatch.s[aáàâãä][oóòôõö]\\s+j'))).toBe(true)
  expect(urls.every((u) => u.includes('status=neq.vendida') && u.includes('limit=50') && u.includes('empreendimentos!inner'))).toBe(true)
})

test('prévia: erro ao ler os parâmetros tem "Tentar de novo"; sem parâmetros vigentes avisa (WP4R-07)', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Corretor E2E' })
  let resposta: 'erro' | 'ok' | 'vazio' = 'erro'
  await page.route('**/rest/v1/parametros_simulacao**', (r) => resposta === 'erro'
    ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'falha', details: null, hint: null }) })
    : responderRest(r, resposta === 'vazio' ? [] : [PARAMETROS]))
  await simularRpc(page, 'contrato_detalhe', detalhe())
  await page.goto(`/parceiros/painel/contratos/${K}`)
  const tentar = page.getByRole('button', { name: 'Tentar de novo' })
  await expect(tentar).toBeVisible(ESPERA)
  await expect(page.getByText('Carregando os parâmetros…')).toHaveCount(0)
  resposta = 'ok'
  await tentar.click()
  await expect(page.getByLabel('Prévia da simulação').getByText(/60× de R\$\s1\.808,33/)).toBeVisible(ESPERA)

  resposta = 'vazio'
  await page.reload()
  await expect(page.getByText('Parâmetros de simulação não configurados. Fale com a equipe Arken.')).toBeVisible(ESPERA)
  await expect(page.getByText('Carregando os parâmetros…')).toHaveCount(0)
})

test('interno: envio em andamento trava a tela; versões anteriores vêm do bucket (números podem pular)', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ADMIN, 'admin@e2e.test', 'admin')
  await simularProdutos(page)
  await simularRpc(page, 'contrato_detalhe', detalhe({
    status: 'em_analise', envio_em_andamento: true, bloqueios_envio: [], destinos_status: [],
    pdf: { versao: 3, gerado_em: '2026-09-28T12:00:00Z', desatualizado: false, disponivel: true, versoes: [3, 1] },
    permissoes: { ...detalhe().permissoes, editar_simulacao: false, gerar_pdf: false, enviar_analise: false, enviar_assinatura: true, baixar_minuta: true },
  }))
  const baixar = await simularRpc(page, 'contrato_baixar', { bucket: 'contratos', path: `${K}/minuta-v1-aaaaaaaa.pdf`, expira_em: new Date(Date.now() + 60_000).toISOString() })
  await simularDownload(page)
  await page.goto(`/admin/contratos/${K}`)
  await expect(page.getByRole('status').filter({ hasText: 'Envio para assinatura em andamento' })).toBeVisible(ESPERA)
  await expect(page.getByRole('button', { name: 'Enviar para assinatura' })).toHaveCount(0)
  await expect(page.getByText(/Versão 3 · gerada em/)).toBeVisible()
  const versoes = page.getByLabel('Versão para baixar')
  await expect(versoes.locator('option')).toHaveText(['Versão atual', 'Versão 1'])
  await versoes.selectOption('1')
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Baixar' }).click()
  await (await popup).close()
  await expect.poll(() => baixar).toEqual([{ p_id: K, p_tipo: 'minuta', p_versao: 1 }])
})

test('Super: representante gravado como testemunha aparece com alerta e o salvar corrige para "assinar" (WP4R-05)', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, SUPER, 'super@e2e.test', 'super')
  const alteracoes: unknown[] = []
  await page.route('**/rest/v1/contrato_signatario_regras**', async (r) => {
    if (r.request().method() === 'PATCH') {
      alteracoes.push(r.request().postDataJSON())
      return r.fulfill({ status: 204, body: '' })
    }
    return responderRest(r, [
      { id: 'r1', modelo_chave: 'parcelado', ordem: 1, papel: 'cliente', fonte: 'cliente', nome: null, email: null, ato: 'assinar', ativo: true },
      { id: 'r2', modelo_chave: 'parcelado', ordem: 2, papel: 'representante_arken', fonte: 'fixo', nome: 'Representante Arken', email: 'rep@arken.test', ato: 'testemunhar', ativo: true },
    ])
  })
  await page.goto('/admin/configuracoes/signatarios')
  const representante = page.getByRole('form', { name: 'Regra 2' })
  await expect(representante.getByText('Gravada como testemunha: salve para corrigir')).toBeVisible(ESPERA)
  await expect(representante.getByLabel('Ato')).toHaveCount(0)
  await expect(representante.getByText('Assina', { exact: true })).toBeVisible()
  await representante.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Regra salva.')).toBeVisible(ESPERA)
  expect(alteracoes).toEqual([{ ordem: 2, ato: 'assinar', ativo: true, nome: 'Representante Arken', email: 'rep@arken.test' }])
})

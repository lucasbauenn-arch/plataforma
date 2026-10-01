import { expect, test, type Page } from '@playwright/test'
import { empreendimentoTeste, entrarComo, erroRpc, responderRest, simularDownload, simularRpc } from './apoio'

// Portal do cliente [WP6] (docs/ARQUITETURA_EXPANSAO.md §6.7, §7.2, §8.5, N1): dados pessoais e de CRM só pelas RPCs
// portal_* (auditadas no servidor); documentos só para ENVIO (sem download dos pessoais); contratos só a partir de
// assinatura_pendente, com download só do PDF assinado (portal_contrato_baixar + Edge baixar-arquivo). Negócios,
// arquivos e obra continuam pelas tabelas de exibição. Rede do Supabase simulada: nada chega ao banco.

// com vários workers (e outros servidores de desenvolvimento na máquina) o Vite compila as telas sob demanda: a
// primeira carga de cada página pode passar de 15 s
test.describe.configure({ timeout: 120_000 })
const ESPERA = { timeout: 40_000 }

const TITULAR = 'a6000000-0000-4000-8000-0000000000c1'
const CLIENTE = 'd6000000-0000-4000-8000-000000000001'
const DOC_RG = 'f6000000-0000-4000-8000-000000000301'
const DOC_CNH = 'f6000000-0000-4000-8000-000000000302'
const DOC_RENDA = 'f6000000-0000-4000-8000-000000000303'
const CTR_PENDENTE = 'f6000000-0000-4000-8000-000000000402'
const CTR_ASSINADO = 'f6000000-0000-4000-8000-000000000403'
const URL_PDF = 'https://arquivos.e2e.test/assinado.pdf'
const SOL_1 = 'f6000000-0000-4000-8000-000000000501'

/** portal_linha_do_tempo: o negócio 'n1' (mesmo id de cliente_negocios) com os quatro marcos. */
const LINHA_DO_TEMPO = [{
  negocio_id: 'n1', titulo: 'Residencial E2E — APTO 12', empreendimento_id: empreendimentoTeste.id, obra_percentual: 35,
  marcos: [
    { tipo: 'contrato_assinado', data_prevista: null, data_realizada: '2026-09-20', origem: 'contrato', observacao: null },
    { tipo: 'obra', data_prevista: '2027-02-01', data_realizada: null, origem: null, observacao: null },
    { tipo: 'vistoria', data_prevista: '2027-03-10', data_realizada: null, origem: null, observacao: 'A equipe confirma o horário.' },
    { tipo: 'entrega_chaves', data_prevista: null, data_realizada: null, origem: null, observacao: null },
  ],
}]

const solicitacao = (id: string, numero: number, extra: Record<string, unknown> = {}) => ({
  id, numero, tipo: 'segunda_via_boleto', negocio: null, mensagem: null, status: 'concluida',
  resposta: 'Enviamos a 2ª via para o seu e-mail.', criado_em: '2026-09-25T13:00:00Z', atualizado_em: '2026-09-26T13:00:00Z',
  concluida_em: '2026-09-26T13:00:00Z', ...extra,
})

const MEUS_DADOS = {
  id: CLIENTE, nome: 'Cliente', sobrenome: 'Portal', cpf: '12345670916', email: 'cliente@e2e.test', telefone: '11900000001',
  cep: '01001000', logradouro: 'Praça da Sé', numero: '10', complemento: null, bairro: 'Sé', cidade: 'São Paulo', uf: 'SP',
}
const CORRETOR = { nome: 'Carla Corretora', telefone: '11988887777', email: 'carla@e2e.test', creci: '123456-F', imobiliaria_nome: 'Imobiliária E2E', virtual: false }

const documento = (id: string, nome: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, tipo: 'cliente', nome, formatos_aceitos: ['jpeg', 'png', 'pdf'], status, motivo_rejeicao: null,
  pode_enviar: status === 'pendente' || status === 'rejeitado', ultimo_envio_em: null, max_bytes: 5 * 1024 * 1024, ...extra,
})

const contrato = (id: string, status: 'assinatura_pendente' | 'assinado', extra: Record<string, unknown> = {}) => ({
  id, codigo: status === 'assinado' ? 1203 : 1204, status, forma_pagamento: 'parcelado',
  produto: { tipo: 'unidade', nome: `Residencial E2E — APTO ${status === 'assinado' ? '12' : '13'}` },
  valor_imovel: 400000, n_parcelas: 60, valor_parcela: 1808.33,
  enviado_assinatura_em: '2026-09-19T13:00:00Z', assinado_em: status === 'assinado' ? '2026-09-20T13:00:00Z' : null,
  pdf_assinado_disponivel: status === 'assinado', ...extra,
})

/** Nenhuma requisição sai para o Supabase real (rotas específicas registradas depois têm precedência). */
async function isolarRede(page: Page) {
  await page.route('**/rest/v1/**', (r) => r.request().method() === 'GET'
    ? responderRest(r, [])
    : r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'não simulado', details: null, hint: null }) }))
  await page.route('**/storage/v1/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"não simulado"}' }))
  await page.route('**/functions/v1/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"erro":"não simulado"}' }))
}

/** Titular logado (perfil cliente) + portal simulado. Devolve os registros das chamadas. */
async function abrirPortal(page: Page, o: { documentos?: unknown[]; contratos?: unknown[]; meusDados?: unknown } = {}) {
  await isolarRede(page)
  await entrarComo(page, TITULAR, `cliente-${CLIENTE}@portal.arkenincorporadora.com.br`, 'cliente', { nome: 'Cliente Portal' })
  const leiturasClientes: string[] = []
  await page.route('**/rest/v1/clientes**', (r) => { leiturasClientes.push(r.request().url()); return responderRest(r, []) })
  await page.route('**/rest/v1/cliente_negocios**', (r) => responderRest(r, [{
    id: 'n1', cliente_id: CLIENTE, empreendimento_id: empreendimentoTeste.id, unidade_id: null, valor: 400000, descricao: null,
    created_at: '2026-09-01', empreendimentos: { nome: 'Residencial E2E', slug: 'residencial-e2e', capa_url: null },
    unidades: { identificador: 'APTO 12', metragem: 45 },
  }]))
  await page.route('**/rest/v1/cliente_arquivos**', (r) => responderRest(r, [
    { id: 'arq1', cliente_id: CLIENTE, nome: 'Manual do proprietário.pdf', storage_path: `${CLIENTE}/manual.pdf`, created_at: '2026-09-02' },
  ]))
  await page.route('**/rest/v1/obra_atualizacoes**', (r) => responderRest(r, [
    { id: 'o1', empreendimento_id: empreendimentoTeste.id, percentual: 35, titulo: 'Estrutura', descricao: null, fotos: [], data: '2026-09-10' },
  ]))
  const dados = await simularRpc(page, 'portal_meus_dados', o.meusDados === undefined ? MEUS_DADOS : o.meusDados)
  const corretor = await simularRpc(page, 'portal_meu_corretor', CORRETOR)
  const docs = { lista: o.documentos ?? [documento(DOC_CNH, 'CNH', 'rejeitado', { motivo_rejeicao: 'Foto ilegível' }), documento(DOC_RG, 'RG', 'pendente'), documento(DOC_RENDA, 'Comprovante de renda', 'aprovado', { ultimo_envio_em: '2026-09-10T13:00:00Z' })] }
  const documentos = await simularRpc(page, 'portal_documentos', () => docs.lista)
  const contratos = await simularRpc(page, 'portal_contratos', o.contratos ?? [contrato(CTR_ASSINADO, 'assinado'), contrato(CTR_PENDENTE, 'assinatura_pendente')])
  const linhaDoTempo = await simularRpc(page, 'portal_linha_do_tempo', LINHA_DO_TEMPO)
  const sols = { lista: [solicitacao(SOL_1, 12)] as unknown[] }
  const solicitacoes = await simularRpc(page, 'portal_solicitacoes', () => sols.lista)
  return { dados, corretor, documentos, contratos, linhaDoTempo, solicitacoes, sols, docs, leiturasClientes }
}

test('titular vê os próprios dados, o corretor, documentos, contratos, imóvel e obra (tudo pelas RPCs do portal)', async ({ page }) => {
  const s = await abrirPortal(page)
  await page.goto('/portal-do-cliente/meus-imoveis')

  await expect(page.getByRole('heading', { name: 'Bem-vindo(a), Cliente' })).toBeVisible(ESPERA)
  // negócios e obra continuam como hoje
  await expect(page.getByRole('heading', { name: 'Residencial E2E' })).toBeVisible()
  await expect(page.getByText('35%', { exact: true })).toBeVisible()
  await expect(page.getByText('Manual do proprietário.pdf')).toBeVisible()

  const meusDados = page.getByRole('region', { name: 'Meus dados' })
  await expect(meusDados.getByText('Cliente Portal')).toBeVisible()
  await expect(meusDados.getByText('123.456.709-16')).toBeVisible()
  await expect(meusDados.getByText('cliente@e2e.test')).toBeVisible()

  const atendimento = page.getByRole('region', { name: 'Seu atendimento' })
  await expect(atendimento.getByText('Carla Corretora')).toBeVisible()
  await expect(atendimento.getByText('CRECI 123456-F')).toBeVisible()

  const contratos = page.getByRole('region', { name: 'Meus contratos' })
  await expect(contratos.getByText('Residencial E2E — APTO 12')).toBeVisible()
  await expect(contratos.getByText('Residencial E2E — APTO 13')).toBeVisible()
  // download só do assinado
  await expect(contratos.getByRole('button', { name: 'Baixar PDF assinado' })).toHaveCount(1)
  await expect(contratos.getByText(/Enviado para assinatura em/)).toBeVisible()

  const documentos = page.getByRole('region', { name: /Documentos solicitados/ })
  await expect(documentos.getByText('2 para enviar')).toBeVisible()
  await expect(documentos.getByText('Foto ilegível')).toBeVisible()
  await expect(documentos.getByText('Reenviar CNH')).toBeVisible()
  await expect(documentos.getByText('Enviar RG')).toBeVisible()
  // o aprovado não pede envio e NENHUM documento pessoal tem download
  await expect(documentos.getByText('Enviar Comprovante de renda')).toHaveCount(0)
  await expect(documentos.getByRole('button', { name: /baixar/i })).toHaveCount(0)
  await expect(documentos.getByRole('link', { name: /baixar/i })).toHaveCount(0)
  await expect(documentos.getByText('Por segurança, os documentos enviados não ficam disponíveis para download aqui.')).toBeVisible()

  // as RPCs do portal não recebem id de cliente e a tabela clientes nunca é lida direto
  for (const chamadas of [s.dados, s.corretor, s.documentos, s.contratos, s.linhaDoTempo, s.solicitacoes]) expect(chamadas[0]).toEqual({})
  expect(s.leiturasClientes).toEqual([])
})

test('envia um documento solicitado: sobe para crm-documentos e registra o envio no servidor', async ({ page }) => {
  const s = await abrirPortal(page)
  const uploads: { url: string; metodo: string }[] = []
  await page.route('**/storage/v1/object/crm-documentos/**', async (r) => {
    uploads.push({ url: r.request().url(), metodo: r.request().method() })
    const caminho = decodeURIComponent(new URL(r.request().url()).pathname.split('/object/')[1] ?? '')
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: caminho, Id: 'obj-1' }) })
  })
  const registros = await simularRpc(page, 'crm_documento_registrar_envio', () => {
    s.docs.lista = s.docs.lista.map((d) => ((d as { id: string }).id === DOC_RG ? documento(DOC_RG, 'RG', 'em_analise', { ultimo_envio_em: new Date().toISOString() }) : d))
    return null
  })

  await page.goto('/portal-do-cliente/meus-imoveis')
  const documentos = page.getByRole('region', { name: /Documentos solicitados/ })
  await expect(documentos.getByText('Enviar RG')).toBeVisible(ESPERA)
  await documentos.getByLabel('Enviar RG').setInputFiles({ name: 'meu-rg.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') })

  await expect(page.getByText('Documento enviado para análise.')).toBeVisible(ESPERA)
  expect(uploads).toHaveLength(1)
  expect(uploads[0].metodo).toBe('POST')
  expect(registros).toHaveLength(1)
  expect(registros[0].p_documento_id).toBe(DOC_RG)
  // caminho sem dado pessoal: <cliente>/<documento>/<uuid>.pdf (o nome do arquivo não vai para o bucket)
  expect(registros[0].p_path).toMatch(new RegExp(`^${CLIENTE}/${DOC_RG}/[0-9a-f-]{36}\\.pdf$`))
  expect(decodeURIComponent(uploads[0].url)).toContain(String(registros[0].p_path))
  expect(uploads[0].url).not.toContain('meu-rg')
  // a lista é relida: o RG saiu de "para enviar"
  await expect(documentos.getByText('Enviar RG')).toHaveCount(0, ESPERA)
  await expect(documentos.getByText('1 para enviar')).toBeVisible()
})

test('formato não aceito é recusado antes de subir; falha do servidor mostra a mensagem', async ({ page }) => {
  await abrirPortal(page)
  let uploads = 0
  await page.route('**/storage/v1/object/crm-documentos/**', (r) => {
    uploads++
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"x","Id":"y"}' })
  })
  await simularRpc(page, 'crm_documento_registrar_envio', erroRpc('P0001', 'O arquivo passa do tamanho permitido.'))

  await page.goto('/portal-do-cliente/meus-imoveis')
  const documentos = page.getByRole('region', { name: /Documentos solicitados/ })
  await expect(documentos.getByText('Enviar RG')).toBeVisible(ESPERA)
  await documentos.getByLabel('Enviar RG').setInputFiles({ name: 'planilha.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('x') })
  await expect(page.getByText('Formato não aceito. Envie JPEG, PNG ou PDF.')).toBeVisible(ESPERA)
  expect(uploads).toBe(0)

  await documentos.getByLabel('Enviar RG').setInputFiles({ name: 'rg.png', mimeType: 'image/png', buffer: Buffer.from('png') })
  await expect(page.getByText('O arquivo passa do tamanho permitido.')).toBeVisible(ESPERA)
  expect(uploads).toBe(1)
})

test('limite de envio configurado pelo Super: o arquivo maior nem sobe (nada fica órfão no bucket)', async ({ page }) => {
  await abrirPortal(page, { documentos: [documento(DOC_RG, 'RG', 'pendente', { max_bytes: 1024 * 1024 })] })
  let uploads = 0
  await page.route('**/storage/v1/object/crm-documentos/**', (r) => {
    uploads++
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"x","Id":"y"}' })
  })
  const registros = await simularRpc(page, 'crm_documento_registrar_envio', null)

  await page.goto('/portal-do-cliente/meus-imoveis')
  const documentos = page.getByRole('region', { name: /Documentos solicitados/ })
  await expect(documentos.getByText(/até 1 MB/)).toBeVisible(ESPERA)
  await documentos.getByLabel('Enviar RG').setInputFiles({ name: 'rg.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1024 * 1024 + 1, 1) })
  await expect(page.getByText('O arquivo passa de 1 MB.')).toBeVisible(ESPERA)
  expect(uploads).toBe(0)
  expect(registros).toHaveLength(0)
})

test('baixa só o PDF assinado do próprio contrato (autorização do servidor + URL curta)', async ({ page }) => {
  await abrirPortal(page)
  const autorizacao = { bucket: 'contratos', path: `${CTR_ASSINADO}/assinado-0123abcd.pdf`, expira_em: new Date(Date.now() + 60_000).toISOString() }
  const baixas = await simularRpc(page, 'portal_contrato_baixar', autorizacao)
  const pedidos = await simularDownload(page, URL_PDF)
  await page.context().route('https://arquivos.e2e.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: 'PDF assinado (e2e)' }))

  await page.goto('/portal-do-cliente/meus-imoveis')
  const contratos = page.getByRole('region', { name: 'Meus contratos' })
  const popup = page.waitForEvent('popup')
  await contratos.getByRole('button', { name: 'Baixar PDF assinado' }).click(ESPERA)
  const janela = await popup
  await janela.waitForURL(URL_PDF, ESPERA)

  expect(baixas).toEqual([{ p_id: CTR_ASSINADO }])
  expect(pedidos).toEqual([{ bucket: 'contratos', path: autorizacao.path }])
})

test('download negado pelo servidor: a janela fecha e a mensagem aparece', async ({ page }) => {
  await abrirPortal(page)
  await simularRpc(page, 'portal_contrato_baixar', null)
  await page.goto('/portal-do-cliente/meus-imoveis')
  const contratos = page.getByRole('region', { name: 'Meus contratos' })
  const popup = page.waitForEvent('popup')
  await contratos.getByRole('button', { name: 'Baixar PDF assinado' }).click(ESPERA)
  const janela = await popup
  await expect(page.getByText('O PDF assinado não está disponível.')).toBeVisible(ESPERA)
  await expect.poll(() => janela.isClosed(), ESPERA).toBe(true)
})

test('sem contrato a partir do envio, a seção de contratos não aparece; Carteira Arken mostra o atendimento da empresa', async ({ page }) => {
  await abrirPortal(page, { contratos: [] })
  await page.route(/\/rest\/v1\/rpc\/portal_meu_corretor(\?|$)/, (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ nome: 'Carteira Arken', telefone: null, email: null, creci: null, imobiliaria_nome: 'Imobiliária Arken', virtual: true }),
  }))
  await page.goto('/portal-do-cliente/meus-imoveis')
  await expect(page.getByRole('heading', { name: 'Bem-vindo(a), Cliente' })).toBeVisible(ESPERA)
  const atendimento = page.getByRole('region', { name: 'Seu atendimento' })
  await expect(atendimento.getByText('Equipe de atendimento')).toBeVisible(ESPERA)
  await expect(atendimento.getByText('Carteira Arken')).toHaveCount(0)
  await expect(page.getByRole('region', { name: /Meus? contratos?/ })).toHaveCount(0)
})

test('portal não liberado (ou cadastro inativo): "Cadastro não encontrado" e nada mais é consultado', async ({ page }) => {
  const s = await abrirPortal(page, { meusDados: null })
  await page.goto('/portal-do-cliente/meus-imoveis')
  await expect(page.getByText('Cadastro não encontrado')).toBeVisible(ESPERA)
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible()
  expect(s.corretor).toHaveLength(0)
  expect(s.documentos).toHaveLength(0)
  expect(s.contratos).toHaveLength(0)
})

test('parceiro que digita o endereço do portal não vê o portal', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, 'a6000000-0000-4000-8000-0000000000c9', 'corretor@e2e.test', 'corretor')
  const dados = await simularRpc(page, 'portal_meus_dados', MEUS_DADOS)
  await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, [empreendimentoTeste]))
  await page.goto('/portal-do-cliente/meus-imoveis')
  await expect(page).toHaveURL(/\/parceiros\/painel/, ESPERA)
  expect(dados).toHaveLength(0)
})

test('linha do tempo da compra: marcos com as datas da equipe e a do contrato assinado', async ({ page }) => {
  await abrirPortal(page)
  await page.goto('/portal-do-cliente/meus-imoveis')
  const linha = page.getByRole('region', { name: 'Linha do tempo da compra: Residencial E2E — APTO 12' })
  await expect(linha).toBeVisible(ESPERA)
  const marcos = linha.getByRole('listitem')
  await expect(marcos).toHaveCount(4)
  await expect(marcos.nth(0)).toContainText('Contrato assinado')
  await expect(marcos.nth(0)).toContainText('Realizado em 20/09/2026')
  await expect(marcos.nth(1)).toContainText('Previsto para 01/02/2027')
  await expect(marcos.nth(1)).toContainText('Andamento: 35%')
  await expect(marcos.nth(2)).toContainText('Previsto para 10/03/2027')
  await expect(marcos.nth(2)).toContainText('A equipe confirma o horário.')
  await expect(marcos.nth(3)).toContainText('Entrega das chaves')
  await expect(marcos.nth(3)).toContainText('Data a definir')
  // o contrato continua com o PDF assinado para baixar
  await expect(page.getByRole('region', { name: 'Meus contratos' }).getByRole('button', { name: 'Baixar PDF assinado' })).toHaveCount(1)
})

test('solicitar: valida o formulário, envia pela RPC e mostra o pedido com o status; a resposta da equipe aparece', async ({ page }) => {
  const s = await abrirPortal(page)
  const envios = await simularRpc(page, 'portal_solicitar', (a: Record<string, unknown>) => {
    s.sols.lista = [solicitacao('f6000000-0000-4000-8000-000000000502', 13, {
      tipo: a.p_tipo, negocio: { id: 'n1', titulo: 'Residencial E2E — APTO 12' }, mensagem: a.p_mensagem, status: 'aberta',
      resposta: null, criado_em: new Date().toISOString(), atualizado_em: null, concluida_em: null,
    }), ...s.sols.lista]
    return 'f6000000-0000-4000-8000-000000000502'
  })
  await page.goto('/portal-do-cliente/meus-imoveis')
  const secao = page.getByRole('region', { name: 'Solicitações' })
  await expect(secao.getByRole('listitem').first()).toContainText('2ª via de boleto', ESPERA)
  await expect(secao.getByText('Enviamos a 2ª via para o seu e-mail.')).toBeVisible()
  await expect(secao.getByText('Concluída')).toBeVisible()

  await secao.getByRole('button', { name: 'Solicitar' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Nova solicitação' })
  await dialogo.getByRole('button', { name: 'Enviar solicitação' }).click()
  await expect(dialogo.getByText('Escolha o tipo de solicitação.')).toBeVisible()
  await dialogo.getByLabel(/O que você precisa/).selectOption({ label: 'Outro assunto' })
  await dialogo.getByRole('button', { name: 'Enviar solicitação' }).click()
  await expect(dialogo.getByText('Conte o que você precisa.')).toBeVisible()
  expect(envios).toHaveLength(0)

  await dialogo.getByLabel(/O que você precisa/).selectOption({ label: 'Agendar vistoria' })
  await expect(dialogo.getByLabel('Sobre qual imóvel?')).toHaveValue('n1')
  await dialogo.getByLabel('Mensagem').fill('  Sábado de manhã, se possível  ')
  await dialogo.getByRole('button', { name: 'Enviar solicitação' }).click()
  await expect(page.getByText('Solicitação enviada. A equipe Arken vai responder por aqui.')).toBeVisible(ESPERA)
  await expect(dialogo).toBeHidden()
  expect(envios).toEqual([{ p_tipo: 'agendar_vistoria', p_negocio_id: 'n1', p_mensagem: 'Sábado de manhã, se possível' }])
  // a lista é relida do servidor
  await expect(secao.getByRole('listitem').first()).toContainText('Agendar vistoria', ESPERA)
  await expect(secao.getByText('Aberta', { exact: true })).toBeVisible()
  await expect(secao.getByText('nº 000013')).toBeVisible()
})

test('solicitar: o limite do servidor aparece como mensagem e nada muda na lista', async ({ page }) => {
  await abrirPortal(page)
  await simularRpc(page, 'portal_solicitar', erroRpc('P0001', 'Você já fez 5 solicitações nas últimas 24 horas. Aguarde o retorno da equipe.'))
  await page.goto('/portal-do-cliente/meus-imoveis')
  const secao = page.getByRole('region', { name: 'Solicitações' })
  await secao.getByRole('button', { name: 'Solicitar' }).click(ESPERA)
  const dialogo = page.getByRole('dialog', { name: 'Nova solicitação' })
  await dialogo.getByLabel(/O que você precisa/).selectOption({ label: '2ª via de boleto' })
  await dialogo.getByRole('button', { name: 'Enviar solicitação' }).click()
  await expect(page.getByText('Você já fez 5 solicitações nas últimas 24 horas. Aguarde o retorno da equipe.')).toBeVisible(ESPERA)
  await expect(dialogo).toBeVisible()
})

test('equipe: fila de solicitações em Clientes com portal; concluir exige resposta e vai pela RPC', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, 'a6000000-0000-4000-8000-0000000000a9', 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  const item = {
    ...solicitacao(SOL_1, 12, { tipo: 'agendar_vistoria', mensagem: 'Sábado de manhã', status: 'aberta', resposta: null,
      atualizado_em: null, concluida_em: null, negocio: { id: 'n1', titulo: 'Residencial E2E — APTO 12' } }),
    cliente: { id: CLIENTE, nome: 'Cliente Portal' }, atualizado_por: null,
  }
  const listas = await simularRpc(page, 'crm_portal_solicitacoes', { total: 1, itens: [item] })
  const atualizacoes = await simularRpc(page, 'crm_portal_solicitacao_atualizar', null)

  await page.goto('/admin/clientes?aba=solicitacoes')
  await expect(page.getByRole('tab', { name: 'Solicitações' })).toHaveAttribute('aria-selected', 'true', ESPERA)
  await expect(page.getByRole('link', { name: 'Cliente Portal' })).toBeVisible(ESPERA)
  expect(listas[0]).toEqual({ p_filtros: { abertas: true, cliente_id: null, limite: 50, offset: 0 } })

  await page.getByRole('button', { name: 'Atender Agendar vistoria nº 000012' }).click()
  const dialogo = page.getByRole('dialog')
  await dialogo.getByLabel(/Status/).selectOption({ label: 'Concluída' })
  await dialogo.getByRole('button', { name: 'Salvar' }).click()
  await expect(dialogo.getByText('Escreva a resposta ao cliente para concluir.')).toBeVisible()
  expect(atualizacoes).toHaveLength(0)
  await dialogo.getByLabel(/Resposta ao cliente/).fill('Vistoria marcada para 10/03, às 9h.')
  await dialogo.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Solicitação concluída. O cliente vê a resposta no portal.')).toBeVisible(ESPERA)
  expect(atualizacoes).toEqual([{ p_id: SOL_1, p_status: 'concluida', p_resposta: 'Vistoria marcada para 10/03, às 9h.' }])
})

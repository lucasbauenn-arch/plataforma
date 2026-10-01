import { expect, test, type Page } from '@playwright/test'
import { entrarComo, erroRpc, responderRest, simularRpc } from './apoio'

// Permissões, governança e configurações [WP6] (docs/ARQUITETURA_EXPANSAO.md §1.1 H5, §1.2 N2, N10, N20, §4.4, §7.2,
// §7.3, §8.5): menu por papel (o menu nunca é a única barreira), colaborador sem acesso, 2FA exigida levando a
// Segurança, visão geral por painel_resumo, auditoria por auditoria_consultar e as telas do Super (geral, transições,
// permissões, notificações, termos, equipe e anonimização). Rede do Supabase simulada: nada chega ao banco.

// com vários workers (e outros servidores de desenvolvimento na máquina) o Vite compila as telas sob demanda: a
// primeira carga de cada página pode passar de 15 s
test.describe.configure({ timeout: 120_000 })
const ESPERA = { timeout: 40_000 }

const ID_CORRETOR = 'a6100000-0000-4000-8000-0000000000c1'
const ID_GERENTE = 'a6100000-0000-4000-8000-0000000000e1'
const ID_COLAB = 'a6100000-0000-4000-8000-0000000000b1'
const ID_ADMIN = 'a6100000-0000-4000-8000-0000000000ad'
const ID_SUPER = 'a6100000-0000-4000-8000-0000000000af'
const ID_OUTRO_ADMIN = 'a6100000-0000-4000-8000-0000000000a2'
const CLIENTE = 'd6100000-0000-4000-8000-000000000001'
const CONSENTIMENTO = 'f6100000-0000-4000-8000-000000000501'

/** Nenhuma requisição sai para o Supabase real (rotas específicas registradas depois têm precedência). */
async function isolarRede(page: Page) {
  await page.route('**/rest/v1/**', (r) => r.request().method() === 'GET'
    ? responderRest(r, [])
    : r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'não simulado', details: null, hint: null }) }))
  await page.route('**/storage/v1/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"não simulado"}' }))
  await page.route('**/functions/v1/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"erro":"não simulado"}' }))
}

const menu = (page: Page) => page.getByRole('navigation', { name: 'Menu principal' })

// ============ menu e acesso por papel ============

test('corretor: menu sem Equipe e sem admin; /admin digitado volta para o painel; Equipe digitada é recusada', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ID_CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Carla Corretora' })
  await page.goto('/parceiros/painel')
  await expect(menu(page).getByRole('link', { name: 'Funil' })).toBeVisible(ESPERA)
  await expect(menu(page).getByRole('link', { name: 'Meu link' })).toBeVisible()
  await expect(menu(page).getByRole('link', { name: 'Equipe' })).toHaveCount(0)
  await expect(menu(page).getByRole('link', { name: 'Auditoria' })).toHaveCount(0)

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/parceiros\/painel$/, ESPERA)
  await page.goto('/admin/auditoria')
  await expect(page).toHaveURL(/\/parceiros\/painel$/, ESPERA)

  await page.goto('/parceiros/painel/equipe')
  await expect(page.getByText('Sem acesso a esta área')).toBeVisible(ESPERA)
})

test('gerente vê Equipe; parceiro nunca chega à auditoria nem às configurações', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ID_GERENTE, 'gerente@e2e.test', 'gerente', { nome: 'Gil Gerente' })
  const auditoria = await simularRpc(page, 'auditoria_consultar', { total: 0, itens: [] })
  await page.goto('/parceiros/painel')
  await expect(menu(page).getByRole('link', { name: 'Equipe' })).toBeVisible(ESPERA)
  await page.goto('/admin/configuracoes')
  await expect(page).toHaveURL(/\/parceiros\/painel$/, ESPERA)
  expect(auditoria).toHaveLength(0)
})

test('tela antiga de clientes do parceiro (parceiro_clientes) leva à lista do CRM', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ID_CORRETOR, 'corretor@e2e.test', 'corretor', { nome: 'Carla Corretora' })
  await page.goto('/parceiros/painel/clientes')
  await expect(page).toHaveURL(/\/parceiros\/painel\/crm\/lista$/, ESPERA)
  await expect(menu(page).getByRole('link', { name: 'Clientes', exact: true })).toBeVisible(ESPERA)
})

test('admin: /admin/parceiros leva à Rede; "Clientes do portal" volta ao menu', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ID_ADMIN, 'admin@e2e.test', 'admin', { nome: 'Ana Admin' })
  await page.goto('/admin/parceiros')
  await expect(page).toHaveURL(/\/admin\/rede$/, ESPERA)
  await expect(menu(page).getByRole('link', { name: 'Parceiros' })).toHaveCount(0)
  await menu(page).getByRole('link', { name: 'Clientes do portal' }).click()
  await expect(page).toHaveURL(/\/admin\/clientes$/, ESPERA)
  await expect(page.getByRole('heading', { name: 'Clientes com portal' })).toBeVisible(ESPERA)
})

test('colaborador vê "Acesso ainda não liberado" (A8)', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ID_COLAB, 'colab@e2e.test', 'colaborador')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Acesso ainda não liberado' })).toBeVisible(ESPERA)
  await expect(menu(page)).toHaveCount(0)
})

test('com a 2FA exigida e a sessão sem o código, o interno só abre Segurança (H5)', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ID_ADMIN, 'admin@e2e.test', 'admin', { extra: { mfa_exigido: true, aal: 'aal1' } })
  const painel = await simularRpc(page, 'painel_resumo', null)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin\/seguranca$/, ESPERA)
  await expect(page.getByText('A verificação em duas etapas é obrigatória para a equipe. Conclua a configuração abaixo')).toBeVisible(ESPERA)
  await expect(page.getByRole('heading', { name: 'Cadastre um aplicativo autenticador' })).toBeVisible(ESPERA)
  const itens = menu(page).getByRole('link')
  await expect(itens).toHaveCount(1)
  await expect(itens.first()).toHaveText(/Segurança/)
  await page.goto('/admin/auditoria')
  await expect(page).toHaveURL(/\/admin\/seguranca$/, ESPERA)
  expect(painel).toHaveLength(0)
})

// ============ admin: visão geral e auditoria ============

const RESUMO_ADMIN = {
  papel: 'admin',
  empreendimentos: { publicados: 3, unidades_disponiveis: 40 },
  crm: { total: 12, por_etapa: { novo_contato: 5, contato_iniciado: 3, documentacao: 2, finalizado: 1, perdido: 1 }, tarefas_pendentes: 4, tarefas_atrasadas: 2, documentos_em_analise: 1 },
  contratos: { por_status: { rascunho: 1, assinatura_pendente: 2, assinado: 3 } },
  imoveis: { por_status: { pendente: 2, aprovado: 5 } },
  propostas: { por_status: { enviada: 2, em_analise: 0, aprovada: 1, recusada: 0 } },
  rede: { imobiliarias: 2, gerentes: 3, corretores: 8, autocadastros_pendentes: 1 },
  leads: { novos: 4, total: 9 },
  duplicidades_pendentes: 1,
  migracao_pendencias: 0,
}

test('admin: visão geral por painel_resumo; sem Configurações (só o Super)', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ID_ADMIN, 'admin@e2e.test', 'admin', { nome: 'Ana Admin' })
  const chamadas = await simularRpc(page, 'painel_resumo', RESUMO_ADMIN)
  const contagensDiretas: string[] = []
  await page.route(/\/rest\/v1\/(clientes|leads|propostas|parceiro_clientes)(\?|$)/, (r) => { contagensDiretas.push(r.request().url()); return responderRest(r, []) })

  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible(ESPERA)
  const autocadastros = page.getByRole('link', { name: /Autocadastros aguardando aprovação/ })
  await expect(autocadastros).toContainText('1')
  await expect(autocadastros).toHaveAttribute('href', '/admin/rede/pendentes')
  await expect(page.getByRole('link', { name: /Tarefas atrasadas/ })).toContainText('4 pendentes')
  await expect(page.getByRole('link', { name: /Leads do site sem tratamento/ })).toContainText('9 no total')
  await expect(page.getByRole('link', { name: /Imobiliárias ativas/ })).toContainText('2')
  expect(chamadas).toEqual([{}])
  expect(contagensDiretas).toEqual([])

  await expect(menu(page).getByRole('link', { name: 'Auditoria' })).toBeVisible()
  await expect(menu(page).getByRole('link', { name: 'Configurações' })).toHaveCount(0)
  await page.goto('/admin/configuracoes/geral')
  await expect(page.getByText('Sem acesso a esta área')).toBeVisible(ESPERA)
})

test('visão geral: seção nula (sem a permissão no servidor) some da tela', async ({ page }) => {
  await isolarRede(page)
  // o servidor manda nulo nas seções sem permissão: a tela não inventa contagem
  await entrarComo(page, ID_ADMIN, 'admin@e2e.test', 'admin')
  await simularRpc(page, 'painel_resumo', { ...RESUMO_ADMIN, crm: null, rede: null, leads: null, duplicidades_pendentes: null })
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible(ESPERA)
  await expect(page.getByRole('heading', { name: 'Contratos' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'CRM' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Autocadastros aguardando/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Leads do site sem tratamento/ })).toHaveCount(0)
})

const ITEM_AUDITORIA = {
  id: 91, ocorrido_em: '2026-09-28T15:00:00Z', categoria: 'lgpd', acao: 'anonimizar', entidade: 'clientes', entidade_id: CLIENTE,
  cliente_id: CLIENTE, ator_id: ID_SUPER, ator_nome: 'Sara Super', ator_papel: 'super', ator_parceiro_id: null, origem: 'rpc',
  campos: ['nome', 'cpf', 'email'], antes: null, depois: null, detalhe: { protocolo: 'LGPD-2026-001', arquivos: 1 }, ip: '200.1.2.3', user_agent: 'Chrome',
}

test('admin lê a auditoria só pela RPC (a leitura também é registrada no servidor); filtros validados', async ({ page }) => {
  await isolarRede(page)
  await entrarComo(page, ID_ADMIN, 'admin@e2e.test', 'admin')
  const leiturasDiretas: string[] = []
  await page.route('**/rest/v1/auditoria**', (r) => { leiturasDiretas.push(r.request().url()); return responderRest(r, []) })
  const chamadas = await simularRpc(page, 'auditoria_consultar', (a: Record<string, unknown>) => ({
    total: (a.p_filtros as { categoria?: string }).categoria === 'lgpd' ? 1 : 2,
    itens: (a.p_filtros as { categoria?: string }).categoria === 'lgpd' ? [ITEM_AUDITORIA] : [ITEM_AUDITORIA, { ...ITEM_AUDITORIA, id: 90, categoria: 'acesso', acao: 'consultar', campos: null, detalhe: { total: 3 } }],
  }))

  await page.goto('/admin/auditoria')
  await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible(ESPERA)
  await expect(page.getByText('2 registro(s)')).toBeVisible(ESPERA)
  expect(chamadas[0]).toEqual({ p_filtros: {}, p_limite: 50, p_offset: 0 })

  // filtro inválido nem chega ao servidor
  await page.getByLabel('ID do cliente (titular)').fill('não-é-uuid')
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'ID do cliente inválido.' })).toBeVisible()
  expect(chamadas).toHaveLength(1)

  await page.getByLabel('ID do cliente (titular)').fill('')
  await page.getByLabel('Categoria').selectOption('lgpd')
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(page.getByText('1 registro(s)')).toBeVisible(ESPERA)
  expect(chamadas[chamadas.length - 1]).toEqual({ p_filtros: { categoria: 'lgpd' }, p_limite: 50, p_offset: 0 })

  await page.getByRole('button', { name: 'Detalhes' }).click()
  const gaveta = page.getByRole('dialog', { name: 'Registro de auditoria' })
  await expect(gaveta.getByText('Anonimizou')).toBeVisible()
  await expect(gaveta.getByText('cpf', { exact: true })).toBeVisible()
  await expect(gaveta.getByText('Valores pessoais nunca são gravados: só os nomes dos campos.')).toBeVisible()
  await expect(gaveta.getByText('LGPD-2026-001')).toBeVisible()
  expect(leiturasDiretas).toEqual([])
})

// ============ Super: configurações ============

const CONFIG = {
  id: true, imobiliaria_casa_id: 'b6100000-0000-4000-8000-000000000001', gerente_casa_id: 'c6100000-0000-4000-8000-000000000001',
  corretor_casa_id: 'c6100000-0000-4000-8000-000000000002', exclusividade_dias: 90, duplicidade_bloqueios_hora: 10,
  documentos_basicos: ['CPF', 'CNH', 'Comprovante de residência', 'Comprovante de renda'], documento_max_bytes: 5242880,
  portal_libera_pre_cadastro: false, vendedora_razao_social: null, vendedora_cnpj: null, vendedora_endereco: null,
  prazo_assinatura_dias: null, imovel_fotos_max: 20, imovel_foto_max_bytes: 5242880, exigir_mfa_interno: false,
  sessao_inatividade_horas: 8, retencao_acesso_meses: 24, retencao_operacao_meses: 60, download_ttl_segundos: 60,
  criado_em: '2026-09-28T00:00:00Z', atualizado_em: null, atualizado_por: null,
}

async function entrarSuper(page: Page) {
  await isolarRede(page)
  await entrarComo(page, ID_SUPER, 'super@e2e.test', 'super', { nome: 'Sara Super' })
}

test('Super: configurações com regras provisórias; a geral manda só o que mudou para config_atualizar', async ({ page }) => {
  await entrarSuper(page)
  await page.route('**/rest/v1/configuracao_geral**', (r) => responderRest(r, [CONFIG]))
  const envios = await simularRpc(page, 'config_atualizar', (a: Record<string, unknown>) =>
    (a.p as Record<string, unknown>).prazo_assinatura_dias === 30 ? erroRpc('P0001', 'DADOS_INVALIDOS', { campos: ['prazo_assinatura_dias'] }) : null)

  await page.goto('/admin/configuracoes')
  await expect(menu(page).getByRole('link', { name: 'Configurações' })).toBeVisible(ESPERA)
  await expect(page.getByRole('heading', { name: 'Regras provisórias' })).toBeVisible(ESPERA)
  await expect(page.getByText('H5', { exact: true }).first()).toBeVisible()

  await page.getByRole('link', { name: 'Geral', exact: true }).click()
  const exclusividade = page.getByLabel('Exclusividade sem atividade (dias)')
  await expect(exclusividade).toHaveValue('90', ESPERA)

  // validação local: fora da faixa nem chega ao servidor
  await exclusividade.fill('0')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Entre 1 e 3650')).toBeVisible()
  expect(envios).toHaveLength(0)

  await exclusividade.fill('120')
  await page.getByLabel('CNPJ da vendedora').fill('11222333000181')
  await expect(page.getByLabel('CNPJ da vendedora')).toHaveValue('11.222.333/0001-81')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Configurações salvas.')).toBeVisible(ESPERA)
  expect(envios[0]).toEqual({ p: { exclusividade_dias: 120, vendedora_cnpj: '11222333000181' } })

  // recusa do servidor aponta o campo
  await page.getByLabel('Prazo para assinatura (dias)').fill('30')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Alguns valores foram recusados. Confira os campos destacados.')).toBeVisible(ESPERA)
  await expect(page.getByText('Valor recusado pelo servidor')).toBeVisible()
})

test('Super: exigir a 2FA dos internos pede confirmação explícita', async ({ page }) => {
  await entrarSuper(page)
  await page.route('**/rest/v1/configuracao_geral**', (r) => responderRest(r, [CONFIG]))
  const envios = await simularRpc(page, 'config_atualizar', null)
  await page.goto('/admin/configuracoes/geral')
  await page.getByLabel('Exigir verificação em duas etapas da equipe interna').check(ESPERA)
  await page.getByRole('button', { name: 'Salvar' }).click()
  const modal = page.getByRole('dialog', { name: 'Exigir a verificação em duas etapas?' })
  await expect(modal).toBeVisible()
  expect(envios).toHaveLength(0)
  await modal.getByRole('button', { name: 'Exigir agora' }).click()
  await expect(page.getByText('Configurações salvas.')).toBeVisible(ESPERA)
  expect(envios).toEqual([{ p: { exigir_mfa_interno: true } }])
})

test('Super: matriz de permissões e e-mails automáticos gravam só a coluna editável', async ({ page }) => {
  await entrarSuper(page)
  const linhas = [
    { acao: 'convite_por_link', tipo: 'imobiliaria', permitido: false }, { acao: 'convite_por_link', tipo: 'gerente', permitido: false },
    { acao: 'cadastrar_cliente', tipo: 'imobiliaria', permitido: true }, { acao: 'cadastrar_cliente', tipo: 'gerente', permitido: true },
    { acao: 'cadastrar_cliente', tipo: 'corretor', permitido: true },
  ].map((l) => ({ ...l, criado_em: '2026-09-28T00:00:00Z', atualizado_em: null, atualizado_por: null }))
  const patches: { url: string; corpo: unknown }[] = []
  await page.route('**/rest/v1/permissoes_rede**', (r) => {
    if (r.request().method() === 'PATCH') {
      patches.push({ url: decodeURIComponent(r.request().url()), corpo: r.request().postDataJSON() })
      return responderRest(r, [{ acao: 'convite_por_link' }])
    }
    return responderRest(r, linhas)
  })
  await page.goto('/admin/configuracoes/permissoes')
  await expect(page.getByRole('cell', { name: 'Não se aplica' })).toHaveCount(1, ESPERA)
  // caixas controladas pelo dado do servidor: clicar (o estado só muda quando a lista volta)
  await page.getByLabel('Convite por link (WhatsApp/copiar) — Gerente').click()
  await expect(page.getByText('Convite por link (WhatsApp/copiar) · Gerente: ligado.')).toBeVisible(ESPERA)
  expect(patches).toHaveLength(1)
  expect(patches[0].corpo).toEqual({ permitido: true })
  expect(patches[0].url).toContain('acao=eq.convite_por_link')
  expect(patches[0].url).toContain('tipo=eq.gerente')

  const notif = [
    { tipo: 'crm.boas_vindas', ativo: true, descricao: 'Boas-vindas do pré-cadastro', criado_em: '2026-09-28T00:00:00Z', atualizado_em: null, atualizado_por: null },
    { tipo: 'crm.documento_solicitado', ativo: false, descricao: 'Documento solicitado', criado_em: '2026-09-28T00:00:00Z', atualizado_em: null, atualizado_por: null },
  ]
  const patchesNotif: unknown[] = []
  await page.route('**/rest/v1/notificacoes_config**', (r) => {
    if (r.request().method() === 'PATCH') {
      patchesNotif.push(r.request().postDataJSON())
      return responderRest(r, [{ tipo: 'crm.documento_solicitado' }])
    }
    return responderRest(r, notif)
  })
  await page.getByRole('link', { name: 'Notificações', exact: true }).click()
  await page.getByLabel('Enviar: Documento solicitado').click(ESPERA)
  await expect(page.getByText('E-mail ligado.')).toBeVisible(ESPERA)
  expect(patchesNotif).toEqual([{ ativo: true }])
})

test('Super: transições — papéis, motivo e ativa; linhas do D4Sign só do sistema', async ({ page }) => {
  await entrarSuper(page)
  const linha = (entidade: string, de: string, para: string, extra: Record<string, unknown> = {}) => ({
    entidade, de, para, papeis: ['super', 'admin', 'imobiliaria', 'gerente', 'corretor'], permite_criador: false, sistema: false,
    exige_motivo: false, validacoes: [], efeitos: [], ativa: true, atualizado_em: '2026-09-28T00:00:00Z', atualizado_por: null, ...extra,
  })
  const patches: { url: string; corpo: unknown }[] = []
  await page.route('**/rest/v1/status_transicoes**', (r) => {
    if (r.request().method() === 'PATCH') {
      patches.push({ url: decodeURIComponent(r.request().url()), corpo: r.request().postDataJSON() })
      return responderRest(r, [{ entidade: 'cliente_etapa' }])
    }
    return responderRest(r, [
      linha('cliente_etapa', 'novo_contato', 'contato_iniciado'),
      linha('contrato', 'em_analise', 'assinatura_pendente', { papeis: [], sistema: true, validacoes: ['pdf_gerado'], efeitos: ['imovel_no_contrato'] }),
    ])
  })
  await page.goto('/admin/configuracoes/transicoes')
  const nc = page.getByRole('form', { name: 'Transição Novo contato para Contato iniciado' })
  await expect(nc).toBeVisible(ESPERA)
  await nc.getByLabel('Corretor').uncheck()
  await nc.getByLabel('Exige motivo').check()
  await nc.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Transição atualizada.')).toBeVisible(ESPERA)
  expect(patches[0].corpo).toEqual({ papeis: ['super', 'admin', 'imobiliaria', 'gerente'], exige_motivo: true, ativa: true })
  expect(patches[0].url).toContain('entidade=eq.cliente_etapa')
  expect(patches[0].url).toContain('de=eq.novo_contato')
  expect(patches[0].url).toContain('para=eq.contato_iniciado')

  const envio = page.getByRole('form', { name: /Transição Em análise para/ })
  await expect(envio.getByText('Só o sistema (depende da assinatura eletrônica ou do envio do contrato).')).toBeVisible()
  await expect(envio.getByLabel('Corretor')).toHaveCount(0)
})

test('Super: publica nova versão do termo (somente inclusão, com confirmação)', async ({ page }) => {
  await entrarSuper(page)
  await page.route('**/rest/v1/lgpd_termos**', (r) => responderRest(r, [
    { id: 't1', tipo: 'consentimento_cliente', versao: '0-provisória', texto: 'Texto provisório do consentimento.', vigente_desde: '2026-09-28T00:00:00Z', revisado_juridico: false, criado_em: '2026-09-28T00:00:00Z' },
    { id: 't2', tipo: 'termos_parceiro', versao: '0-provisória', texto: 'Texto provisório dos termos.', vigente_desde: '2026-09-28T00:00:00Z', revisado_juridico: false, criado_em: '2026-09-28T00:00:00Z' },
  ]))
  const publicacoes = await simularRpc(page, 'lgpd_publicar_termo', null)
  await page.goto('/admin/configuracoes/termos')
  await expect(page.getByText('O pré-cadastro público fica fechado até publicar uma versão revisada.')).toBeVisible(ESPERA)
  await page.getByRole('textbox', { name: /^Versão/ }).fill('1.0')
  await page.getByRole('textbox', { name: /^Texto/ }).fill('Consentimento revisado pelo jurídico para o tratamento de dados pessoais.')
  await page.getByLabel('Texto revisado e aprovado pelo jurídico').check()
  await page.getByRole('button', { name: 'Publicar' }).click()
  const modal = page.getByRole('dialog', { name: 'Publicar nova versão?' })
  await expect(modal).toBeVisible()
  expect(publicacoes).toHaveLength(0)
  await modal.getByRole('button', { name: 'Publicar' }).click()
  await expect(page.getByText('Nova versão publicada e vigente.')).toBeVisible(ESPERA)
  expect(publicacoes).toEqual([{
    p_tipo: 'consentimento_cliente', p_versao: '1.0', p_revisado_juridico: true,
    p_texto: 'Consentimento revisado pelo jurídico para o tratamento de dados pessoais.',
  }])
})

test('Super: equipe interna troca papel por equipe_definir_papel; o último Super é recusado pelo servidor', async ({ page }) => {
  await entrarSuper(page)
  await page.route('**/rest/v1/profiles**', (r) => {
    if (!r.request().url().includes('papel=in.')) return r.fallback()
    return responderRest(r, [
      { id: ID_OUTRO_ADMIN, nome: 'Beto Admin', email: 'beto@e2e.test', papel: 'admin', status_parceiro: 'pendente', inativado_em: null },
      { id: ID_SUPER, nome: 'Sara Super', email: 'super@e2e.test', papel: 'super', status_parceiro: 'pendente', inativado_em: null },
    ])
  })
  const trocas = await simularRpc(page, 'equipe_definir_papel', (a: Record<string, unknown>) =>
    a.p_profile_id === ID_SUPER ? erroRpc('P0001', 'ULTIMO_SUPER') : null)
  await page.goto('/admin/configuracoes/equipe')
  await page.getByLabel('Papel de Beto Admin').selectOption('super', ESPERA)
  const modal = page.getByRole('dialog', { name: 'Trocar o papel?' })
  await expect(modal).toContainText('Administrador → Super')
  await modal.getByRole('button', { name: 'Trocar' }).click()
  await expect(page.getByText('Beto Admin agora é Super.')).toBeVisible(ESPERA)
  expect(trocas[0]).toEqual({ p_profile_id: ID_OUTRO_ADMIN, p_papel: 'super' })

  await page.getByLabel('Papel de Sara Super').selectOption('admin')
  await expect(modal).toContainText('Você perde o acesso às configurações na hora.')
  await modal.getByRole('button', { name: 'Trocar' }).click()
  await expect(page.getByText('Não é possível remover o último Super.')).toBeVisible(ESPERA)
  expect(trocas[1]).toEqual({ p_profile_id: ID_SUPER, p_papel: 'admin' })
})

test('Super: revoga consentimento e anonimiza pela Edge (com protocolo e confirmação digitada)', async ({ page }) => {
  await entrarSuper(page)
  const ficha = {
    cliente: {
      id: CLIENTE, nome: 'Titular', sobrenome: 'LGPD', tipo_pessoa: 'fisica', cpf: '12345670916', cnpj: null, etapa: 'novo_contato',
      criado_em: '2026-09-01T12:00:00Z', anonimizado_em: null, inativado_em: null, portal_liberado: true,
    },
    cadeia: {}, destinos_etapa: [], permissoes: {}, contadores: {}, historico_vinculos: [],
    consentimentos: [{ id: CONSENTIMENTO, termo_id: 't1', termo_versao: '0-provisória', origem: 'declarado', aceito_em: '2026-09-01T12:00:00Z', registrado_por: { id: ID_CORRETOR, nome: 'Carla Corretora' }, revogado_em: null, motivo_revogacao: null }],
  }
  const fichas = await simularRpc(page, 'crm_ficha', ficha)
  const revogacoes = await simularRpc(page, 'lgpd_revogar_consentimento', null)
  const pedidos: unknown[] = []
  await page.route('**/functions/v1/lgpd-anonimizar', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204 })
    pedidos.push(r.request().postDataJSON())
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, arquivos_apagados: 1, usuario_removido: true }) })
  })

  await page.goto('/admin/configuracoes/anonimizacao')
  await page.getByLabel('ou informe o ID do cliente (também inativos)').fill(CLIENTE.toUpperCase(), ESPERA)
  await page.getByRole('button', { name: 'Abrir' }).click()
  await expect(page.getByRole('heading', { name: 'Titular LGPD' })).toBeVisible(ESPERA)
  expect(fichas[0]).toEqual({ p_id: CLIENTE })
  await expect(page.getByText('Declarado por Carla Corretora')).toBeVisible()

  await page.getByRole('button', { name: 'Revogar' }).click()
  const modalRevogar = page.getByRole('dialog', { name: 'Revogar consentimento?' })
  await modalRevogar.getByRole('textbox').fill('Pedido do titular por e-mail')
  await modalRevogar.getByRole('button', { name: 'Revogar' }).click()
  await expect(page.getByText('Consentimento revogado. O cliente deixa de receber e-mails.')).toBeVisible(ESPERA)
  expect(revogacoes).toEqual([{ p_id: CONSENTIMENTO, p_motivo: 'Pedido do titular por e-mail' }])

  // sem a palavra de confirmação, nada acontece
  await page.getByLabel('Protocolo do pedido').fill('LGPD-2026-001')
  await page.getByLabel('Digite ANONIMIZAR para confirmar').fill('sim')
  await page.getByRole('button', { name: 'Anonimizar' }).click()
  await expect(page.getByText('Digite ANONIMIZAR para confirmar', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Anonimizar este titular?' })).toHaveCount(0)

  await page.getByLabel('Digite ANONIMIZAR para confirmar').fill('ANONIMIZAR')
  await page.getByRole('button', { name: 'Anonimizar' }).click()
  const modal = page.getByRole('dialog', { name: 'Anonimizar este titular?' })
  await expect(modal).toContainText('LGPD-2026-001')
  await modal.getByRole('button', { name: 'Anonimizar' }).click()
  await expect(page.getByText('Titular anonimizado. 1 arquivo(s) apagado(s) e acesso ao portal removido.')).toBeVisible(ESPERA)
  expect(pedidos).toEqual([{ cliente_id: CLIENTE, protocolo: 'LGPD-2026-001' }])
})

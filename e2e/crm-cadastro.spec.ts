import { readFile } from 'node:fs/promises'
import { expect as expectBase, test, type Page } from '@playwright/test'
import { entrarComo, erroRpc, responderRest, simularRpc } from './apoio'

// Com vários servidores de desenvolvimento em paralelo, a primeira carga do painel (chunks lazy, compilados sob demanda pelo
// Vite) passa dos 5 s padrão: os testes deste arquivo rodam em sequência num só worker (o primeiro aquece o servidor) e
// esperam mais.
const expect = expectBase.configure({ timeout: 30_000 })
test.describe.configure({ mode: 'default', timeout: 120_000 })

// CRM: cadastro, ficha (Dados), duplicidades, leads e o redirecionamento da tela antiga [WP2].
// Rede simulada: nada chega ao Supabase real (as rotas não simuladas respondem vazio/404 aqui mesmo).

const TERMO = {
  id: 'e2e00000-0000-4000-8000-00000000c001', tipo: 'consentimento_cliente', versao: '1-revisada', texto: 'Texto do termo de consentimento.',
  vigente_desde: '2026-09-01T00:00:00Z', revisado_juridico: true,
}
const CLIENTE_ID = 'e2e00000-0000-4000-8000-00000000d001'

/** Rede fechada: RPC não simulada = 404 (PGRST202); leitura REST = lista vazia; Edge = 404. Registrar ANTES das demais. */
async function redeFechada(page: Page) {
  await page.route(/\/rest\/v1\/rpc\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'não simulado', details: null, hint: null }) }))
  await page.route(/\/rest\/v1\/(?!rpc\/)/, (r) => responderRest(r, []))
  await page.route(/\/functions\/v1\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"erro":"não simulado"}' }))
}

function ficha(extra: { cliente?: Record<string, unknown>; permissoes?: Record<string, unknown> } = {}) {
  return {
    cliente: {
      id: CLIENTE_ID, tipo_pessoa: 'fisica', nome: 'Maria', sobrenome: 'Souza', cpf: '52998224725', cnpj: null, rg: null,
      data_nascimento: null, genero: null, estado_civil: null, nacionalidade: null, email: 'maria@cliente.test', emails_adicionais: [],
      telefone: '11988887777', telefones_adicionais: [], horario_contato: null, cep: null, logradouro: null, numero: null,
      complemento: null, bairro: null, cidade: null, uf: null, pais: 'Brasil', interesses: ['Zona leste'], etapa: 'novo_contato',
      etapa_desde: '2026-09-20T12:00:00Z', motivo_perda: null, origem: 'cadastro_interno', exclusividade_ate: '2026-12-19T12:00:00Z',
      portal_liberado: false, tem_login_portal: false, criado_em: '2026-09-20T12:00:00Z', atualizado_em: null, inativado_em: null,
      motivo_inativacao: null, anonimizado_em: null, ...extra.cliente,
    },
    cadeia: { corretor: { id: 'e2e00000-0000-4000-8000-0000000000c1', nome: 'Corretor E2E' }, gerente: null, imobiliaria: null },
    destinos_etapa: [{ para: 'contato_iniciado', exige_motivo: false, validacoes: [], efeitos: [] }],
    permissoes: {
      editar: true, editar_documento: false, mudar_etapa: true, criar_nota: true, criar_tarefa: true, solicitar_documento: true,
      enviar_documento: true, analisar_documento: true, baixar_documento: true, transferir: false, criar_contrato: true,
      criar_proposta: true, inativar: false, liberar_portal: false, ver_portal: false, ...extra.permissoes,
    },
    contadores: { documentos_pendentes: 0, documentos_em_analise: 0, tarefas_pendentes: 0, tarefas_atrasadas: 0, notas: 0, contratos_ativos: 0, propostas: 0 },
    historico_vinculos: [],
    consentimentos: [{ id: 'k1', termo_id: TERMO.id, termo_versao: '1-revisada', origem: 'declarado', aceito_em: '2026-09-20T12:00:00Z', registrado_por: { id: 'u1', nome: 'Corretor E2E' }, revogado_em: null, motivo_revogacao: null }],
  }
}

test('corretor cadastra cliente: documento de outro dá resposta genérica; novo abre a ficha', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000a1', 'corretor@e2e.test', 'corretor', { nome: 'Corretor E2E' })
  await simularRpc(page, 'lgpd_termo_vigente', TERMO)
  let vez = 0
  const cadastros = await simularRpc(page, 'crm_cadastrar_cliente', () =>
    ++vez === 1 ? { situacao: 'indisponivel', id: null } : { situacao: 'criado', id: CLIENTE_ID })
  await simularRpc(page, 'crm_ficha', ficha())

  await page.goto('/parceiros/painel/crm/novo')
  await page.getByLabel(/^Nome/).fill('Maria')
  await page.getByLabel('Sobrenome').fill('Souza')
  await page.getByLabel('CPF').fill('52998224725')
  await page.getByLabel('Telefone / WhatsApp').fill('11988887777')
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
  await expect(page.getByText('Confirme o consentimento do cliente para continuar')).toBeVisible()
  expect(cadastros).toHaveLength(0)

  await page.getByRole('checkbox', { name: /Declaro que o cliente consentiu/ }).check()
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
  await expect(page.getByText(/não está disponível para cadastro/)).toBeVisible()
  // sem dono nem data: a tela não mostra nada além da mensagem genérica
  await expect(page.getByText(/exclusividade até|corretor responsável:/i)).toHaveCount(0)

  await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
  await expect(page.getByRole('heading', { name: 'Maria Souza' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/parceiros/painel/crm/${CLIENTE_ID}$`))

  expect(cadastros).toHaveLength(2)
  expect(cadastros[1].p_corretor_id).toBeNull()
  expect(cadastros[1].p_termo_id).toBe(TERMO.id)
  const dados = cadastros[1].p_dados as Record<string, unknown>
  expect(dados).toMatchObject({ tipo_pessoa: 'fisica', nome: 'Maria', sobrenome: 'Souza', cpf: '52998224725', cnpj: null, telefone: '11988887777' })
  // cadeia, etapa, origem e portal nunca saem do front
  for (const chave of ['corretor_id', 'gerente_id', 'imobiliaria_id', 'etapa', 'origem', 'portal_liberado']) expect(dados).not.toHaveProperty(chave)
})

test('gerente escolhe o corretor da equipe (ou ele mesmo, A1)', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000a2', 'gerente@e2e.test', 'gerente', { nome: 'Gerente E2E' })
  await simularRpc(page, 'lgpd_termo_vigente', TERMO)
  await page.route('**/rest/v1/parceiros**', (r) => responderRest(r, [{ id: 'e2e00000-0000-4000-8000-0000000000c9', nome: 'Corretora da Equipe' }]))
  const cadastros = await simularRpc(page, 'crm_cadastrar_cliente', { situacao: 'ja_na_sua_carteira', id: CLIENTE_ID })
  await simularRpc(page, 'crm_ficha', ficha())

  await page.goto('/parceiros/painel/crm/novo')
  const responsavel = page.getByLabel('Corretor responsável')
  await expect(responsavel).toHaveValue('eu')
  await responsavel.selectOption({ label: 'Corretora da Equipe' })
  await page.getByLabel(/^Nome/).fill('Maria')
  await page.getByLabel('CPF').fill('529.982.247-25')
  await page.getByRole('checkbox', { name: /Declaro que o cliente consentiu/ }).check()
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
  await expect(page.getByText('Este cliente já está na sua carteira. Abrimos a ficha dele.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Maria Souza' })).toBeVisible()
  expect(cadastros[0].p_corretor_id).toBe('e2e00000-0000-4000-8000-0000000000c9')
})

test('ficha, aba Dados: a edição manda só o que mudou e o documento preenchido fica travado', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000a1', 'corretor@e2e.test', 'corretor', { nome: 'Corretor E2E' })
  await simularRpc(page, 'crm_ficha', ficha())
  const edicoes = await simularRpc(page, 'crm_editar_cliente', null)

  await page.goto(`/parceiros/painel/crm/${CLIENTE_ID}?aba=dados`)
  await expect(page.getByText('Declarado no cadastro')).toBeVisible()
  await page.getByRole('button', { name: 'Editar dados' }).click()
  await expect(page.getByLabel('CPF')).toBeDisabled()
  await page.getByLabel('E-mail', { exact: true }).fill('maria.nova@cliente.test')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('Dados salvos.')).toBeVisible()
  expect(edicoes).toEqual([{ p_id: CLIENTE_ID, p_dados: { email: 'maria.nova@cliente.test' } }])
})

test('ficha fora do escopo: o servidor devolve nulo e a tela não revela nada', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000a1', 'corretor@e2e.test', 'corretor')
  await simularRpc(page, 'crm_ficha', null)
  await page.goto(`/parceiros/painel/crm/${CLIENTE_ID}`)
  await expect(page.getByText('Cliente não encontrado ou fora do seu escopo.')).toBeVisible()
})

test('admin resolve duplicidade: transferir exige motivo', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000b1', 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  await simularRpc(page, 'crm_duplicidades_listar', {
    total: 1,
    itens: [{
      id: 'e2e00000-0000-4000-8000-00000000f001',
      cliente: { id: CLIENTE_ID, nome: 'Maria Souza', etapa: 'novo_contato', corretor: { id: 'x1', nome: 'Corretor Dono' }, imobiliaria: { id: 'i1', nome: 'Imobiliária A' }, exclusividade_ate: '2026-09-01T00:00:00Z' },
      tentado_por: { profile_id: 'p2', nome: 'Corretora Tentou', papel: 'corretor' },
      tentado_por_parceiro: { id: 'x2', nome: 'Corretora Tentou', tipo: 'corretor', imobiliaria: { id: 'i1', nome: 'Imobiliária A' } },
      origem: 'cadastro_interno', resultado: 'bloqueado_pos_prazo', ocorrido_em: '2026-09-25T12:00:00Z', resolvido_em: null,
      resolvido_por: null, decisao: null, motivo_decisao: null, pode_transferir: true,
    }],
  })
  const decisoes = await simularRpc(page, 'crm_duplicidade_resolver', null)

  await page.goto('/admin/duplicidades')
  await expect(page.getByRole('link', { name: 'Maria Souza' })).toBeVisible()
  await expect(page.getByRole('table').getByText('Exclusividade vencida')).toBeVisible()
  await page.getByRole('button', { name: 'Transferir' }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.getByRole('button', { name: 'Transferir' })).toBeDisabled()
  await dialogo.getByLabel(/Motivo da decisão/).fill('prazo vencido e cliente atendido por ela')
  await dialogo.getByRole('button', { name: 'Transferir' }).click()
  await expect(page.getByText('Cliente transferido para quem tentou.')).toBeVisible()
  expect(decisoes).toEqual([{ p_id: 'e2e00000-0000-4000-8000-00000000f001', p_decisao: 'transferir', p_motivo: 'prazo vencido e cliente atendido por ela' }])
})

test('admin trata leads por RPC: descartar com motivo e exportar auditado', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000b1', 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  const lead = {
    id: 'e2e00000-0000-4000-8000-00000000e001', nome: 'Lead do Site', email: 'lead@site.test', telefone: '11977776666',
    mensagem: '=HYPERLINK("x")', origem: 'site', empreendimento: null, status: 'novo', cliente_id: null, tratado_por: null,
    tratado_em: null, motivo_descarte: null, criado_em: '2026-09-27T12:00:00Z',
  }
  const listas = await simularRpc(page, 'leads_listar', { total: 1, itens: [lead] })
  const descartes = await simularRpc(page, 'leads_descartar', null)
  const exportacoes = await simularRpc(page, 'leads_exportar', [lead])

  await page.goto('/admin/leads')
  await expect(page.getByText('Lead do Site')).toBeVisible()
  expect(listas[0]).toEqual({ p_filtros: { status: 'novo', busca: null, empreendimento_id: null, limite: 50, offset: 0 } })

  await page.getByRole('button', { name: 'Descartar Lead do Site' }).click()
  const dialogo = page.getByRole('dialog')
  await dialogo.getByLabel(/Motivo do descarte/).fill('spam')
  await expect(dialogo.getByRole('button', { name: 'Descartar' })).toBeDisabled()
  await dialogo.getByLabel(/Motivo do descarte/).fill('contato de spam')
  await dialogo.getByRole('button', { name: 'Descartar' }).click()
  await expect(page.getByText('Contato descartado.')).toBeVisible()
  expect(descartes).toEqual([{ p_lead_id: lead.id, p_motivo: 'contato de spam' }])

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar CSV' }).click()
  const arquivo = await download
  expect(arquivo.suggestedFilename()).toBe('leads-arken.csv')
  const conteudo = await readFile(await arquivo.path(), 'utf8')
  // CSV injection neutralizada: a fórmula vira texto
  expect(conteudo).toContain(`"'=HYPERLINK(""x"")"`)
  expect(exportacoes[0]).toEqual({ p_filtros: { status: 'novo', busca: null, empreendimento_id: null } })
})

test('a tela antiga de clientes do parceiro redireciona para o CRM', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000a1', 'corretor@e2e.test', 'corretor')
  const listas = await simularRpc(page, 'crm_listar', { total: 0, itens: [] })
  await page.goto('/parceiros/painel/clientes')
  await expect(page).toHaveURL(/\/parceiros\/painel\/crm\/lista$/)
  await expect(page.getByText('Nenhum cliente encontrado.')).toBeVisible()
  expect(listas[0]).toMatchObject({ p_limite: 50, p_offset: 0 })
})

test('erro de acesso vira mensagem genérica em pt-BR', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000a1', 'corretor@e2e.test', 'corretor')
  await simularRpc(page, 'crm_listar', erroRpc('42501', 'Sem acesso a este registro'))
  await page.goto('/parceiros/painel/crm/lista')
  await expect(page.getByText('Você não tem acesso a este registro.')).toBeVisible()
})

// ---- aba Dados: CPF/CNPJ vazio preenchido pelo parceiro (A2: o servidor não grava documento de outro cliente) ----
const SEM_CPF = { cliente: { cpf: null, origem: 'migracao_parceiro_clientes', exclusividade_ate: null }, permissoes: { editar_documento: true } }
const TEXTO_INDISPONIVEL = 'Este documento não está disponível para cadastro'

test('aba Dados: CPF vazio preenchido e gravado não mostra "indisponível" (relê a ficha do servidor, sem cache)', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000a1', 'corretor@e2e.test', 'corretor', { nome: 'Corretor E2E' })
  let salvo = false
  const fichas = await simularRpc(page, 'crm_ficha', () =>
    ficha(salvo ? { ...SEM_CPF, cliente: { ...SEM_CPF.cliente, cpf: '52998224725' } } : SEM_CPF))
  const edicoes = await simularRpc(page, 'crm_editar_cliente', () => { salvo = true; return null })

  await page.goto(`/parceiros/painel/crm/${CLIENTE_ID}?aba=dados`)
  await page.getByRole('button', { name: 'Editar dados' }).click()
  await page.getByLabel('CPF').fill('52998224725')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('Dados salvos.')).toBeVisible()
  await expect(page.getByText('529.982.247-25')).toBeVisible()
  await expect(page.getByText(TEXTO_INDISPONIVEL)).toHaveCount(0)
  expect(edicoes).toEqual([{ p_id: CLIENTE_ID, p_dados: { cpf: '52998224725' } }])
  // a conferência foi ao servidor mesmo com a ficha recém-carregada (staleTime do cache não vale aqui)
  expect(fichas.length).toBeGreaterThanOrEqual(2)
})

test('aba Dados: CPF de outro cliente não é gravado; aviso genérico e as demais alterações salvas', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000a1', 'corretor@e2e.test', 'corretor', { nome: 'Corretor E2E' })
  await simularRpc(page, 'crm_ficha', () => ficha(SEM_CPF))
  const edicoes = await simularRpc(page, 'crm_editar_cliente', null)

  await page.goto(`/parceiros/painel/crm/${CLIENTE_ID}?aba=dados`)
  await page.getByRole('button', { name: 'Editar dados' }).click()
  await page.getByLabel('CPF').fill('52998224725')
  await page.getByLabel('E-mail', { exact: true }).fill('maria.nova@cliente.test')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText(`${TEXTO_INDISPONIVEL}. Se precisar de ajuda, fale com a equipe Arken. As demais alterações foram salvas.`)).toBeVisible()
  await expect(page.getByText('Dados salvos.')).toHaveCount(0)
  expect(edicoes).toEqual([{ p_id: CLIENTE_ID, p_dados: { email: 'maria.nova@cliente.test', cpf: '52998224725' } }])
})

test('aba Dados: cliente migrado sem CPF salva outras alterações sem exigir o CPF', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000a1', 'corretor@e2e.test', 'corretor', { nome: 'Corretor E2E' })
  await simularRpc(page, 'crm_ficha', () => ficha(SEM_CPF))
  const edicoes = await simularRpc(page, 'crm_editar_cliente', null)

  await page.goto(`/parceiros/painel/crm/${CLIENTE_ID}?aba=dados`)
  await page.getByRole('button', { name: 'Editar dados' }).click()
  await expect(page.getByLabel('CPF')).toBeEnabled()
  await page.getByLabel('Telefone / WhatsApp').fill('(11) 97777-6666')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('Dados salvos.')).toBeVisible()
  await expect(page.getByText('CPF inválido')).toHaveCount(0)
  expect(edicoes).toEqual([{ p_id: CLIENTE_ID, p_dados: { telefone: '11977776666' } }])
})

test('fila de duplicidades: dentro da exclusividade só "manter" (o servidor não oferece transferir)', async ({ page }) => {
  await redeFechada(page)
  await entrarComo(page, 'e2e00000-0000-4000-8000-0000000000b1', 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
  await simularRpc(page, 'crm_duplicidades_listar', {
    total: 1,
    itens: [{
      id: 'e2e00000-0000-4000-8000-00000000f002',
      cliente: { id: CLIENTE_ID, nome: 'Maria Souza', etapa: 'novo_contato', corretor: { id: 'x1', nome: 'Corretor Dono' }, imobiliaria: { id: 'i1', nome: 'Imobiliária A' }, exclusividade_ate: '2099-01-01T00:00:00Z' },
      tentado_por: { profile_id: 'p2', nome: 'Corretora Tentou', papel: 'corretor' },
      tentado_por_parceiro: { id: 'x2', nome: 'Corretora Tentou', tipo: 'corretor', imobiliaria: { id: 'i1', nome: 'Imobiliária A' } },
      origem: 'cadastro_interno', resultado: 'bloqueado_exclusividade', ocorrido_em: '2026-09-25T12:00:00Z', resolvido_em: null,
      resolvido_por: null, decisao: null, motivo_decisao: null, pode_transferir: false,
    }],
  })
  await page.goto('/admin/duplicidades')
  await expect(page.getByRole('link', { name: 'Maria Souza' })).toBeVisible()
  await expect(page.getByText('Transferência só depois do prazo')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Transferir' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Manter dono' })).toBeVisible()
})
